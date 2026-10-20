import { randomUUID } from 'node:crypto';
import { now } from './db.mjs';

const samplers = new Set(['euler','euler_cfg_pp','euler_ancestral','euler_ancestral_cfg_pp','heun','heunpp2','exp_heun_2_x0','exp_heun_2_x0_sde','dpm_2','dpm_2_ancestral','lms','dpm_fast','dpm_adaptive','dpmpp_2s_ancestral','dpmpp_2s_ancestral_cfg_pp','dpmpp_sde','dpmpp_sde_gpu','dpmpp_2m','dpmpp_2m_cfg_pp','dpmpp_2m_sde','dpmpp_2m_sde_gpu','dpmpp_2m_sde_heun','dpmpp_2m_sde_heun_gpu','dpmpp_3m_sde','dpmpp_3m_sde_gpu','ddpm','lcm','ipndm','ipndm_v','deis','cfgpp_ud10_ab','res_multistep','res_multistep_cfg_pp','res_multistep_ancestral','res_multistep_ancestral_cfg_pp','gradient_estimation','gradient_estimation_cfg_pp','er_sde','seeds_2','seeds_3','sa_solver','sa_solver_pece','ddim','uni_pc','uni_pc_bh2']);
const schedulers = new Set(['simple','normal','karras','exponential','ddim_uniform','sgm_uniform','beta','linear_quadratic','kl_optimal']);
export const validatePresetParams = (p) => {
  if (!p || typeof p !== 'object') return false;
  const text=x=>typeof x==='string'&&x.length<=16384;
  const integer=(x,a,b)=>Number.isInteger(x)&&Number.isFinite(x)&&x>=a&&x<=b;
  return (p.modelId===null || p.modelId===undefined || (Number.isInteger(p.modelId)&&p.modelId>0)) && text(p.prompt) && text(p.negativePrompt) && [1,2,4,8].includes(p.batchSize) && integer(p.repeat,1,32) && p.batchSize*p.repeat<=256 && integer(p.width,64,4096) && integer(p.height,64,4096) && p.width%8===0 && p.height%8===0 && integer(p.steps,1,200) && Number.isFinite(p.cfg)&&p.cfg>=0&&p.cfg<=50 && Number.isFinite(p.denoise)&&p.denoise>=0&&p.denoise<=1 && Number.isInteger(p.seed)&&p.seed>=-1&&p.seed<=Number.MAX_SAFE_INTEGER && samplers.has(p.sampler) && schedulers.has(p.scheduler);
};
const view = r => ({id:r.id,name:r.name,params:JSON.parse(r.params)});
export function listPresets(db,user) {
  const rows=db.prepare('SELECT * FROM presets WHERE user_id=? ORDER BY updated_at DESC').all(user.id);
  let active=null; try { active=JSON.parse(user.preferences||'{}').activePresetId||null; } catch {}
  if(active && !rows.some(x=>x.id===active)) active=null;
  const prefs=JSON.parse(user.preferences||'{}');return {presets:rows.map(view),activePresetId:active,preferredModelId:prefs.preferredModelId??null};
}
export function savePreset(db,user,{name,params}) {
  if(typeof name!=='string'||!name.trim()||name.length>60||!validatePresetParams(params)) return {error:'Invalid preset'};
  params=Object.fromEntries(['modelId','prompt','negativePrompt','batchSize','repeat','width','height','steps','cfg','sampler','scheduler','seed','denoise'].filter(k=>params[k]!==undefined).map(k=>[k,params[k]]));
  const t=now(); const existing=db.prepare('SELECT id FROM presets WHERE user_id=? AND name=?').get(user.id,name.trim()); const presetId=existing?.id||randomUUID();
  db.prepare('INSERT INTO presets(id,user_id,name,params,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,name) DO UPDATE SET params=excluded.params,updated_at=excluded.updated_at').run(presetId,user.id,name.trim(),JSON.stringify(params),t,t);
  return {presetId};
}
export function setActivePreset(db,user,id) {
  if(id!==null){ const row=db.prepare('SELECT id FROM presets WHERE id=? AND user_id=?').get(id,user.id); if(!row)return {notFound:true}; }
  const old=JSON.parse(db.prepare('SELECT preferences FROM users WHERE id=?').get(user.id).preferences||'{}'); old.activePresetId=id;const selected=id?db.prepare('SELECT params FROM presets WHERE id=? AND user_id=?').get(id,user.id):null;old.preferredModelId=selected?JSON.parse(selected.params).modelId??null:null; db.prepare('UPDATE users SET preferences=? WHERE id=?').run(JSON.stringify(old),user.id); return {};
}
export async function handlePresets({req,res,path,user,db,json,err,parseBody}) {
  if(path==='/api/presets'&&req.method==='GET') return json(res,200,listPresets(db,user));
  if(path==='/api/presets'&&req.method==='POST') { const b=await parseBody(req); if(b.params?.modelId!=null&&!db.prepare('SELECT 1 FROM models WHERE id=? AND enabled=1').get(b.params.modelId)) return err(res,400,'Invalid preset'); if(db.prepare('SELECT COUNT(*) n FROM presets WHERE user_id=?').get(user.id).n>=30 && !db.prepare('SELECT 1 FROM presets WHERE user_id=? AND name=?').get(user.id,b.name?.trim())) return err(res,400,'Preset limit reached'); const out=savePreset(db,user,b); if(out.error)return err(res,400,out.error); const fresh=db.prepare('SELECT * FROM users WHERE id=?').get(user.id); const r=setActivePreset(db,fresh,out.presetId); if(r.notFound)return err(res,404,'Preset not found'); return json(res,201,listPresets(db,db.prepare('SELECT * FROM users WHERE id=?').get(user.id))); }
  if(path==='/api/presets/active'&&req.method==='PATCH') { const b=await parseBody(req); if(b.id!==null&&typeof b.id!=='string')return err(res,400,'Invalid preset'); const r=setActivePreset(db,user,b.id??null); if(r.notFound)return err(res,404,'Preset not found'); return json(res,200,listPresets(db,db.prepare('SELECT * FROM users WHERE id=?').get(user.id))); }
 const item=/^\/api\/presets\/([^/]+)$/.exec(path);
 if(item&&req.method==='PATCH') {
   const b=await parseBody(req); const current=db.prepare('SELECT * FROM presets WHERE id=? AND user_id=?').get(item[1],user.id); if(!current)return err(res,404,'Preset not found');
   if(b.name===undefined&&b.params===undefined)return err(res,400,'No changes');
   if(b.name!==undefined&&(typeof b.name!=='string'||!b.name.trim()||b.name.length>60))return err(res,400,'Invalid preset name');
   if(b.params!==undefined) { if(b.params?.modelId!=null&&!db.prepare('SELECT 1 FROM models WHERE id=? AND enabled=1').get(b.params.modelId))return err(res,400,'Invalid preset'); if(!validatePresetParams(b.params))return err(res,400,'Invalid preset'); }
   const name=b.name===undefined?current.name:b.name.trim(); const clash=db.prepare('SELECT id FROM presets WHERE user_id=? AND name=? AND id<>?').get(user.id,name,item[1]); if(clash)return err(res,409,'Preset name already exists');
   const params=b.params===undefined?current.params:JSON.stringify(b.params); db.exec('BEGIN IMMEDIATE'); try { db.prepare('UPDATE presets SET name=?,params=?,updated_at=? WHERE id=? AND user_id=?').run(name,params,now(),item[1],user.id); db.exec('COMMIT'); } catch(e){db.exec('ROLLBACK');return err(res,500,'Unable to update preset');}
   return json(res,200,listPresets(db,db.prepare('SELECT * FROM users WHERE id=?').get(user.id)));
 }
 if(item&&req.method==='DELETE') {
   const b=await parseBody(req); if(b.confirm!==true)return err(res,400,'Confirmation required'); const current=db.prepare('SELECT id FROM presets WHERE id=? AND user_id=?').get(item[1],user.id); if(!current)return err(res,404,'Preset not found');
   db.exec('BEGIN IMMEDIATE'); try { const fresh=db.prepare('SELECT preferences FROM users WHERE id=?').get(user.id); const prefs=JSON.parse(fresh.preferences||'{}'); db.prepare('DELETE FROM presets WHERE id=? AND user_id=?').run(item[1],user.id); if(prefs.activePresetId===item[1]){delete prefs.activePresetId;db.prepare('UPDATE users SET preferences=? WHERE id=?').run(JSON.stringify(prefs),user.id);} db.exec('COMMIT'); } catch(e){db.exec('ROLLBACK');return err(res,500,'Unable to delete preset');}
   return json(res,200,listPresets(db,db.prepare('SELECT * FROM users WHERE id=?').get(user.id)));
 }
  return false;
}
