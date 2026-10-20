import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from '../server/index.mjs';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
async function fakeComfy({ failFirst = false, port = 0 } = {}) {
  const state = { prompts: [], histories: new Map(), failFirst };
  const server = createHttpServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    if (req.method === 'POST' && req.url === '/prompt') {
      const payload = JSON.parse(Buffer.concat(chunks)); const id = payload.prompt_id || `p-${state.prompts.length}`;
      state.prompts.push({ id, payload });
      state.histories.set(id, state.failFirst && state.prompts.length === 1
        ? { status: { status_str: 'error', completed: true }, outputs: {} }
        : { status: { status_str: 'success', completed: true }, outputs: { node: { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] } } });
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ prompt_id: id }));
    }
    const history = /^\/history\/(.+)$/.exec(req.url);
    if (history) { const id = decodeURIComponent(history[1]); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ [id]: state.histories.get(id) || null })); }
    if (req.url.startsWith('/view?')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
    if (req.url === '/queue') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ queue_running: [], queue_pending: [] })); }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { state, port: server.address().port, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
async function fixture(comfyUrl, dir) {
  const dataDir = dir || await mkdtemp(join(tmpdir(), 'nibiru-scheduler-'));
  const server = createServer({setupToken:'test-only-init-token-not-for-production-32', dataDir, workerInterval: 100000, comfyUrl }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, init = {}) => { const headers = new Headers(init.headers);headers.set('x-nibiru-setup-token','test-only-init-token-not-for-production-32'); if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json'); const r = await fetch(base + path, { ...init, headers }); return { status: r.status, body: await r.json(), headers: r.headers }; };
  const close = async () => { server.app.close(); await new Promise(resolve => server.close(resolve)); if (!dir) await rm(dataDir, { recursive: true, force: true }); };
  return { server, dataDir, call, close };
}
const b = x => JSON.stringify(x); const cookie = r => r.headers.get('set-cookie')?.split(';', 1)[0] || '';
async function users(f, count) {
  const a = await f.call('/api/setup', { method: 'POST', body: b({ username: 'admin', password: 'password1', confirmPassword: 'password1' }) }); const admin = cookie(a); const out = [];
  for (let i = 0; i < count; i++) { const code = (await f.call('/api/admin/invites', { method: 'POST', headers: { cookie: admin }, body: b({ expiresInDays: null }) })).body.invites[0].code; out.push(cookie(await f.call('/api/auth/register', { method: 'POST', body: b({ username: `u${i}`, password: 'password1', confirmPassword: 'password1', inviteCode: code }) }))); }
  return { admin, users: out };
}
const generation = { prompt: 'scheduler', batchSize: 8, repeat: 1, width: 512, height: 512, steps: 8, cfg: 1, sampler: 'euler', scheduler: 'simple', seed: 100, denoise: 1 };
async function enqueue(f, userCookie) { const r = await f.call('/api/generations', { method: 'POST', headers: { cookie: userCookie }, body: b(generation) }); assert.equal(r.status, 202); return r.body.batches[0].id; }
function submittedUsers(f, comfy) { return comfy.state.prompts.map(p => f.server.app.db.prepare('SELECT user_id FROM generation_jobs WHERE prompt_id=?').get(p.id)?.user_id); }

test('round-robin scheduler serves three users A,B,C,A,B,C without duplicate submissions', async () => {
  const comfy = await fakeComfy(); const f = await fixture(comfy.url);
  try { const { users: us } = await users(f, 3); for (const u of us) await enqueue(f, u); const ids = us.map((_, i) => i + 2); for (let i = 0; i < 6; i++) await f.server.app.tick(); assert.deepEqual(submittedUsers(f, comfy), [...ids, ...ids]); } finally { await f.close(); await comfy.close(); }
});

test('five users each receive service before the first user gets a second job', async () => {
  const comfy = await fakeComfy(); const f = await fixture(comfy.url);
  try { const { users: us } = await users(f, 5); for (const u of us) await enqueue(f, u); for (let i = 0; i < 6; i++) await f.server.app.tick(); const ids = submittedUsers(f, comfy); assert.deepEqual(ids.slice(0, 5), [2, 3, 4, 5, 6]); assert.equal(ids[5], 2); } finally { await f.close(); await comfy.close(); }
});

test('scheduler round state survives worker restart and resumes at the next user', async () => {
  const comfy = await fakeComfy(); const dir = await mkdtemp(join(tmpdir(), 'nibiru-restart-')); const first = await fixture(comfy.url, dir);
  try { const { users: us } = await users(first, 3); for (const u of us) await enqueue(first, u); await first.server.app.tick(); assert.deepEqual(submittedUsers(first, comfy), [2]); await first.close(); const second = await fixture(comfy.url, dir); try { await second.server.app.tick(); assert.deepEqual(submittedUsers(second, comfy), [2, 3]); } finally { await second.close(); } } finally { await comfy.close(); await rm(dir, { recursive: true, force: true }); }
});

test('disabled users are skipped and their queued jobs cancel to a terminal parent', async () => {
  const comfy = await fakeComfy(); const f = await fixture(comfy.url);
  try { const { admin, users: us } = await users(f, 3); const disabledBatch = await enqueue(f, us[1]); await enqueue(f, us[0]); const uid = f.server.app.db.prepare('SELECT id FROM users WHERE username=?').get('u1').id; const r = await f.call(`/api/admin/users/${uid}`, { method: 'PATCH', headers: { cookie: admin }, body: b({ disabled: true }) }); assert.equal(r.status, 200); await f.server.app.tick(); assert.equal(f.server.app.db.prepare('SELECT status FROM batches WHERE id=?').get(disabledBatch).status, 'cancelled'); assert.equal(f.server.app.db.prepare("SELECT COUNT(*) n FROM generation_jobs WHERE user_id=? AND status='completed'").get(uid).n, 0); } finally { await f.close(); await comfy.close(); }
});

test('a failed job does not starve another user', async () => {
  const comfy = await fakeComfy({ failFirst: true }); const f = await fixture(comfy.url);
  try { const { users: us } = await users(f, 2); await enqueue(f, us[0]); await enqueue(f, us[1]); for (let i = 0; i < 3; i++) await f.server.app.tick(); const rows = f.server.app.db.prepare('SELECT user_id,status FROM generation_jobs ORDER BY rowid').all(); assert.equal(rows[0].status, 'failed'); assert.ok(rows.slice(8).some(x => x.status === 'completed')); assert.equal(comfy.state.prompts.length, 3); } finally { await f.close(); await comfy.close(); }
});

test('soft 30-second round window rotates remaining users instead of monopolizing a group', async () => {
  const comfy = await fakeComfy(); const f = await fixture(comfy.url);
  try { const { users: us } = await users(f, 5); for (const u of us) await enqueue(f, u); await f.server.app.tick(); const state = JSON.parse(f.server.app.db.prepare("SELECT value FROM scheduler_state WHERE key='round'").get().value); state.startedAt = Date.now() - 31000; f.server.app.db.prepare("UPDATE scheduler_state SET value=? WHERE key='round'").run(JSON.stringify(state)); await f.server.app.tick(); assert.deepEqual(submittedUsers(f, comfy).slice(0, 2), [2, 3]); } finally { await f.close(); await comfy.close(); }
});

test('batch jobs persist unique image indexes and seeds without duplicate files after restart', async () => {
  const comfy = await fakeComfy(); const dir = await mkdtemp(join(tmpdir(), 'nibiru-images-')); const first = await fixture(comfy.url, dir);
  try { const { users: us } = await users(first, 1); const batchId = await enqueue(first, us[0]); for (let i = 0; i < 8; i++) await first.server.app.tick(); const before = first.server.app.db.prepare('SELECT i.image_index,j.seed,i.path FROM images i JOIN generation_jobs j ON i.job_id=j.id WHERE i.batch_id=? ORDER BY i.image_index').all(batchId); assert.deepEqual(before.map(x => x.image_index), [0, 1, 2, 3, 4, 5, 6, 7]); assert.equal(new Set(before.map(x => x.seed)).size, 8); assert.ok(before.every(x => exists(x.path))); await first.close(); const second = await fixture(comfy.url, dir); try { await second.server.app.tick(); const after = second.server.app.db.prepare('SELECT image_index,path FROM images WHERE batch_id=? ORDER BY image_index').all(batchId); assert.equal(after.length, 8); assert.deepEqual(after.map(x => x.path), before.map(x => x.path)); assert.equal(comfy.state.prompts.length, 8); } finally { await second.close(); } } finally { await comfy.close(); await rm(dir, { recursive: true, force: true }); }
});
function exists(path) { try { return Boolean(requireExists(path)); } catch { return false; } }
import { existsSync as requireExists } from 'node:fs';

test('live scheduler changes admission count when measured load changes without resetting fair order',async()=>{
  const comfy=await fakeComfy();const f=await fixture(comfy.url);
  try{
    const {users:us}=await users(f,5);for(const u of us)await enqueue(f,u);
    f.server.app.db.prepare("INSERT INTO scheduler_state(key,value) VALUES('round',?)").run(JSON.stringify({cursor:0,pending:[],startedAt:0,estimatedImageMs:3000}));
    await f.server.app.tick();
    let state=JSON.parse(f.server.app.db.prepare("SELECT value FROM scheduler_state WHERE key='round'").get().value);
    assert.equal(state.admitted,5);
    state.startedAt=Date.now()-31000;if(state.lanes?.interactive)state.lanes.interactive.startedAt=state.startedAt;state.estimatedImageMs=20000;
    f.server.app.db.prepare("UPDATE scheduler_state SET value=? WHERE key='round'").run(JSON.stringify(state));
    await f.server.app.tick();
    state=JSON.parse(f.server.app.db.prepare("SELECT value FROM scheduler_state WHERE key='round'").get().value);
    assert.equal(state.admitted,1);
    assert.deepEqual(submittedUsers(f,comfy),[2,3]);
  }finally{await f.close();await comfy.close();}
});

test('a crash after admission but before submission recovers without stranding a job',async()=>{
  const comfy=await fakeComfy();const f=await fixture(comfy.url);try{
    const {users:us}=await users(f,1);const batchId=await enqueue(f,us[0]);
    f.server.app.db.prepare("UPDATE generation_jobs SET status='running',submitted=0 WHERE batch_id=? AND image_index=0").run(batchId);
    await f.server.app.tick();assert.equal(comfy.state.prompts.length,1);
    assert.equal(f.server.app.db.prepare("SELECT status FROM generation_jobs WHERE batch_id=? AND image_index=0").get(batchId).status,'completed');
  }finally{await f.close();await comfy.close();}
});

async function enqueueTask(f,userCookie){
  const result=await f.call('/api/tasks',{method:'POST',headers:{cookie:userCookie},body:b({name:'background',text:'bulk',params:{...generation,repeat:1}})});
  assert.equal(result.status,202);return result.body.task.id;
}
function submittedKinds(f,comfy){return comfy.state.prompts.map(p=>f.server.app.db.prepare('SELECT b.task_id FROM generation_jobs j JOIN batches b ON b.id=j.batch_id WHERE j.prompt_id=?').get(p.id).task_id?'task':'generate');}
test('interactive generation takes priority over older batch tasks with a reserved background turn',async()=>{
  const comfy=await fakeComfy();const f=await fixture(comfy.url);try{
    const {users:us}=await users(f,2);await enqueueTask(f,us[0]);await enqueue(f,us[1]);
    for(let i=0;i<8;i++)await f.server.app.tick();
    assert.deepEqual(submittedKinds(f,comfy),['generate','generate','generate','task','generate','generate','generate','task']);
  }finally{await f.close();await comfy.close();}
});
test('a user can submit interactive work ahead of their own existing task',async()=>{
  const comfy=await fakeComfy();const f=await fixture(comfy.url);try{
    const {users:us}=await users(f,1);await enqueueTask(f,us[0]);await enqueue(f,us[0]);
    await f.server.app.tick();assert.deepEqual(submittedKinds(f,comfy),['generate']);
  }finally{await f.close();await comfy.close();}
});
test('users still rotate fairly inside interactive priority while task work keeps advancing',async()=>{
  const comfy=await fakeComfy();const f=await fixture(comfy.url);try{
    const {users:us}=await users(f,3);await enqueueTask(f,us[2]);await enqueue(f,us[0]);await enqueue(f,us[1]);
    for(let i=0;i<8;i++)await f.server.app.tick();
    assert.deepEqual(submittedUsers(f,comfy),[2,3,2,4,3,2,3,4]);
  }finally{await f.close();await comfy.close();}
});

test('priority service share survives restart so batch tasks do not lose their reserved turn',async()=>{
  const comfy=await fakeComfy();const dir=await mkdtemp(join(tmpdir(),'nibiru-priority-'));const first=await fixture(comfy.url,dir);
  try{
    const {users:us}=await users(first,2);await enqueueTask(first,us[0]);await enqueue(first,us[1]);
    for(let i=0;i<3;i++)await first.server.app.tick();await first.close();
    const second=await fixture(comfy.url,dir);try{await second.server.app.tick();assert.deepEqual(submittedKinds(second,comfy),['generate','generate','generate','task']);}finally{await second.close();}
  }finally{await comfy.close();await rm(dir,{recursive:true,force:true});}
});
test('an already running task image completes before interactive priority is applied',async()=>{
  const comfy=await fakeComfy();const f=await fixture(comfy.url);try{
    const {users:us}=await users(f,2);const taskId=await enqueueTask(f,us[0]);
    const job=f.server.app.db.prepare('SELECT j.* FROM generation_jobs j JOIN batches b ON j.batch_id=b.id WHERE b.task_id=? ORDER BY j.image_index LIMIT 1').get(taskId);
    f.server.app.db.prepare("UPDATE generation_jobs SET status='running',submitted=1,prompt_id='already-running',started_at=? WHERE id=?").run(new Date().toISOString(),job.id);
    comfy.state.histories.set('already-running',{status:{completed:false}});await enqueue(f,us[1]);
    await f.server.app.tick();assert.equal(comfy.state.prompts.length,0);
    comfy.state.histories.set('already-running',{status:{completed:true},outputs:{node:{images:[{filename:'done.png',type:'output',subfolder:''}]}}});
    await f.server.app.tick();assert.equal(comfy.state.prompts.length,0);
    await f.server.app.tick();assert.deepEqual(submittedKinds(f,comfy),['generate']);
  }finally{await f.close();await comfy.close();}
});
