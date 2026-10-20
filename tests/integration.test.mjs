import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server/index.mjs';
import { createServer as createHttpServer } from 'node:http';
import { request as httpRequest } from 'node:http';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

async function fakeComfy({ port = 0, rejectPrompts = false, omitHistory = false } = {}) {
  const state = { prompts: [], histories: new Map(), defaultHistory: null, views: 0, rejectPrompts, omitHistory };
  const server = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    if (req.method === 'POST' && req.url === '/prompt') {
      const promptId = body.prompt_id || `fake-${state.prompts.length + 1}`;
      state.prompts.push({ promptId, body });
      if (state.rejectPrompts) { req.socket.destroy(); return; }
      if (!state.omitHistory && !state.histories.has(promptId)) state.histories.set(promptId, state.defaultHistory || {
        status: { status_str: 'success', completed: true },
        outputs: { '29': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] } },
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ prompt_id: promptId }));
    }
    const history = /^\/history\/(.+)$/.exec(req.url);
    if (req.method === 'GET' && history) {
      const promptId = decodeURIComponent(history[1]);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ [promptId]: state.histories.get(promptId) || null }));
    }
    if (req.method === 'GET' && req.url.startsWith('/view?')) {
      state.views++;
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG);
    }
    if (req.method === 'GET' && req.url === '/queue') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ queue_running: [], queue_pending: [] }));
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

async function fixture({ comfyUrl, dir } = {}) {
  const dataDir = dir || await mkdtemp(join(tmpdir(), 'nibiru-integration-'));
  const server = createServer({setupToken:'test-only-init-token-not-for-production-32', dataDir, workerInterval: 100000, comfyUrl: comfyUrl || 'http://127.0.0.1:1' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, init = {}) => {
    const headers = new Headers(init.headers);headers.set('x-nibiru-setup-token','test-only-init-token-not-for-production-32');
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const response = await fetch(base + path, { ...init, headers });
    const type = response.headers.get('content-type') || '';
    const body = type.includes('json') ? await response.json() : await response.arrayBuffer();
    return { status: response.status, body, headers: response.headers };
  };
  const close = async () => { server.app.close(); await new Promise(resolve => server.close(resolve)); };
  return { server, dataDir, call, close };
}

const cookie = response => response.headers.get('set-cookie')?.split(';', 1)[0] || '';
const json = value => JSON.stringify(value);

async function setupAdmin(f) {
  const r = await f.call('/api/setup', { method: 'POST', body: json({ username: 'admin', password: 'password1', confirmPassword: 'password1' }) });
  assert.equal(r.status, 201);
  return cookie(r);
}

async function invite(f, admin, options = {}) {
  const r = await f.call('/api/admin/invites', { method: 'POST', headers: { cookie: admin }, body: json({ count: 1, expiresInDays: 1, ...options }) });
  assert.equal(r.status, 201);
  return r.body.invites[0].code;
}

async function register(f, code, username = 'user1') {
  const r = await f.call('/api/auth/register', { method: 'POST', body: json({ username, password: 'password1', confirmPassword: 'password1', inviteCode: code }) });
  assert.equal(r.status, 201);
  return cookie(r);
}

test('rejects an invite after its expiry time', async () => {
  const f = await fixture();
  try {
    const admin = await setupAdmin(f);
    const code = await invite(f, admin);
    f.server.app.db.prepare("UPDATE invites SET expires_at=? WHERE code=?").run(new Date(Date.now() - 1000).toISOString(), code);
    const r = await f.call('/api/auth/register', { method: 'POST', body: json({ username: 'expired', password: 'password1', confirmPassword: 'password1', inviteCode: code }) });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /expired|invalid/i);
  } finally { await f.close(); await rm(f.dataDir, { recursive: true, force: true }); }
});

test('denies an authenticated normal user from the admin overview', async () => {
  const f = await fixture();
  try {
    const admin = await setupAdmin(f);
    const user = await register(f, await invite(f, admin));
    const r = await f.call('/api/admin/overview', { headers: { cookie: user } });
    assert.equal(r.status, 403);
  } finally { await f.close(); await rm(f.dataDir, { recursive: true, force: true }); }
});

test('keeps batches and images private between two users', async () => {
  const comfy = await fakeComfy();
  const f = await fixture({ comfyUrl: comfy.url });
  try {
    const admin = await setupAdmin(f);
    const one = await register(f, await invite(f, admin), 'user1');
    const two = await register(f, await invite(f, admin), 'user2');
    const created = await f.call('/api/generations', { method: 'POST', headers: { cookie: one }, body: json({ prompt: 'private', width: 512, height: 512 }) });
    assert.equal(created.status, 202);
    await f.server.app.tick();
    const own = await f.call('/api/batches', { headers: { cookie: one } });
    assert.equal(own.body.batches.length, 1);
    assert.equal(own.body.batches[0].images.length, 1);
    const other = await f.call('/api/batches', { headers: { cookie: two } });
    assert.deepEqual(other.body.batches, []);
    const image = await f.call(own.body.batches[0].images[0].url, { headers: { cookie: two } });
    assert.equal(image.status, 404);
  } finally { await f.close(); await comfy.close(); await rm(f.dataDir, { recursive: true, force: true }); }
});

test('sets secure session cookie attributes and logout invalidates the session', async () => {
  const old = process.env.SECURE_COOKIE;
  process.env.SECURE_COOKIE = '1';
  const f = await fixture();
  try {
    const login = await setupAdmin(f);
    const setCookie = (await f.call('/api/auth/login', { method: 'POST', body: json({ username: 'admin', password: 'password1' }) })).headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Secure/);
    const logout = await f.call('/api/auth/logout', { method: 'POST', headers: { cookie: login } });
    assert.equal(logout.status, 200);
    const after = await f.call('/api/session', { headers: { cookie: login } });
    assert.equal(after.body.user, null);
  } finally { await f.close(); await rm(f.dataDir, { recursive: true, force: true }); if (old === undefined) delete process.env.SECURE_COOKIE; else process.env.SECURE_COOKIE = old; }
});

test('disabled users cannot use an existing session', async () => {
  const f = await fixture();
  try {
    const admin = await setupAdmin(f);
    const user = await register(f, await invite(f, admin));
    const overview = await f.call('/api/admin/overview', { headers: { cookie: admin } });
    const userId = overview.body.users.find(x => x.username === 'user1').id;
    const disabled = await f.call(`/api/admin/users/${userId}`, { method: 'PATCH', headers: { cookie: admin }, body: json({ disabled: true }) });
    assert.equal(disabled.status, 200);
    const session = await f.call('/api/session', { headers: { cookie: user } });
    assert.equal(session.body.user, null);
    const protectedCall = await f.call('/api/models', { headers: { cookie: user } });
    assert.equal(protectedCall.status, 401);
  } finally { await f.close(); await rm(f.dataDir, { recursive: true, force: true }); }
});

test('serves app.mjs with JavaScript MIME type', async () => {
  const f = await fixture();
  try {
    const r = await f.call('/app.mjs');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/javascript/);
  } finally { await f.close(); await rm(f.dataDir, { recursive: true, force: true }); }
});

test('maps safe integer seed, width, and batch size into the submitted workflow', async () => {
  const comfy = await fakeComfy();
  const f = await fixture({ comfyUrl: comfy.url });
  try {
    const admin = await setupAdmin(f);
    const user = await register(f, await invite(f, admin));
    const r = await f.call('/api/generations', { method: 'POST', headers: { cookie: user }, body: json({ prompt: 'mapped', seed: 2147483647, width: 1024, height: 512, batchSize: 2 }) });
    assert.equal(r.status, 202);
    await f.server.app.tick();
    const workflow = comfy.state.prompts[0].body.prompt;
    const sampler = Object.values(workflow).find(x => x.class_type === 'KSampler');
    const latent = Object.values(workflow).find(x => x.class_type === 'EmptyLatentImage');
    assert.equal(sampler.inputs.seed, 2147483647);
    assert.equal(latent.inputs.width, 1024);
    assert.equal(latent.inputs.batch_size, 1);
    const batch = (await f.call('/api/batches', { headers: { cookie: user } })).body.batches[0];
    assert.equal(batch.params.batchSize, 2);
    await f.server.app.tick();
    assert.equal(comfy.state.prompts.length, 2);
  } finally { await f.close(); await comfy.close(); await rm(f.dataDir, { recursive: true, force: true }); }
});

test('persists generated PNG output from prompt, history, and view APIs', async () => {
  const comfy = await fakeComfy();
  const f = await fixture({ comfyUrl: comfy.url });
  try {
    const admin = await setupAdmin(f);
    const user = await register(f, await invite(f, admin));
    assert.equal((await f.call('/api/generations', { method: 'POST', headers: { cookie: user }, body: json({ prompt: 'png' }) })).status, 202);
    await f.server.app.tick();
    const batches = await f.call('/api/batches', { headers: { cookie: user } });
    const image = await f.call(batches.body.batches[0].images[0].url, { headers: { cookie: user } });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(image.body), PNG);
    assert.equal(comfy.state.views, 1);
  } finally { await f.close(); await comfy.close(); await rm(f.dataDir, { recursive: true, force: true }); }
});

test('resumes a running job after server recreation without submitting twice', async () => {
  const comfy = await fakeComfy();
  const dir = await mkdtemp(join(tmpdir(), 'nibiru-resume-'));
  const first = await fixture({ comfyUrl: comfy.url, dir });
  try {
    const admin = await setupAdmin(first);
    const user = await register(first, await invite(first, admin));
    await first.call('/api/generations', { method: 'POST', headers: { cookie: user }, body: json({ prompt: 'resume' }) });
    const original = comfy.state.histories;
    comfy.state.histories = new Map();
    await first.server.app.tick();
    assert.equal(comfy.state.prompts.length, 1);
    const promptId = comfy.state.prompts[0].promptId;
    comfy.state.histories.set(promptId, { status: { status_str: 'success', completed: true }, outputs: { '29': { images: [{ filename: 'resumed.png', subfolder: '', type: 'output' }] } } });
    await first.close();
    const second = await fixture({ comfyUrl: comfy.url, dir });
    try {
      await second.server.app.tick();
      assert.equal(comfy.state.prompts.length, 1);
      const batches = await second.call('/api/batches', { headers: { cookie: user } });
      assert.equal(batches.body.batches[0].status, 'completed');
      assert.equal(batches.body.batches[0].images.length, 1);
    } finally { await second.close(); }
    void original;
  } finally { await comfy.close(); await rm(dir, { recursive: true, force: true }); }
});

for (const [name, history] of [
  ['fails a ComfyUI error even when completed is false', { status: { status_str: 'error', completed: false }, outputs: {} }],
  ['fails a completed job with no outputs instead of remaining running', { status: { status_str: 'success', completed: true }, outputs: {} }],
]) test(name, async () => {
  const comfy = await fakeComfy();
  const f = await fixture({ comfyUrl: comfy.url });
  try {
    const admin = await setupAdmin(f);
    const user = await register(f, await invite(f, admin));
    const created = await f.call('/api/generations', { method: 'POST', headers: { cookie: user }, body: json({ prompt: name }) });
    const id = created.body.batches[0].id;
    comfy.state.defaultHistory = history;
    await f.server.app.tick();
    await f.server.app.tick();
    const batches = await f.call('/api/batches', { headers: { cookie: user } });
    assert.equal(batches.body.batches.find(x => x.id === id).status, 'failed');
  } finally { await f.close(); await comfy.close(); await rm(f.dataDir, { recursive: true, force: true }); }
});

test('marks authenticated API and private image responses as private and non-cacheable', async () => {
  const comfy = await fakeComfy();
  const f = await fixture({ comfyUrl: comfy.url });
  try {
    const admin = await setupAdmin(f);
    const user = await register(f, await invite(f, admin));
    const session = await f.call('/api/session', { headers: { cookie: user } });
    assert.equal(session.status, 200);
    assert.equal(session.headers.get('cache-control'), 'private, no-store');
    const overview = await f.call('/api/admin/overview', { headers: { cookie: admin } });
    assert.equal(overview.status, 200);
    assert.equal(overview.headers.get('cache-control'), 'private, no-store');
    await f.call('/api/generations', { method: 'POST', headers: { cookie: user }, body: json({ prompt: 'cache' }) });
    await f.server.app.tick();
    const batches = await f.call('/api/batches', { headers: { cookie: user } });
    assert.equal(batches.headers.get('cache-control'), 'private, no-store');
    const image = await f.call(batches.body.batches[0].images[0].url, { headers: { cookie: user } });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('cache-control'), 'private, no-store');
  } finally { await f.close(); await comfy.close(); await rm(f.dataDir, { recursive: true, force: true }); }
});

test('rejects bootstrap setup when forwarded or public host headers claim a non-local request', async () => {
  for (const headers of [{ host: 'public.example' }, { 'x-forwarded-for': '203.0.113.10' }, { forwarded: 'for=203.0.113.10;host=public.example' }]) {
    const f = await fixture();
    try {
      const r = await new Promise((resolve, reject) => {
        const req = httpRequest(new URL('/api/setup', `http://127.0.0.1:${f.server.address().port}`), { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(json({ username: 'admin', password: 'password1', confirmPassword: 'password1' })) } }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
        req.on('error', reject); req.end(json({ username: 'admin', password: 'password1', confirmPassword: 'password1' }));
      });
      assert.equal(r.status, 403, JSON.stringify(headers));
    } finally { await f.close(); await rm(f.dataDir, { recursive: true, force: true }); }
  }
});

test('keeps a failed ComfyUI submission queued with submitted false and retries when service returns', async () => {
  const reserved = await fakeComfy();
  const port = Number(new URL(reserved.url).port);
  const comfyUrl = reserved.url;
  await reserved.close();
  const f = await fixture({ comfyUrl });
  try {
    const admin = await setupAdmin(f);
    const user = await register(f, await invite(f, admin));
    const created = await f.call('/api/generations', { method: 'POST', headers: { cookie: user }, body: json({ prompt: 'retry' }) });
    assert.equal(created.status, 202);
    const batchId = created.body.batches[0].id;
    await f.server.app.tick();
    let row = f.server.app.db.prepare('SELECT status,submitted FROM batches WHERE id=?').get(batchId);
    assert.equal(row.submitted, 0);
    assert.equal(row.status, 'queued');
    const comfy = await fakeComfy({ port });
    await f.server.app.tick();
    row = f.server.app.db.prepare('SELECT status,submitted FROM batches WHERE id=?').get(batchId);
    assert.equal(row.submitted, 1);
    assert.equal(comfy.state.prompts.length, 1);
    await comfy.close();
  } finally { await f.close(); await rm(f.dataDir, { recursive: true, force: true }); }
});

test('does not retry an accepted but reset ComfyUI submission before stale recovery', async () => {
  const comfy = await fakeComfy({ rejectPrompts: true, omitHistory: true });
  const f = await fixture({ comfyUrl: comfy.url });
  try {
    const admin = await setupAdmin(f);
    const user = await register(f, await invite(f, admin));
    const created = await f.call('/api/generations', { method: 'POST', headers: { cookie: user }, body: json({ prompt: 'ambiguous-reset' }) });
    const batchId = created.body.batches[0].id;
    await f.server.app.tick();
    let row = f.server.app.db.prepare('SELECT status,submitted FROM batches WHERE id=?').get(batchId);
    assert.equal(row.submitted, 1);
    assert.equal(row.status, 'running');
    await f.server.app.tick();
    assert.equal(comfy.state.prompts.length, 1);
    const old = new Date(Date.now() - 121000).toISOString();
    const columns = f.server.app.db.prepare('PRAGMA table_info(batches)').all().map(x => x.name);
    if (columns.includes('started_at')) f.server.app.db.prepare("UPDATE generation_jobs SET started_at=? WHERE batch_id=?").run(old, batchId);
    else f.server.app.db.prepare("UPDATE batches SET created_at=? WHERE id=?").run(old, batchId);
    await f.server.app.tick();
    row = f.server.app.db.prepare('SELECT status,submitted FROM batches WHERE id=?').get(batchId);
    assert.equal(row.status, 'failed');
    assert.equal(comfy.state.prompts.length, 1);
  } finally { await f.close(); await comfy.close(); await rm(f.dataDir, { recursive: true, force: true }); }
});

test('marks a submitted job with missing history failed after restart when the queue is empty', async () => {
  const comfy = await fakeComfy();
  const dir = await mkdtemp(join(tmpdir(), 'nibiru-stale-'));
  const first = await fixture({ comfyUrl: comfy.url, dir });
  try {
    const admin = await setupAdmin(first);
    const user = await register(first, await invite(first, admin));
    const created = await first.call('/api/generations', { method: 'POST', headers: { cookie: user }, body: json({ prompt: 'stale' }) });
    const batchId = created.body.batches[0].id;
    first.server.app.db.prepare("UPDATE batches SET status='running',submitted=1,prompt_id=?,created_at=? WHERE id=?").run('missing-history', new Date(Date.now() - 121000).toISOString(), batchId);
    first.server.app.db.prepare("UPDATE generation_jobs SET status='running',submitted=1,prompt_id=?,started_at=? WHERE batch_id=?").run('missing-history',new Date(Date.now()-121000).toISOString(),batchId);
    await first.close();
    const second = await fixture({ comfyUrl: comfy.url, dir });
    try {
      await second.server.app.tick();
      const row = second.server.app.db.prepare('SELECT status FROM batches WHERE id=?').get(batchId);
      assert.equal(row.status, 'failed');
    } finally { await second.close(); }
  } finally { await comfy.close(); await rm(dir, { recursive: true, force: true }); }
});

test('adds a model using only its name and inherits the provided workflow defaults', async () => {
  const f = await fixture();
  try {
    const admin = await setupAdmin(f);
    for (const name of ['new_krea_model', 'nested/new_krea_model.safetensors']) {
      const result = await f.call('/api/admin/models', { method:'POST', headers:{cookie:admin}, body:json({name}) });
      assert.equal(result.status,201);
      assert.equal(result.body.model.name,name);
      assert.equal(result.body.model.filename,name.endsWith('.safetensors')?name:`${name}.safetensors`);
      assert.equal(result.body.model.kind,'unet');
      assert.equal(result.body.model.clipName,'qwen3vl_4b_bf16.safetensors');
      assert.equal(result.body.model.clipType,'krea2');
      assert.equal(result.body.model.vaeName,'qwen_image_vae.safetensors');
    }
  } finally { await f.close(); await rm(f.dataDir,{recursive:true,force:true}); }
});

test('uses the backend model filename for ComfyUI and the display name for users', async () => {
  const comfy=await fakeComfy();
  const f=await fixture({comfyUrl:comfy.url});
  try {
    const cookie=await setupAdmin(f);
    const added=await f.call('/api/admin/models',{method:'POST',headers:{cookie},body:json({name:'内测模型 A',filename:'models/krea_candidate.safetensors'})});
    assert.equal(added.status,201);
    assert.equal(added.body.model.filename,'models/krea_candidate.safetensors');
    const created=await f.call('/api/generations',{method:'POST',headers:{cookie},body:json({prompt:'model mapping',modelId:added.body.model.id})});
    assert.equal(created.status,202);
    assert.equal(created.body.batches[0].modelName,'内测模型 A');
    await f.server.app.tick();
    const loader=Object.values(comfy.state.prompts[0].body.prompt).find(n=>n.class_type==='UNETLoader');
    assert.equal(loader.inputs.unet_name,'models/krea_candidate.safetensors');
    const listed=await f.call('/api/models',{headers:{cookie}});
    assert.equal(listed.body.models.find(m=>m.id===added.body.model.id).name,'内测模型 A');
    const invalid=await f.call('/api/admin/models',{method:'POST',headers:{cookie},body:json({name:'Another',filename:''})});
    assert.equal(invalid.status,400);
  } finally {await f.close();await comfy.close();await rm(f.dataDir,{recursive:true,force:true});}
});

test('cancels only unsubmitted jobs in an owned generation batch', async () => {
  const f = await fixture();
  try {
    const admin = await setupAdmin(f);
    const owner = await register(f, await invite(f, admin), 'batch-owner');
    const other = await register(f, await invite(f, admin), 'batch-other');

    const queued = await f.call('/api/generations', { method: 'POST', headers: { cookie: owner }, body: json({ prompt: 'queued', batchSize: 2 }) });
    assert.equal(queued.status, 202);
    const queuedId = queued.body.batches[0].id;
    assert.equal((await f.call(`/api/batches/${queuedId}/cancel`, { method: 'POST', headers: { cookie: other }, body: '{}' })).status, 404);
    const cancelled = await f.call(`/api/batches/${queuedId}/cancel`, { method: 'POST', headers: { cookie: owner }, body: '{}' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.batch.status, 'cancelled');
    assert.deepEqual(f.server.app.db.prepare('SELECT status,submitted FROM generation_jobs WHERE batch_id=? ORDER BY image_index').all(queuedId).map(x => ({ status: x.status, submitted: x.submitted })), [
      { status: 'cancelled', submitted: 0 }, { status: 'cancelled', submitted: 0 },
    ]);

    const active = await f.call('/api/generations', { method: 'POST', headers: { cookie: owner }, body: json({ prompt: 'active', batchSize: 4 }) });
    const activeId = active.body.batches[0].id;
    const jobs = f.server.app.db.prepare('SELECT id FROM generation_jobs WHERE batch_id=? ORDER BY image_index').all(activeId);
    f.server.app.db.prepare("UPDATE generation_jobs SET status='completed' WHERE id=?").run(jobs[0].id);
    f.server.app.db.prepare("UPDATE generation_jobs SET status='running',submitted=1,prompt_id='in-flight' WHERE id=?").run(jobs[1].id);
    const activeCancel = await f.call(`/api/batches/${activeId}/cancel`, { method: 'POST', headers: { cookie: owner }, body: '{}' });
    assert.equal(activeCancel.status, 200);
    assert.equal(activeCancel.body.batch.status, 'running');
    assert.deepEqual(f.server.app.db.prepare('SELECT status,submitted FROM generation_jobs WHERE batch_id=? ORDER BY image_index').all(activeId).map(x => ({ status: x.status, submitted: x.submitted })), [
      { status: 'completed', submitted: 0 }, { status: 'running', submitted: 1 }, { status: 'cancelled', submitted: 0 }, { status: 'cancelled', submitted: 0 },
    ]);
  } finally { await f.close(); await rm(f.dataDir, { recursive: true, force: true }); }
});
