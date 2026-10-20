import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server/index.mjs';

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'nibiru-admin-'));
  const server = createServer({setupToken:'test-only-init-token-not-for-production-32', dataDir, workerInterval: 100000, comfyUrl: 'http://127.0.0.1:1' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, init = {}) => { const headers = new Headers(init.headers);headers.set('x-nibiru-setup-token','test-only-init-token-not-for-production-32'); if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json'); const r = await fetch(base + path, { ...init, headers }); return { status: r.status, body: await r.json(), headers: r.headers }; };
  const close = async () => { server.app.close(); await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); };
  return { server, dataDir, call, close };
}
const body = x => JSON.stringify(x);
const jar = r => r.headers.get('set-cookie')?.split(';', 1)[0] || '';
async function adminFixture(f) {
  const admin = await f.call('/api/setup', { method: 'POST', body: body({ username: 'admin', password: 'password1', confirmPassword: 'password1' }) });
  assert.equal(admin.status, 201);
  return jar(admin);
}
async function user(f, admin, username) {
  const code = (await f.call('/api/admin/invites', { method: 'POST', headers: { cookie: admin }, body: body({ expiresInDays: null }) })).body.invites[0].code;
  const r = await f.call('/api/auth/register', { method: 'POST', body: body({ username, password: 'password1', confirmPassword: 'password1', inviteCode: code }) });
  assert.equal(r.status, 201);
  return jar(r);
}
const params = { prompt: 'p', negativePrompt: '', batchSize: 1, repeat: 1, width: 512, height: 512, steps: 8, cfg: 1, sampler: 'euler', scheduler: 'simple', seed: 1, denoise: 1 };

test('clear history removes only current users terminal rows and files, preserving other users and presets', async () => {
  const f = await fixture();
  try {
    const admin = await adminFixture(f); const one = await user(f, admin, 'user1'); const two = await user(f, admin, 'user2');
    await f.call('/api/presets', { method: 'POST', headers: { cookie: one }, body: body({ name: 'keep', params }) });
    const a = await f.call('/api/generations', { method: 'POST', headers: { cookie: one }, body: body(params) });
    const b = await f.call('/api/generations', { method: 'POST', headers: { cookie: two }, body: body(params) });
    const db = f.server.app.db; const dir = join(f.dataDir, 'images'); mkdirSync(dir, { recursive: true });
    const rows = [a.body.batches[0].id, b.body.batches[0].id]; const paths = rows.map((_, i) => join(dir, `seed-${i}.png`));
    paths.forEach(p => writeFileSync(p, Buffer.from('png')));
    rows.forEach((batchId, i) => { const batch = db.prepare('SELECT user_id FROM batches WHERE id=?').get(batchId); db.prepare("UPDATE batches SET status='completed' WHERE id=?").run(batchId); db.prepare("UPDATE generation_jobs SET status='completed' WHERE batch_id=?").run(batchId); db.prepare('INSERT INTO images(id,batch_id,user_id,path,filename,subfolder,type,created_at) VALUES(?,?,?,?,?,?,?,?)').run(`image-${i}`, batchId, batch.user_id, paths[i], `${i}.png`, '', 'output', new Date().toISOString()); });
    const cleared = await f.call('/api/history', { method: 'DELETE', headers: { cookie: one }, body: body({ confirm: true }) });
    assert.equal(cleared.status, 200);
    const oneId = db.prepare('SELECT id FROM users WHERE username=?').get('user1').id;
    const twoId = db.prepare('SELECT id FROM users WHERE username=?').get('user2').id;
    assert.equal(db.prepare('SELECT COUNT(*) n FROM batches WHERE user_id=?').get(oneId).n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM batches WHERE user_id=?').get(twoId).n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM presets WHERE user_id=?').get(oneId).n, 1);
    assert.equal(existsSync(paths[0]), false); assert.equal(existsSync(paths[1]), true);
  } finally { await f.close(); }
});

test('clear history returns 409 while an active task exists', async () => {
  const f = await fixture();
  try {
    const admin = await adminFixture(f); const one = await user(f, admin, 'user1');
    await f.call('/api/generations', { method: 'POST', headers: { cookie: one }, body: body(params) });
    const r = await f.call('/api/history', { method: 'DELETE', headers: { cookie: one }, body: body({ confirm: true }) });
    assert.equal(r.status, 409);
  } finally { await f.close(); }
});

test('deleting a model detaches it while preserving historical name, workflow and images', async () => {
  const f = await fixture();
  try {
    const admin = await adminFixture(f); const one = await user(f, admin, 'user1');
    const db = f.server.app.db; const model = db.prepare('SELECT * FROM models WHERE id=1').get();
    const created = await f.call('/api/generations', { method: 'POST', headers: { cookie: one }, body: body(params) });
    const id = created.body.batches[0].id; const path = join(f.dataDir, 'model-image.png'); writeFileSync(path, Buffer.from('png'));
    db.prepare("UPDATE batches SET status='completed' WHERE id=?").run(id); db.prepare("UPDATE generation_jobs SET status='completed' WHERE batch_id=?").run(id); db.prepare('INSERT INTO images(id,batch_id,user_id,path,filename,created_at) VALUES(?,?,?,?,?,?)').run('model-image', id, 1, path, 'model.png', new Date().toISOString());
    const deleted = await f.call('/api/admin/models/1', { method: 'DELETE', headers: { cookie: admin }, body: body({ confirm: true }) });
    assert.equal(deleted.status, 200);
    const historical = db.prepare('SELECT model_id,model_name,workflow FROM batches WHERE id=?').get(id);
    assert.equal(historical.model_id, null); assert.equal(historical.model_name, model.name); assert.ok(historical.workflow); assert.equal(db.prepare('SELECT COUNT(*) n FROM images WHERE id=?').get('model-image').n, 1);
  } finally { await f.close(); }
});

test('enforces invite durations, self-disable protection, session revocation, and queued cancellation', async () => {
  const f = await fixture();
  try {
    const admin = await adminFixture(f);
    for (const days of [1, 2, 3, 5, 7, null]) { const r = await f.call('/api/admin/invites', { method: 'POST', headers: { cookie: admin }, body: body({ expiresInDays: days }) }); assert.equal(r.status, 201); }
    for (const days of [4, 6]) { const r = await f.call('/api/admin/invites', { method: 'POST', headers: { cookie: admin }, body: body({ expiresInDays: days }) }); assert.equal(r.status, 400); }
    const self = await f.call('/api/admin/users/1', { method: 'PATCH', headers: { cookie: admin }, body: body({ disabled: true }) }); assert.equal(self.status, 400);
    const userCookie = await user(f, admin, 'user1');
    const made = await f.call('/api/generations', { method: 'POST', headers: { cookie: userCookie }, body: body(params) });
    const userId = f.server.app.db.prepare('SELECT id FROM users WHERE username=?').get('user1').id;
    const disabled = await f.call(`/api/admin/users/${userId}`, { method: 'PATCH', headers: { cookie: admin }, body: body({ disabled: true }) }); assert.equal(disabled.status, 200);
    assert.equal((await f.call('/api/session', { headers: { cookie: userCookie } })).body.user, null);
    assert.equal(f.server.app.db.prepare('SELECT status FROM batches WHERE id=?').get(made.body.batches[0].id).status, 'cancelled');
  } finally { await f.close(); }
});

test('merges image view preference updates without dropping existing theme or language', async () => {
  const f = await fixture();
  try {
    const admin = await adminFixture(f); const one = await user(f, admin, 'user1');
    let r = await f.call('/api/preferences', { method: 'PATCH', headers: { cookie: one }, body: body({ theme: 'dark', language: 'en' }) }); assert.equal(r.status, 200);
    r = await f.call('/api/preferences', { method: 'PATCH', headers: { cookie: one }, body: body({ imageView: 'single' }) }); assert.equal(r.status, 200);
    assert.deepEqual(r.body.user.preferences, { theme: 'dark', language: 'en', imageView: 'single' });
  } finally { await f.close(); }
});
