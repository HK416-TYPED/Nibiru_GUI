import {randomUUID,randomInt} from 'node:crypto';
import {checkStorageQuota} from './storage-quota.mjs';
import {now} from './db.mjs';
import {makeWorkflow} from './comfy.mjs';
import {validatePresetParams} from './presets.mjs';

function invalid(message,status=400){const error=new Error(message);error.status=status;throw error;}
export function parsePrompts(text,mode='lines'){
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>1_000_000||!['lines','paragraphs'].includes(mode))invalid('Invalid TXT file');
  const clean=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const prompts=(mode==='lines'?clean.split('\n'):clean.split(/\n\s*\n/)).map(p=>p.trim()).filter(Boolean);
  if(!prompts.length||prompts.length>128||prompts.some(p=>p.length>16384))invalid('TXT must contain 1–128 prompts, each no longer than 16384 characters');
  return prompts;
}
export function normalizeParams(body={}){
  const params={prompt:body.prompt??'',negativePrompt:body.negativePrompt??'',modelId:body.modelId==null||body.modelId===''?null:Number(body.modelId),batchSize:Number(body.batchSize??1),repeat:Number(body.repeat??1),width:Number(body.width??1024),height:Number(body.height??1024),steps:Number(body.steps??8),cfg:Number(body.cfg??1),sampler:body.sampler||'euler',scheduler:body.scheduler||'simple',seed:Number(body.seed??-1),denoise:Number(body.denoise??1)};
  if(!validatePresetParams(params))invalid('Invalid generation parameters');
  return params;
}
function checkQuota(db,userId,additional){
  checkStorageQuota(db,userId);
  const count=db.prepare("SELECT COUNT(*) n FROM generation_jobs WHERE user_id=? AND status IN ('queued','running')").get(userId).n;
  if(additional>4096||count+additional>4096)invalid('At most 4096 pending images per account',429);
}
export function taskBatchView(row,db){
  const images=db.prepare('SELECT i.id,i.image_index,j.seed FROM images i LEFT JOIN generation_jobs j ON i.job_id=j.id WHERE i.batch_id=? ORDER BY i.image_index,i.created_at,i.rowid').all(row.id).map(i=>({id:i.id,imageIndex:i.image_index,seed:i.seed,url:`/api/images/${i.id}`}));
  return {id:row.id,taskId:row.task_id||null,createdAt:row.created_at,status:row.status,prompt:row.prompt,negativePrompt:row.negative_prompt,modelName:row.model_name,params:JSON.parse(row.params),images,error:row.error||undefined,promptId:row.prompt_id||undefined};
}
function insertBatches({db,user,model,template,params,prompts,taskId=null}){
  const result=[];
  for(const prompt of prompts){
    for(let rep=0;rep<params.repeat;rep++){
      const seed=params.seed<0?randomInt(1,2147483647):Number((BigInt(params.seed)+BigInt(rep*params.batchSize))%(BigInt(Number.MAX_SAFE_INTEGER)+1n));
      const actual={...params,prompt,modelId:model.id,seed};
      const batchId=randomUUID();
      const workflow=makeWorkflow(template,model,{...actual,batchSize:1});
      db.prepare('INSERT INTO batches(id,user_id,task_id,created_at,status,prompt,negative_prompt,model_id,model_name,params,workflow) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(batchId,user.id,taskId,now(),'queued',prompt,params.negativePrompt,model.id,model.name,JSON.stringify(actual),JSON.stringify(workflow));
      for(let ix=0;ix<params.batchSize;ix++){
        const jobSeed=Number((BigInt(seed)+BigInt(ix))%(BigInt(Number.MAX_SAFE_INTEGER)+1n));
        const snapshot=makeWorkflow(template,model,{...actual,seed:jobSeed,batchSize:1});
        db.prepare('INSERT INTO generation_jobs(id,batch_id,user_id,image_index,seed,workflow,created_at) VALUES(?,?,?,?,?,?,?)')
          .run(randomUUID(),batchId,user.id,ix,jobSeed,JSON.stringify(snapshot),now());
      }
      result.push(taskBatchView(db.prepare('SELECT * FROM batches WHERE id=?').get(batchId),db));
    }
  }
  return result;
}
export function enqueueBatches({db,user,model,template,params}){
  params=normalizeParams(params);
  if(!params.prompt.trim())invalid('Prompt is required');
  db.exec('BEGIN IMMEDIATE');
  try{checkQuota(db,user.id,params.batchSize*params.repeat);const batches=insertBatches({db,user,model,template,params,prompts:[params.prompt]});db.exec('COMMIT');return batches;}
  catch(error){db.exec('ROLLBACK');throw error;}
}
export function taskView(db,row){
  const batches=db.prepare('SELECT * FROM batches WHERE task_id=? ORDER BY rowid').all(row.id).map(b=>taskBatchView(b,db));
  const jobs=db.prepare('SELECT j.status,COUNT(*) n FROM generation_jobs j JOIN batches b ON j.batch_id=b.id WHERE b.task_id=? GROUP BY j.status').all(row.id);
  const counts=Object.fromEntries(jobs.map(j=>[j.status,j.n]));
  const totalImages=batches.reduce((total,b)=>total+b.params.batchSize,0);
  const completedImages=batches.reduce((total,b)=>total+b.images.length,0);
  let status='queued';
  if(counts.running)status=row.cancel_requested?'cancelling':'running';
  else if(counts.queued)status=completedImages?'running':'queued';
  else if(counts.failed)status='failed';
  else if(row.cancel_requested||counts.cancelled)status='cancelled';
  else if(completedImages+(counts.deleted||0)>=totalImages)status='completed';
  return {id:row.id,name:row.name,createdAt:row.created_at,status,totalImages,completedImages,failedImages:counts.failed||0,deletedImages:counts.deleted||0,cancelledImages:counts.cancelled||0,batches};
}
export async function handleTasks({req,res,path,user,db,json,err,parseBody,template,modelRows}){
  try{
    if(path==='/api/tasks'&&req.method==='GET')return json(res,200,{tasks:db.prepare('SELECT * FROM tasks WHERE user_id=? ORDER BY created_at DESC,rowid DESC').all(user.id).map(row=>taskView(db,row))});
    if(path==='/api/tasks'&&req.method==='POST'){
      const body=await parseBody(req);
      const prompts=parsePrompts(body.text,body.parseMode||'lines');
      if(typeof body.name!=='string'||!body.name.trim()||body.name.length>120)invalid('A task name is required (max 120 characters)');
      if(body.params?.repeat!==undefined&&Number(body.params.repeat)!==1)invalid('Task repeat must be 1');
      const params=normalizeParams({...body.params,prompt:'',repeat:1});
      const model=params.modelId==null?modelRows[0]:modelRows.find(m=>m.id===params.modelId);
      if(!model)invalid('Unknown or disabled model');
      if(body.requestKey!==undefined&&(typeof body.requestKey!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestKey)))invalid('Invalid request key');
      if(body.requestKey){
        const existing=db.prepare('SELECT * FROM tasks WHERE user_id=? AND request_key=?').get(user.id,body.requestKey);
        if(existing){const stored=JSON.parse(existing.params);if(existing.name!==body.name.trim()||JSON.stringify(stored.prompts)!==JSON.stringify(prompts)||JSON.stringify(stored.params)!==JSON.stringify(params))invalid('This request key belongs to another task',409);return json(res,200,{task:taskView(db,existing)});}
      }
      const taskId=randomUUID();
      db.exec('BEGIN IMMEDIATE');
      try{
        checkQuota(db,user.id,prompts.length*params.batchSize*params.repeat);
        db.prepare('INSERT INTO tasks(id,user_id,name,created_at,params,request_key) VALUES(?,?,?,?,?,?)').run(taskId,user.id,body.name.trim(),now(),JSON.stringify({params,prompts,parseMode:body.parseMode||'lines'}),body.requestKey||null);
        insertBatches({db,user,model,template,params,prompts,taskId});db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      return json(res,202,{task:taskView(db,db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId))});
    }
    const cancel=/^\/api\/tasks\/([^/]+)\/cancel$/.exec(path);
    if(cancel&&req.method==='POST'){
      const row=db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(cancel[1],user.id);
      if(!row)return err(res,404,'Task not found');
      db.exec('BEGIN IMMEDIATE');
      try{
        db.prepare('UPDATE tasks SET cancel_requested=1 WHERE id=?').run(row.id);
        db.prepare("UPDATE generation_jobs SET status='cancelled' WHERE batch_id IN (SELECT id FROM batches WHERE task_id=?) AND status IN ('queued','running') AND submitted=0").run(row.id);
        db.prepare("UPDATE batches SET cancel_requested=1,status=CASE WHEN EXISTS(SELECT 1 FROM generation_jobs j WHERE j.batch_id=batches.id AND j.status='running') THEN 'running' WHEN status='completed' THEN 'completed' ELSE 'cancelled' END WHERE task_id=?").run(row.id);
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      return json(res,200,{task:taskView(db,db.prepare('SELECT * FROM tasks WHERE id=?').get(row.id))});
    }
    const one=/^\/api\/tasks\/([^/]+)$/.exec(path);
    if(one&&req.method==='GET'){const row=db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(one[1],user.id);return row?json(res,200,{task:taskView(db,row)}):err(res,404,'Task not found');}
    return false;
  }catch(error){return err(res,error.status||400,error.status?error.message:'Invalid task request');}
}
