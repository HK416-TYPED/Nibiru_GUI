import { writeFileSync, renameSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {checkStorageQuota} from './storage-quota.mjs';
import {roundCapacity,updateImageEstimate} from './scheduling-policy.mjs';
import { comfyJson, submit, getHistory, download } from './comfy.mjs';

const definitelyNotSent = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH']);
const transient = error => Boolean(error?.code) || /socket|timed out|connection/i.test(error?.message || '');
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const safeSeed = (seed, offset = 0) => { const n = Number(seed); const base = Number.isSafeInteger(n) && n >= 0 ? BigInt(n) : 1n; return Number((base + BigInt(offset)) % (BigInt(MAX_SAFE)+1n)); };
function splitWorkflow(source, seed) { const wf = JSON.parse(source); for (const node of Object.values(wf)) { if (node.class_type === 'KSampler' && node.inputs) node.inputs.seed = seed; if (node.class_type === 'EmptyLatentImage' && node.inputs) node.inputs.batch_size = 1; } return wf; }

export function createWorker({ db, comfyUrl, imageDir, intervalMs = 1000, roundBudgetMs = 30000 }) {
  let working = null; let stopped = false;
  const stateRead = () => {
    const row=db.prepare("SELECT value FROM scheduler_state WHERE key='round'").get();
    try {const value=JSON.parse(row?.value||'{}');return {...value,interactiveStreak:Number(value.interactiveStreak)||0,lanes:value.lanes||{},cursor:Number(value.cursor)||0,pending:Array.isArray(value.pending)?value.pending.map(Number):[],startedAt:Number(value.startedAt)||0,admitted:value.admitted||0,estimatedImageMs:value.estimatedImageMs||10000,externalQueueDepth:value.externalQueueDepth||0};}
    catch{return {cursor:0,pending:[],startedAt:0,admitted:0,estimatedImageMs:10000,externalQueueDepth:0,lanes:{},interactiveStreak:0};}
  };
  const stateWrite = value => db.prepare("INSERT INTO scheduler_state(key,value) VALUES('round',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));
  const reconcileParent = batchId => { const jobs = db.prepare('SELECT status FROM generation_jobs WHERE batch_id=?').all(batchId); if (!jobs.length) return; const active = jobs.some(j => j.status === 'queued' || j.status === 'running'); const failed = jobs.some(j => j.status === 'failed'); const canceled = jobs.some(j => j.status === 'cancelled'); const status = active ? (jobs.some(j => j.status === 'running' || j.status !== 'queued') ? 'running' : 'queued') : failed ? 'failed' : canceled ? 'cancelled' : 'completed'; db.prepare("UPDATE batches SET status=?,error=CASE WHEN ?='failed' THEN COALESCE(error,?) ELSE error END WHERE id=?").run(status, status, failed ? 'One or more images failed' : null, batchId); };
  const mirrorBatch = (batchId, values) => { const keys = Object.keys(values); if (!keys.length) return; db.prepare(`UPDATE batches SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map(k => values[k]), batchId); };
  function materializeLegacy() {
    const legacy = db.prepare("SELECT * FROM batches WHERE status IN ('queued','running') AND NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.batch_id=batches.id)").all();
    const insert = db.prepare('INSERT OR IGNORE INTO generation_jobs(id,batch_id,user_id,image_index,seed,status,workflow,prompt_id,submitted,started_at,retry_count,error,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const batch of legacy) { let params = {}; try { params = JSON.parse(batch.params || '{}'); } catch {} const submitted = Boolean(batch.submitted || batch.prompt_id); const count = Math.max(1, Number(params.batchSize) || 1); const base = Number.isSafeInteger(Number(params.seed)) && Number(params.seed) >= 0 ? Number(params.seed) : 1; for (let i = 0; i < (submitted ? 1 : count); i++) { const seed = safeSeed(base, i); insert.run(randomUUID(), batch.id, batch.user_id, i, seed, submitted ? 'running' : 'queued', submitted ? batch.workflow : JSON.stringify(splitWorkflow(batch.workflow, seed)), submitted ? batch.prompt_id : null, submitted ? 1 : 0, submitted ? batch.created_at : null, Number(batch.retry_count) || 0, batch.error || null, batch.created_at); } }
  }
  const cancelUnavailable = () => { const rows = db.prepare("SELECT DISTINCT batch_id FROM generation_jobs WHERE status='queued' AND (EXISTS (SELECT 1 FROM users u WHERE u.id=generation_jobs.user_id AND u.disabled=1) OR EXISTS (SELECT 1 FROM batches b WHERE b.id=generation_jobs.batch_id AND b.cancel_requested=1) OR EXISTS (SELECT 1 FROM tasks t JOIN batches b ON b.task_id=t.id WHERE b.id=generation_jobs.batch_id AND t.cancel_requested=1))").all(); db.prepare("UPDATE generation_jobs SET status='cancelled',error=COALESCE(error,'Cancelled') WHERE status='queued' AND (EXISTS (SELECT 1 FROM users u WHERE u.id=generation_jobs.user_id AND u.disabled=1) OR EXISTS (SELECT 1 FROM batches b WHERE b.id=generation_jobs.batch_id AND b.cancel_requested=1) OR EXISTS (SELECT 1 FROM tasks t JOIN batches b ON b.task_id=t.id WHERE b.id=generation_jobs.batch_id AND t.cancel_requested=1))").run(); for (const row of rows) reconcileParent(row.batch_id); };
  const eligibleUsers = kind => db.prepare(`SELECT DISTINCT j.user_id FROM generation_jobs j JOIN users u ON u.id=j.user_id JOIN batches b ON b.id=j.batch_id LEFT JOIN tasks t ON t.id=b.task_id WHERE j.status='queued' AND u.disabled=0 AND b.cancel_requested=0 AND (t.id IS NULL OR t.cancel_requested=0) AND b.task_id IS ${kind==='interactive'?'NULL':'NOT NULL'} ORDER BY j.user_id`).all().map(x=>Number(x.user_id));
  async function pickJob() {
    const running=db.prepare("SELECT * FROM generation_jobs WHERE status='running' AND submitted=1 ORDER BY started_at,created_at LIMIT 1").get();
    if(running)return running;
    const interactive=eligibleUsers('interactive'),background=eligibleUsers('task');
    if(!interactive.length&&!background.length)return null;
    const state=stateRead();
    // Three interactive opportunities, then one background opportunity when both wait.
    // Each class maintains its own fair user cursor; admitted group size remains adaptive.
    const mixed=interactive.length>0&&background.length>0;
    const kind=interactive.length&&(!background.length||state.interactiveStreak<3)?'interactive':'task';
    const users=kind==='interactive'?interactive:background;
    const lane=state.lanes[kind]|| (kind==='interactive'?{cursor:state.cursor,pending:state.pending,startedAt:state.startedAt}:{cursor:0,pending:[],startedAt:0});
    let pending=(lane.pending||[]).filter(id=>users.includes(id));
    if(!pending.length||Date.now()-lane.startedAt>=roundBudgetMs){
      let queueDepth=state.externalQueueDepth;
      try{const queue=await comfyJson(comfyUrl,'/queue','GET');queueDepth=(queue.queue_running||[]).length+(queue.queue_pending||[]).length;}catch{}
      const capacity=roundCapacity({waitingUsers:users.length,estimatedImageMs:state.estimatedImageMs,externalQueueDepth:queueDepth,budgetMs:roundBudgetMs});
      const rotated=[...users.filter(id=>id>lane.cursor),...users.filter(id=>id<=lane.cursor)];
      pending=[...pending,...rotated.filter(id=>!pending.includes(id))].slice(0,capacity);
      lane.startedAt=Date.now();state.admitted=capacity;state.externalQueueDepth=queueDepth;
    }
    const userId=pending.shift();
    const job=db.prepare(`SELECT j.* FROM generation_jobs j JOIN batches b ON b.id=j.batch_id WHERE j.user_id=? AND j.status='queued' AND b.cancel_requested=0 AND b.task_id IS ${kind==='interactive'?'NULL':'NOT NULL'} ORDER BY b.rowid,j.image_index LIMIT 1`).get(userId);
    if(!job)return null;
    lane.cursor=userId;lane.pending=pending;state.lanes[kind]=lane;
    state.cursor=userId;state.pending=pending;state.startedAt=lane.startedAt;state.lastClass=kind;
    state.interactiveStreak=mixed&&kind==='interactive'?state.interactiveStreak+1:0;
    stateWrite(state);
    db.prepare("UPDATE generation_jobs SET status='running',started_at=COALESCE(started_at,?) WHERE id=?").run(new Date().toISOString(),job.id);
    db.prepare("UPDATE batches SET status='running',started_at=COALESCE(started_at,?) WHERE id=? AND status='queued'").run(new Date().toISOString(),job.batch_id);
    return db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(job.id);
  }
  async function saveImages(job, descriptors) {
    const pending = []; try { for (let i = 0; i < descriptors.length; i++) { const imageIndex = Number(job.image_index) + i; if (db.prepare('SELECT 1 FROM images WHERE job_id=? AND image_index=?').get(job.id, imageIndex)) continue; const descriptor = descriptors[i]; const bytes = await download(comfyUrl, descriptor); checkStorageQuota(db,job.user_id,bytes.length+pending.reduce((sum,item)=>sum+item.byteSize,0),imageDir); const imageId = randomUUID(); const ext = extname(descriptor.filename || 'image.png').toLowerCase(); const suffix = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png'; const path = join(imageDir, imageId + suffix); writeFileSync(path + '.partial', bytes, { mode: 0o600 }); renameSync(path + '.partial', path); pending.push({ imageId, path, descriptor, imageIndex, byteSize:bytes.length }); } db.exec('BEGIN IMMEDIATE'); try { for (const x of pending) db.prepare('INSERT OR IGNORE INTO images(id,batch_id,user_id,job_id,image_index,path,filename,subfolder,type,created_at,byte_size) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(x.imageId, job.batch_id, job.user_id, job.id, x.imageIndex, x.path, x.descriptor.filename || null, x.descriptor.subfolder || '', x.descriptor.type || 'output', new Date().toISOString(), x.byteSize); db.prepare("UPDATE generation_jobs SET status='completed',error=NULL WHERE id=?").run(job.id); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } } catch (error) { for (const x of pending) rmSync(x.path, { force: true }); throw error; }
  }
  async function process(job) {
    if(!job.submitted){
      const allowed=db.prepare("SELECT 1 FROM generation_jobs j JOIN users u ON j.user_id=u.id JOIN batches b ON j.batch_id=b.id LEFT JOIN tasks t ON b.task_id=t.id WHERE j.id=? AND j.status IN ('queued','running') AND u.disabled=0 AND b.cancel_requested=0 AND (t.id IS NULL OR t.cancel_requested=0)").get(job.id);
      if(!allowed){db.prepare("UPDATE generation_jobs SET status='cancelled' WHERE id=? AND submitted=0").run(job.id);reconcileParent(job.batch_id);return;}
    }

    const start = Date.parse(job.started_at || job.created_at) || Date.now();
    if (!job.submitted) { const promptId = job.prompt_id || randomUUID(); db.prepare("UPDATE generation_jobs SET submitted=1,prompt_id=?,status='running',started_at=COALESCE(started_at,?) WHERE id=?").run(promptId, new Date().toISOString(), job.id); mirrorBatch(job.batch_id, { submitted: 1, prompt_id: promptId, status: 'running', started_at: new Date().toISOString() }); try { const response = await submit(comfyUrl, JSON.parse(job.workflow), promptId); if (!response.prompt_id) throw new Error('ComfyUI did not acknowledge the prompt'); db.prepare('UPDATE generation_jobs SET prompt_id=?,error=NULL,retry_count=0 WHERE id=?').run(response.prompt_id, job.id); mirrorBatch(job.batch_id, { prompt_id: response.prompt_id }); job.prompt_id = response.prompt_id; } catch (error) { const current = db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(job.id); if (definitelyNotSent.has(error.code) && current.retry_count < 20) { db.prepare("UPDATE generation_jobs SET submitted=0,status='queued',retry_count=retry_count+1,error=? WHERE id=?").run('Waiting for ComfyUI connection', job.id); mirrorBatch(job.batch_id, { submitted: 0, status: 'queued' }); } else if (transient(error) && current.retry_count < 20) db.prepare("UPDATE generation_jobs SET error=?,retry_count=retry_count+1 WHERE id=?").run('Checking whether ComfyUI accepted the request', job.id); else db.prepare("UPDATE generation_jobs SET status='failed',error=? WHERE id=?").run(error.message.startsWith('ComfyUI') ? error.message : 'ComfyUI submission failed', job.id); reconcileParent(job.batch_id); return; } }
    const current = db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(job.id); try { const history = await getHistory(comfyUrl, current.prompt_id); const item = history[current.prompt_id]; if (item?.status?.status_str === 'error') throw new Error('ComfyUI generation failed. Check the model configuration.'); if (Date.now() - start > 30 * 60 * 1000) throw new Error('ComfyUI generation exceeded the 30-minute limit'); if (!item || item.status?.completed === false || !item.outputs) { if (item?.status?.completed === true) throw new Error('ComfyUI generation produced no images'); if (Date.now() - start > 120000) { const queue = await comfyJson(comfyUrl, '/queue', 'GET'); const queued = [...(queue.queue_running || []), ...(queue.queue_pending || [])].some(row => row[1] === current.prompt_id); if (!queued) throw new Error('ComfyUI no longer has this request. Load its settings to try again.'); } return; } const descriptors = Object.values(item.outputs).flatMap(node => node.images || []); if (!descriptors.length) throw new Error('ComfyUI generation produced no images'); const existing = db.prepare('SELECT COUNT(*) n FROM images WHERE job_id=?').get(current.id).n; if (existing < descriptors.length) await saveImages(current, descriptors); else db.prepare("UPDATE generation_jobs SET status='completed',error=NULL WHERE id=?").run(current.id); reconcileParent(current.batch_id); } catch (error) { const retry = db.prepare('SELECT retry_count FROM generation_jobs WHERE id=?').get(current.id)?.retry_count || 0; if (transient(error) && retry < 20) db.prepare("UPDATE generation_jobs SET retry_count=retry_count+1,error=? WHERE id=?").run('Temporary ComfyUI connection error', current.id); else db.prepare("UPDATE generation_jobs SET status='failed',error=? WHERE id=?").run(error.status?error.message:error.message.startsWith('ComfyUI') ? error.message : 'Generation failed', current.id); reconcileParent(current.batch_id); }
  }
  async function tick() { if (stopped) return; if (working) return working; working = (async () => { materializeLegacy(); db.prepare("UPDATE generation_jobs SET status='queued' WHERE status='running' AND submitted=0").run(); cancelUnavailable(); const job = await pickJob(); if (job) { await process(job); const final=db.prepare('SELECT status,started_at FROM generation_jobs WHERE id=?').get(job.id); if(final?.status==='completed'){const state=stateRead();state.estimatedImageMs=updateImageEstimate(state.estimatedImageMs,Date.now()-Date.parse(final.started_at));stateWrite(state);} } })(); try { await working; } finally { working = null; } }
  const timer = setInterval(() => tick().catch(() => {}), intervalMs); timer.unref(); return { tick, async close() { stopped = true; clearInterval(timer); if (working) await working; } };
}
