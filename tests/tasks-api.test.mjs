import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server/index.mjs';

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'nibiru-tasks-'));
  const server = createServer({setupToken:'test-only-init-token-not-for-production-32', dataDir, workerInterval: 100000, comfyUrl: 'http://127.0.0.1:1' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, init = {}) => {
    const headers = new Headers(init.headers);headers.set('x-nibiru-setup-token','test-only-init-token-not-for-production-32');
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const r = await fetch(base + path, { ...init, headers });
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  const close = async () => { server.app.close(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); };
  return { server, call, close };
}
const body = x => JSON.stringify(x);
const jar = r => r.headers.get('set-cookie')?.split(';', 1)[0] || '';
async function bootstrap(f) {
  const a = await f.call('/api/setup', { method: 'POST', body: body({ username: 'admin', password: 'password1', confirmPassword: 'password1' }) });
  assert.equal(a.status, 201);
  const code = (await f.call('/api/admin/invites', { method: 'POST', headers: { cookie: jar(a) }, body: body({ expiresInDays: null }) })).body.invites[0].code;
  const u = await f.call('/api/auth/register', { method: 'POST', body: body({ username: 'user1', password: 'password1', confirmPassword: 'password1', inviteCode: code }) });
  assert.equal(u.status, 201);
  return jar(u);
}
const params = (extra = {}) => ({ prompt: '', negativePrompt: '', batchSize: 1, repeat: 1, width: 512, height: 512, steps: 8, cfg: 1, sampler: 'euler', scheduler: 'simple', seed: 1, denoise: 1, ...extra });

test('imports BOM CRLF lines and paragraphs while rejecting empty and oversized text', async () => {
  const f = await fixture();
  try {
    const user = await bootstrap(f);
    const lines = await f.call('/api/tasks', { method: 'POST', headers: { cookie: user }, body: body({ name: 'lines', text: '\uFEFFone\r\ntwo\r\n\r\nthree', parseMode: 'lines', params: params() }) });
    assert.equal(lines.status, 202);
    assert.equal(lines.body.task.totalImages, 3);
    const paragraphs = await f.call('/api/tasks', { method: 'POST', headers: { cookie: user }, body: body({ name: 'paragraphs', text: '\uFEFFone\r\nline\r\n\r\ntwo\r\n\r\nthree', parseMode: 'paragraphs', params: params() }) });
    assert.equal(paragraphs.status, 202);
    assert.equal(paragraphs.body.task.batches.length, 3);
    const empty = await f.call('/api/tasks', { method: 'POST', headers: { cookie: user }, body: body({ name: 'empty', text: '\uFEFF\r\n\r\n', parseMode: 'lines', params: params() }) });
    assert.equal(empty.status, 400);
    const tooMany = await f.call('/api/tasks', { method: 'POST', headers: { cookie: user }, body: body({ name: 'too many', text: Array.from({ length: 129 }, (_, i) => `p${i}`).join('\n'), parseMode: 'lines', params: params() }) });
    assert.equal(tooMany.status, 400);
  } finally { await f.close(); }
});

test('accepts two prompts times batch eight with one repetition as 16 single-image jobs', async () => {
  const f = await fixture();
  try {
    const user = await bootstrap(f);
    const r = await f.call('/api/tasks', { method: 'POST', headers: { cookie: user }, body: body({ name: 'large', text: 'one\ntwo', parseMode: 'lines', params: params({ batchSize: 8, repeat: 1 }) }) });
    assert.equal(r.status, 202);
    assert.equal(r.body.task.totalImages, 16);
    assert.equal(f.server.app.db.prepare('SELECT COUNT(*) n FROM generation_jobs WHERE user_id=2').get().n, 16);
    assert.ok(r.body.task.batches.every(x => x.params.batchSize === 8 && x.images.length === 0));
    const badBatch = await f.call('/api/tasks', { method: 'POST', headers: { cookie: user }, body: body({ name: 'bad-batch', text: 'p', parseMode: 'lines', params: params({ batchSize: 3 }) }) });
    assert.equal(badBatch.status, 400);
    const badRepeat = await f.call('/api/tasks', { method: 'POST', headers: { cookie: user }, body: body({ name: 'bad-repeat', text: 'p', parseMode: 'lines', params: params({ repeat: 33 }) }) });
    assert.equal(badRepeat.status, 400);
  } finally { await f.close(); }
});

test('task image totals count batch size once and do not multiply repeat twice', async () => {
  const f = await fixture();
  try {
    const user = await bootstrap(f);
    const r = await f.call('/api/tasks', { method: 'POST', headers: { cookie: user }, body: body({ name: 'count', text: 'p', parseMode: 'lines', params: params({ batchSize: 4, repeat: 1 }) }) });
    assert.equal(r.status, 202);
    assert.equal(r.body.task.totalImages, 4);
    assert.equal(r.body.task.batches.length, 1);
  } finally { await f.close(); }
});

test('isolates task lists and allows cancellation of pending jobs without cancelling a running job', async () => {
  const f = await fixture();
  try {
    const admin = await f.call('/api/setup', { method: 'POST', body: body({ username: 'admin', password: 'password1', confirmPassword: 'password1' }) });
    const code1 = (await f.call('/api/admin/invites', { method: 'POST', headers: { cookie: jar(admin) }, body: body({ expiresInDays: null }) })).body.invites[0].code;
    const u1 = jar(await f.call('/api/auth/register', { method: 'POST', body: body({ username: 'u1', password: 'password1', confirmPassword: 'password1', inviteCode: code1 }) }));
    const code2 = (await f.call('/api/admin/invites', { method: 'POST', headers: { cookie: jar(admin) }, body: body({ expiresInDays: null }) })).body.invites[0].code;
    const u2 = jar(await f.call('/api/auth/register', { method: 'POST', body: body({ username: 'u2', password: 'password1', confirmPassword: 'password1', inviteCode: code2 }) }));
    const made = await f.call('/api/tasks', { method: 'POST', headers: { cookie: u1 }, body: body({ name: 'private', text: 'p', parseMode: 'lines', params: params({ batchSize: 2 }) }) });
    const taskId = made.body.task.id;
    assert.equal((await f.call('/api/tasks', { headers: { cookie: u2 } })).body.tasks.length, 0);
    const jobs = f.server.app.db.prepare('SELECT id FROM generation_jobs WHERE batch_id IN (SELECT id FROM batches WHERE task_id=?) ORDER BY image_index').all(taskId);
    f.server.app.db.prepare("UPDATE generation_jobs SET status='running',submitted=1 WHERE id=?").run(jobs[0].id);
    const cancelled = await f.call(`/api/tasks/${taskId}/cancel`, { method: 'POST', headers: { cookie: u1 }, body: '{}' });
    assert.equal(cancelled.status, 200);
    assert.equal(f.server.app.db.prepare("SELECT status FROM generation_jobs WHERE id=?").get(jobs[0].id).status, 'running');
    assert.equal(f.server.app.db.prepare("SELECT status FROM generation_jobs WHERE id=?").get(jobs[1].id).status, 'cancelled');
    assert.equal((await f.call(`/api/tasks/${taskId}`, { headers: { cookie: u2 } })).status, 404);
  } finally { await f.close(); }
});

test('reports queued defaults and failed progress counters, and accepts a batch-eight repeat-32 preset', async () => {
  const f = await fixture();
  try {
    const user = await bootstrap(f);
    const created = await f.call('/api/tasks', { method: 'POST', headers: { cookie: user }, body: body({ name: 'progress', text: 'p', parseMode: 'lines', params: params() }) });
    assert.equal(created.body.task.status, 'queued');
    assert.equal(created.body.task.completedImages, 0);
    const batchId = created.body.task.batches[0].id;
    f.server.app.db.prepare("UPDATE generation_jobs SET status='failed',error='bad' WHERE batch_id=?").run(batchId);
    const fetched = await f.call(`/api/tasks/${created.body.task.id}`, { headers: { cookie: user } });
    assert.equal(fetched.body.task.status, 'failed');
    assert.equal(fetched.body.task.failedImages, 1);
    const preset = await f.call('/api/presets', { method: 'POST', headers: { cookie: user }, body: body({ name: 'big', params: params({ batchSize: 8, repeat: 32 }) }) });
    assert.equal(preset.status, 201);
  } finally { await f.close(); }
});

test('replaying an acknowledged task request cannot duplicate its image jobs',async()=>{
  const f=await fixture();try{
    const cookie=await bootstrap(f);
    const payload={name:'idempotent',text:'one\ntwo',parseMode:'lines',params:params(),requestKey:'qa-request-key-000001'};
    const first=await f.call('/api/tasks',{method:'POST',headers:{cookie},body:body(payload)});
    const retry=await f.call('/api/tasks',{method:'POST',headers:{cookie},body:body(payload)});
    assert.equal(first.status,202);assert.equal(retry.status,200);assert.equal(first.body.task.id,retry.body.task.id);
    assert.equal(f.server.app.db.prepare('SELECT COUNT(*) n FROM generation_jobs').get().n,2);
    const changed=await f.call('/api/tasks',{method:'POST',headers:{cookie},body:body({...payload,text:'different'})});assert.equal(changed.status,409);
  }finally{await f.close();}
});

test('TXT tasks always run once while ordinary generations retain repeat up to 32',async()=>{
  const f=await fixture();try{
    const cookie=await bootstrap(f);
    const rejected=await f.call('/api/tasks',{method:'POST',headers:{cookie},body:body({name:'no repeats',text:'one',params:params({repeat:2})})});
    assert.equal(rejected.status,400);
    const ordinary=await f.call('/api/generations',{method:'POST',headers:{cookie},body:body(params({prompt:'ordinary',repeat:32}))});
    assert.equal(ordinary.status,202);assert.equal(ordinary.body.batches.length,32);
  }finally{await f.close();}
});
