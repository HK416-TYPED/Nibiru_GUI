import { createReadStream, existsSync, mkdirSync, writeFileSync, unlinkSync, chmodSync, lstatSync, realpathSync } from 'node:fs';
import { join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { openDb, now, userView, modelView, inviteView } from './db.mjs';
import { hashPasswordAsync, verifyPasswordAsync, validPassword, token, id, parseCookies, cookie, validUsername } from './security.mjs';
import { makeWorkflow, capabilities } from './comfy.mjs';
import { createWorker } from './worker.mjs';
import {deleteHistorySelection} from './history-selection.mjs';
import {securityHeaders,requestBoundary,readJsonBody,bootstrapGate,originConfig,rateLimiter,httpError,csp} from './http-security.mjs';
import {exportTaskArchive,isUserExporting} from './task-archive.mjs';
import {getWorkspaceDefaults,saveWorkspaceDefaults,initializeWorkspace} from './workspace-defaults.mjs';
import { handlePresets } from './presets.mjs';
import { handleTasks,enqueueBatches,normalizeParams,taskBatchView } from './tasks.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const json = (res, status, data, extra={}) => { const b=Buffer.from(JSON.stringify(data)); res.writeHead(status, {'content-type':'application/json; charset=utf-8','content-length':b.length,'cache-control':'private, no-store','x-content-type-options':'nosniff',...extra}); res.end(b); };
const err = (res, status, message) => json(res,status,{error:message});
const inputError = (res,msg='Invalid request') => err(res,400,msg);

const publicUser = r => userView(r);

export function createApp(options={}) {
  const dataDir=options.dataDir || process.env.DATA_DIR || join(root,'data'); const db=options.db || openDb(dataDir); const comfyUrl=options.comfyUrl || process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
  const imageDir=join(dataDir,'images'); mkdirSync(imageDir,{recursive:true,mode:0o700});chmodSync(imageDir,0o700); const template=options.workflowPath || join(root,'workflows/krea2-turbo.json');
  const limit=rateLimiter();const appOrigin=originConfig(options.appOrigin??process.env.APP_ORIGIN);
  const setup=bootstrapGate(dataDir,!db.prepare('SELECT 1 FROM users LIMIT 1').get(),options.setupToken??process.env.NIBIRU_SETUP_TOKEN);
  const sessions = req => { const c=parseCookies(req.headers.cookie); const s=c.nibiru_session && db.prepare('SELECT u.*,s.id session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?').get(c.nibiru_session,Date.now()); return s && !s.disabled ? s : null; };
  const setupRequired=()=>!db.prepare('SELECT 1 FROM users LIMIT 1').get();
  const event=(uid,action,detail='')=>db.prepare('INSERT INTO events(user_id,action,detail,created_at) VALUES(?,?,?,?)').run(uid||null,action,detail,now());
  const parseBody=async req=>{
    const body=await readJsonBody(req);
    const path=new URL(req.url,'http://localhost').pathname;
    if(!['/api/setup','/api/auth/register','/api/auth/login','/api/auth/logout'].includes(path)&&!sessions(req))throw httpError(401,'Authentication required');
    return body;
  };
  const secureCookie=process.env.SECURE_COOKIE==='1'||appOrigin?.protocol==='https:';
  const login=(res,u)=>{ db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());db.prepare('DELETE FROM sessions WHERE user_id=? AND id NOT IN (SELECT id FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 9)').run(u.id,u.id);const sid=token(); db.prepare('INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(sid,u.id,Date.now()+604800000,now()); res.setHeader('set-cookie',cookie('nibiru_session',sid,604800,secureCookie)); };
  const requireAuth=(req,res)=>{ const u=sessions(req); if(!u){err(res,401,'Authentication required'); return null;} return u; };
  const requireAdmin=(req,res)=>{ const u=requireAuth(req,res); if(u && u.role!=='admin'){err(res,403,'Admin required'); return null;} return u; };
  function modelRows(){ return db.prepare('SELECT * FROM models WHERE enabled=1 ORDER BY id').all(); }
  const worker=createWorker({db,comfyUrl,imageDir,intervalMs:options.workerInterval??1000});
  const samplers = new Set(['euler','euler_cfg_pp','euler_ancestral','euler_ancestral_cfg_pp','heun','heunpp2','exp_heun_2_x0','exp_heun_2_x0_sde','dpm_2','dpm_2_ancestral','lms','dpm_fast','dpm_adaptive','dpmpp_2s_ancestral','dpmpp_2s_ancestral_cfg_pp','dpmpp_sde','dpmpp_sde_gpu','dpmpp_2m','dpmpp_2m_cfg_pp','dpmpp_2m_sde','dpmpp_2m_sde_gpu','dpmpp_2m_sde_heun','dpmpp_2m_sde_heun_gpu','dpmpp_3m_sde','dpmpp_3m_sde_gpu','ddpm','lcm','ipndm','ipndm_v','deis','cfgpp_ud10_ab','res_multistep','res_multistep_cfg_pp','res_multistep_ancestral','res_multistep_ancestral_cfg_pp','gradient_estimation','gradient_estimation_cfg_pp','er_sde','seeds_2','seeds_3','sa_solver','sa_solver_pece','ddim','uni_pc','uni_pc_bh2']);
  async function handler(req,res){
    try {
      securityHeaders(res,secureCookie&&appOrigin?.protocol==='https:');requestBoundary(req,appOrigin);
      if(req.method==='GET' && !req.url.startsWith('/api/')) return staticFile(req,res);
      const u=new URL(req.url,'http://localhost'); const path=u.pathname;
      const ip=req.socket.remoteAddress||'unknown';
      if(['/api/setup','/api/auth/register','/api/auth/login','/api/auth/password'].includes(path)){limit('auth-global',120);limit('auth-ip:'+ip,60);}
      if(['POST','PATCH','DELETE'].includes(req.method)&&path.startsWith('/api/'))limit('writes:'+ip,240);
      if(req.method==='GET' && path==='/api/session'){ const s=sessions(req); return json(res,200,{user:publicUser(s),setupRequired:setupRequired()}); }
      if(req.method==='POST'&&path==='/api/setup'){
        if(!setupRequired())return err(res,409,'Setup already completed');
        const remote=req.socket.remoteAddress,hostname=new URL('http://'+req.headers.host).hostname;
        if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)||!['127.0.0.1','localhost','[::1]'].includes(hostname)||Object.keys(req.headers).some(h=>h==='forwarded'||h.startsWith('x-forwarded-'))||!['127.0.0.1','localhost','::1'].includes(process.env.HOST||'127.0.0.1'))return err(res,403,'Setup is local only');
        const body=await parseBody(req);
        if(!setup.matches(req.headers['x-nibiru-setup-token']||body.setupToken))return err(res,403,'Invalid setup key');
        if(!validUsername(body.username)||!validPassword(body.password)||body.password!==body.confirmPassword)return inputError(res,'Invalid credentials');
        const hashed=await hashPasswordAsync(body.password);let user;
        db.exec('BEGIN IMMEDIATE');
        try{
          if(!setupRequired()){db.exec('ROLLBACK');return err(res,409,'Setup already completed');}
          const row=db.prepare('INSERT INTO users(username,password_hash,role,created_at,preferences) VALUES(?,?,?,?,?)').run(body.username,hashed,'admin',now(),JSON.stringify({theme:'light',language:'zh'}));
          db.prepare('INSERT INTO models(name,kind,filename,clip_name,clip_type,vae_name) VALUES(?,?,?,?,?,?)').run('Krea2 Turbo','unet','krea2_turbo_bf16.safetensors','qwen3vl_4b_bf16.safetensors','krea2','qwen_image_vae.safetensors');
          user=db.prepare('SELECT * FROM users WHERE id=?').get(row.lastInsertRowid);db.exec('COMMIT');
        }catch{db.exec('ROLLBACK');return err(res,409,'Setup could not be completed');}
        setup.consume();event(user.id,'setup');login(res,user);return json(res,201,{user:publicUser(user)});
      }
      if(req.method==='POST'&&path==='/api/auth/register'){
        const body=await parseBody(req);
        if(!validUsername(body.username)||!validPassword(body.password)||body.password!==body.confirmPassword||typeof body.inviteCode!=='string'||body.inviteCode.length>128)return inputError(res,'Invalid registration');
        const invitation=db.prepare('SELECT * FROM invites WHERE code=?').get(body.inviteCode);
        if(!invitation||invitation.used_at||(invitation.expires_at&&Date.parse(invitation.expires_at)<=Date.now()))return inputError(res,'Invalid or expired invite');
        const hashed=await hashPasswordAsync(body.password);let user;
        db.exec('BEGIN IMMEDIATE');
        try{
          const row=db.prepare('SELECT * FROM invites WHERE id=?').get(invitation.id);
          if(!row||row.used_at||(row.expires_at&&Date.parse(row.expires_at)<=Date.now())){db.exec('ROLLBACK');return inputError(res,'Invalid or expired invite');}
          const inserted=db.prepare('INSERT INTO users(username,password_hash,role,created_at,preferences) VALUES(?,?,?,?,?)').run(body.username,hashed,'user',now(),JSON.stringify({theme:'light',language:'zh'}));
          db.prepare('UPDATE invites SET used_at=?,used_by=? WHERE id=?').run(now(),inserted.lastInsertRowid,row.id);
          user=db.prepare('SELECT * FROM users WHERE id=?').get(inserted.lastInsertRowid);db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');return err(res,String(error).includes('UNIQUE')?409:400,'Registration could not be completed');}
        event(user.id,'register');login(res,user);return json(res,201,{user:publicUser(user)});
      }
      if(req.method==='POST'&&path==='/api/auth/login'){
        const body=await parseBody(req);
        if(!validUsername(body.username)||typeof body.password!=='string'||body.password.length>128)return inputError(res,'Invalid credentials');
        limit('login-account-ip:'+ip+':'+body.username,10);limit('login-account:'+body.username,30);
        const user=db.prepare('SELECT * FROM users WHERE username=?').get(body.username);
        const dummy='scrypt$32768$8$3$00000000000000000000000000000000$'+'0'.repeat(128);
        const valid=await verifyPasswordAsync(body.password,user?.password_hash||dummy);
        const current=user&&db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
        if(!valid||!current||current.disabled||current.password_hash!==user.password_hash)return err(res,401,'Invalid username or password');
        db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(now(),current.id);event(current.id,'login');login(res,current);return json(res,200,{user:publicUser(current)});
      }
      if(req.method==='POST'&&path==='/api/auth/password'){
        const user=requireAuth(req,res);if(!user)return;
        const body=await parseBody(req);limit('password-change:'+user.id,5);
        if(!validPassword(body.newPassword)||body.newPassword.length<12||body.newPassword!==body.confirmPassword||body.newPassword===body.currentPassword)return inputError(res,'Use a new password of 12–128 characters');
        if(!await verifyPasswordAsync(body.currentPassword,user.password_hash))return inputError(res,'Current password is incorrect');
        const hashed=await hashPasswordAsync(body.newPassword);
        if(!sessions(req))return err(res,401,'Authentication required');
        const current=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
        if(current.password_hash!==user.password_hash)return err(res,409,'Password already changed');
        db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashed,user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);db.exec('COMMIT');}catch{db.exec('ROLLBACK');return err(res,500,'Unable to change password');}
        login(res,current);event(user.id,'password_changed');return json(res,200,{ok:true});
      }
      if(req.method==='POST' && path==='/api/auth/logout'){ const s=sessions(req); if(s) db.prepare('DELETE FROM sessions WHERE id=?').run(s.session_id); res.setHeader('set-cookie',cookie('nibiru_session','',0,secureCookie)); return json(res,200,{ok:true}); }
      if(path.startsWith('/api/presets')) { const s=requireAuth(req,res); if(!s)return; const initialized=initializeWorkspace(db,s.id); const handled=await handlePresets({req,res,path,user:initialized,db,json,err,parseBody}); if(handled!==false)return; }
      const archive=/^\/api\/tasks\/([^/]+)\/download$/.exec(path);
      if(archive&&req.method==='GET'){const user=requireAuth(req,res);if(!user)return;return await exportTaskArchive({req,res,db,user,taskId:archive[1],imageDir});}
      if(path==='/api/history/selection'&&req.method==='DELETE'){
        const user=requireAuth(req,res);if(!user)return;
        try{const selection=await parseBody(req);if(isUserExporting(db,user.id))return err(res,409,'Wait for the image export to finish');const result=deleteHistorySelection({batchIds:selection.batchIds,imageIds:selection.imageIds,confirm:selection.confirm,db,user,imageDir});return json(res,200,result);}catch(error){return err(res,error.status||400,error.status?error.message:'Invalid selection');}
      }
      if(path.startsWith('/api/tasks')) { const s=requireAuth(req,res); if(!s)return; const handled=await handleTasks({req,res,path,user:s,db,json,err,parseBody,template,modelRows:modelRows(),imageDir}); if(handled!==false)return; }
      if(path==='/api/models'&&req.method==='GET'){ requireAuth(req,res); if(!sessions(req)) return; return json(res,200,{models:modelRows().map(modelView)}); }
      if(path==='/api/capabilities'&&req.method==='GET'){ if(!requireAuth(req,res)) return; return json(res,200,await capabilities(comfyUrl)); }
      if(path==='/api/preferences'&&req.method==='PATCH'){ const s=requireAuth(req,res); if(!s)return; const b=await parseBody(req); if(b.theme!==undefined&&!['light','dark','system'].includes(b.theme)||b.language!==undefined&&!['zh','en'].includes(b.language)||b.imageView!==undefined&&!['grid','single'].includes(b.imageView)) return inputError(res,'Invalid preferences'); if(b.preferredModelId!==undefined&&b.preferredModelId!==null&&(!Number.isInteger(b.preferredModelId)||!db.prepare('SELECT 1 FROM models WHERE id=? AND enabled=1').get(b.preferredModelId)))return inputError(res,'Unknown or disabled model'); if(b.theme===undefined&&b.language===undefined&&b.imageView===undefined&&b.preferredModelId===undefined)return inputError(res,'No preferences'); const current=db.prepare('SELECT preferences FROM users WHERE id=?').get(s.id); const old=JSON.parse(current?.preferences||'{}'); const preferences={...old}; if(b.theme!==undefined)preferences.theme=b.theme;if(b.language!==undefined)preferences.language=b.language;if(b.imageView!==undefined)preferences.imageView=b.imageView;if(b.preferredModelId!==undefined)preferences.preferredModelId=b.preferredModelId; db.prepare('UPDATE users SET preferences=? WHERE id=?').run(JSON.stringify(preferences),s.id); return json(res,200,{user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(s.id))}); }
      if(path==='/api/generations'&&req.method==='POST') {
        const user=requireAuth(req,res);if(!user)return;
        try {
          const params=normalizeParams(await parseBody(req));
          const model=params.modelId==null?db.prepare('SELECT * FROM models WHERE enabled=1 ORDER BY id LIMIT 1').get():db.prepare('SELECT * FROM models WHERE id=? AND enabled=1').get(params.modelId);
          if(!model)return inputError(res,'Unknown or disabled model');
          const batches=enqueueBatches({db,user,model,template,params});
          event(user.id,'generation',`${model.name} · ${batches.length} × ${params.batchSize}`);
          return json(res,202,{batches});
        } catch(error){return err(res,error.status||400,error.status?error.message:'Invalid generation parameters');}
      }
      const batchCancel=/^\/api\/batches\/([^/]+)\/cancel$/.exec(path);
      if(batchCancel&&req.method==='POST'){
        const s=requireAuth(req,res);if(!s)return;
        const row=db.prepare('SELECT * FROM batches WHERE id=? AND user_id=?').get(batchCancel[1],s.id);
        if(!row)return err(res,404,'Batch not found');
        const active=db.prepare("SELECT 1 FROM generation_jobs WHERE batch_id=? AND status IN ('queued','running') LIMIT 1").get(row.id);
        if(!active)return err(res,409,'Batch is not active');
        db.exec('BEGIN IMMEDIATE');
        try{
          // A submitted/running ComfyUI job cannot be safely withdrawn. Leave it
          // alone while cancelling every job that has not reached ComfyUI.
          db.prepare("UPDATE generation_jobs SET status='cancelled',error=COALESCE(error,'Cancelled') WHERE batch_id=? AND status IN ('queued','running') AND submitted=0").run(row.id);
          db.prepare("UPDATE batches SET cancel_requested=1,status=CASE WHEN EXISTS(SELECT 1 FROM generation_jobs WHERE batch_id=batches.id AND status='running' AND submitted=1) THEN 'running' ELSE 'cancelled' END WHERE id=? AND user_id=?").run(row.id,s.id);
          db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');return err(res,500,'Unable to cancel batch');}
        return json(res,200,{batch:batchView(db.prepare('SELECT * FROM batches WHERE id=?').get(row.id),db)});
      }
      if(path==='/api/batches'&&req.method==='GET'){ const s=requireAuth(req,res); if(!s)return; const sort=u.searchParams.get('sort')==='asc'?'ASC':'DESC'; let sql=`SELECT * FROM batches WHERE user_id=?`; const args=[s.id]; if(u.searchParams.get('q')){sql+=' AND (prompt LIKE ? OR negative_prompt LIKE ?)';args.push(`%${u.searchParams.get('q')}%`,`%${u.searchParams.get('q')}%`);} if(u.searchParams.get('date')){const d=u.searchParams.get('date'); const off=Number(u.searchParams.get('tzOffset')||0); const start=new Date(`${d}T00:00:00.000Z`); start.setUTCMinutes(start.getUTCMinutes()+off); const end=new Date(start); end.setUTCDate(end.getUTCDate()+1); sql+=' AND created_at>=? AND created_at<?';args.push(start.toISOString(),end.toISOString());} sql+=` ORDER BY created_at ${sort}`; return json(res,200,{batches:db.prepare(sql).all(...args).map(x=>batchView(x,db))}); }
      const im=/^\/api\/images\/([^/]+)$/.exec(path); if(im&&req.method==='GET'){ const s=requireAuth(req,res); if(!s)return; const r=db.prepare('SELECT * FROM images WHERE id=? AND user_id=?').get(im[1],s.id); if(!r||!existsSync(r.path))return err(res,404,'Image not found'); const resolved=realpathSync(r.path),rootPath=realpathSync(imageDir);if(lstatSync(r.path).isSymbolicLink()||!resolved.startsWith(rootPath+sep))return err(res,404,'Image not found'); const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[extname(r.path).toLowerCase()]||'application/octet-stream'; res.writeHead(200,{'content-type':mime,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-disposition':u.searchParams.get('download')?'attachment':''}); const stream=createReadStream(r.path); stream.on('error',()=>{if(!res.headersSent)err(res,404,'Image not found');else res.destroy();}); return stream.pipe(res); }
      if(path==='/api/admin/workspace-defaults'){
        const admin=requireAdmin(req,res);if(!admin)return;
        if(req.method==='GET')return json(res,200,{defaults:getWorkspaceDefaults(db)});
        if(req.method==='PATCH'){const body=await parseBody(req);try{const defaults=saveWorkspaceDefaults(db,admin,body);event(admin.id,'workspace_defaults_changed');return json(res,200,{defaults});}catch(error){return err(res,error.status||400,error.status?error.message:'Invalid workspace defaults');}}
      }
      if(path==='/api/admin/overview'&&req.method==='GET'){ const admin=requireAdmin(req,res); if(!admin)return; const users=db.prepare('SELECT * FROM users ORDER BY id').all().map(x=>({...userView(x),lastLoginAt:x.last_login_at,generationCount:db.prepare('SELECT COUNT(*) n FROM batches WHERE user_id=?').get(x.id).n})); return json(res,200,{users,invites:db.prepare('SELECT * FROM invites ORDER BY id DESC').all().map(inviteView),models:db.prepare('SELECT * FROM models').all().map(modelView),events:db.prepare('SELECT e.*,u.username FROM events e LEFT JOIN users u ON u.id=e.user_id ORDER BY e.id DESC LIMIT 500').all().map(x=>({id:x.id,username:x.username||null,action:x.action,createdAt:x.created_at,detail:x.detail}))}); }
      if(path==='/api/admin/models'&&req.method==='POST') {
        if(!requireAdmin(req,res))return;
        const body=await parseBody(req);
        if(typeof body.name!=='string'||!body.name.trim()||body.name.length>255||/[\x00-\x1f]/.test(body.name))return inputError(res,'Invalid model name');
        const name=body.name.trim();
        const backendName=body.filename===undefined?name:body.filename;
        if(typeof backendName!=='string'||!backendName.trim()||backendName.length>255||/[\x00-\x1f]/.test(backendName))return inputError(res,'Invalid model filename');
        const source=backendName.trim();
        const filename=/\.(safetensors|ckpt|pt|bin)$/i.test(source)?source:`${source}.safetensors`;
        const available=await capabilities(comfyUrl);
        if(!requireAdmin(req,res))return;
        const kind=available.checkpoints.includes(filename)?'checkpoint':'unet';
        const r=db.prepare('INSERT INTO models(name,kind,filename,clip_name,clip_type,vae_name) VALUES(?,?,?,?,?,?)')
          .run(name,kind,filename,kind==='unet'?'qwen3vl_4b_bf16.safetensors':null,kind==='unet'?'krea2':null,kind==='unet'?'qwen_image_vae.safetensors':null);
        return json(res,201,{model:modelView(db.prepare('SELECT * FROM models WHERE id=?').get(r.lastInsertRowid))});
      }

      const mm=/^\/api\/admin\/models\/(\d+)$/.exec(path); if(mm&&req.method==='PATCH'){ if(!requireAdmin(req,res))return; const b=await parseBody(req); if(b.enabled!==undefined&&typeof b.enabled!=='boolean'||b.name!==undefined&&(typeof b.name!=='string'||!b.name.trim()||b.name.length>100))return inputError(res,'Invalid model'); db.prepare('UPDATE models SET enabled=COALESCE(?,enabled),name=COALESCE(?,name) WHERE id=?').run(b.enabled===undefined?null:(b.enabled?1:0),b.name===undefined?null:b.name.trim(),mm[1]); const m=db.prepare('SELECT * FROM models WHERE id=?').get(mm[1]); return m?json(res,200,{model:modelView(m)}):err(res,404,'Model not found'); }
      if(mm&&req.method==='DELETE'){ if(!requireAdmin(req,res))return; const b=await parseBody(req); if(b.confirm!==true)return inputError(res,'Confirmation required'); const m=db.prepare('SELECT * FROM models WHERE id=?').get(mm[1]); if(!m)return err(res,404,'Model not found'); db.exec('BEGIN IMMEDIATE'); try { db.prepare('UPDATE batches SET model_id=NULL WHERE model_id=?').run(mm[1]); db.prepare('DELETE FROM models WHERE id=?').run(mm[1]); db.exec('COMMIT'); return json(res,200,{ok:true}); } catch(e){db.exec('ROLLBACK');return err(res,500,'Unable to remove model');} }
      if(path==='/api/admin/invites'&&req.method==='POST'){ if(!requireAdmin(req,res))return; const b=await parseBody(req); const count=Number(b.count??1); if(!Number.isInteger(count)||count<1||count>100)return inputError(res); const days=b.expiresInDays===null?null:Number(b.expiresInDays); if(days!==null&&![1,2,3,5,7].includes(days))return inputError(res); const out=[]; for(let i=0;i<count;i++){let code; do{code=token().slice(0,16)}while(db.prepare('SELECT 1 FROM invites WHERE code=?').get(code)); const exp=days===null?null:new Date(Date.now()+days*86400000).toISOString(); const r=db.prepare('INSERT INTO invites(code,created_at,expires_at) VALUES(?,?,?)').run(code,now(),exp);out.push(inviteView(db.prepare('SELECT * FROM invites WHERE id=?').get(r.lastInsertRowid)));} return json(res,201,{invites:out}); }
      const um=/^\/api\/admin\/users\/(\d+)$/.exec(path); if(um&&req.method==='PATCH'){ const a=requireAdmin(req,res); if(!a)return; if(Number(um[1])===a.id)return err(res,400,'Cannot disable yourself'); const b=await parseBody(req); if(typeof b.disabled!=='boolean')return inputError(res); db.exec('BEGIN IMMEDIATE'); try { db.prepare('UPDATE users SET disabled=? WHERE id=?').run(b.disabled?1:0,um[1]); if(b.disabled){ db.prepare('DELETE FROM sessions WHERE user_id=?').run(um[1]); db.prepare("UPDATE batches SET cancel_requested=1,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END WHERE user_id=? AND status IN ('queued','running')").run(um[1]); db.prepare("UPDATE generation_jobs SET status='cancelled' WHERE user_id=? AND status='queued'").run(um[1]); } db.exec('COMMIT'); } catch(e){db.exec('ROLLBACK');return err(res,500,'Unable to update user');} const x=db.prepare('SELECT * FROM users WHERE id=?').get(um[1]); return x?json(res,200,{user:publicUser(x)}):err(res,404,'User not found'); }
      if(req.method==='DELETE'&&path==='/api/history'){ const s=requireAuth(req,res); if(!s)return; const b=await parseBody(req); if(b.confirm!==true)return inputError(res,'Confirmation required'); if(isUserExporting(db,s.id))return err(res,409,'Wait for the image export to finish'); const active=db.prepare("SELECT 1 FROM batches WHERE user_id=? AND status IN ('queued','running') UNION SELECT 1 FROM generation_jobs WHERE user_id=? AND status IN ('queued','running') LIMIT 1").get(s.id,s.id); if(active)return err(res,409,'Active generations must finish or be cancelled first'); const imgs=db.prepare("SELECT i.path FROM images i JOIN batches b ON b.id=i.batch_id WHERE i.user_id=? AND b.status NOT IN ('queued','running')").all(s.id); db.exec('BEGIN IMMEDIATE'); try { db.prepare("DELETE FROM images WHERE user_id=? AND batch_id IN (SELECT id FROM batches WHERE status NOT IN ('queued','running'))").run(s.id); db.prepare("DELETE FROM generation_jobs WHERE user_id=? AND batch_id IN (SELECT id FROM batches WHERE status NOT IN ('queued','running'))").run(s.id); db.prepare("DELETE FROM batches WHERE user_id=? AND status NOT IN ('queued','running')").run(s.id); db.prepare("DELETE FROM tasks WHERE user_id=? AND id NOT IN (SELECT DISTINCT task_id FROM batches WHERE task_id IS NOT NULL)").run(s.id); db.exec('COMMIT'); for(const x of imgs){if(x.path.startsWith(imageDir+sep))try{unlinkSync(x.path)}catch{}} return json(res,200,{ok:true}); } catch(e){db.exec('ROLLBACK');return err(res,500,'Unable to clear history');} }
      return err(res,404,'Not found');
    } catch(e) { if(res.headersSent){res.destroy();return;}if(e.status){if(e.status===429)res.setHeader('Retry-After','60');return err(res,e.status,e.message);}if(e instanceof SyntaxError)return inputError(res,'Invalid JSON');return err(res,500,'Internal server error'); }
  }
  function staticFile(req,res){ let p=new URL(req.url,'http://localhost').pathname; if(p==='/'||p==='')p='/index.html'; const publicRoot=join(root,'public'); const file=join(publicRoot,p); if(p.split('/').some(part=>part.startsWith('.'))||!['.html','.js','.mjs','.css','.svg','.png','.jpg','.jpeg','.webp','.ico','.woff','.woff2'].includes(extname(file).toLowerCase())||!file.startsWith(publicRoot+sep)||!existsSync(file))return err(res,404,'Not found'); if(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()||!realpathSync(file).startsWith(realpathSync(publicRoot)+sep))return err(res,404,'Not found');const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}; res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream','content-security-policy':csp}); const stream=createReadStream(file); stream.on('error',()=>{if(!res.headersSent)err(res,404,'Not found');else res.destroy();}); stream.pipe(res); }
  handler.db=db; handler.close=async()=>{await worker.close();db.close();}; handler.tick=worker.tick; return handler;
}
function batchView(r,db){return taskBatchView(r,db);}
export { batchView };
