import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportTaskArchive } from '../server/task-archive.mjs';

function response({ pause = false } = {}) { const r = new EventEmitter(); r.headers = null; r.headersSent = false; r.body = Buffer.alloc(0); r.writeHead = (status, headers) => { r.status = status; r.headers = headers; r.headersSent = true; }; r.write = chunk => { r.body = Buffer.concat([r.body, Buffer.from(chunk)]); if (pause && !r.released) { setTimeout(() => { r.released = true; r.emit('drain'); }, 10); return false; } return true; }; r.end = chunk => { if (chunk) r.write(chunk); r.ended = true; }; r.destroy = error => { r.destroyed = error || true; }; return r; }
function dbFixture({ task = {}, active = null, batches = [], images = [] } = {}) { return { prepare(sql) { return { get(...args) { if (sql.includes('FROM tasks')) return task.id && args[0] === task.id && args[1] === 7 ? task : undefined; if (sql.includes('generation_jobs') && sql.includes('status IN')) return active; return undefined; }, all() { if (sql.includes('FROM batches')) return batches; if (sql.includes('FROM images')) return images; return []; } }; } }; }
const parseEntries = buffer => { const out = {}; let p = 0; while (p < buffer.length && buffer.readUInt32LE(p) === 0x04034b50) { const nameLen = buffer.readUInt16LE(p + 26); const extraLen = buffer.readUInt16LE(p + 28); const size = buffer.readUInt32LE(p + 22); const name = buffer.subarray(p + 30, p + 30 + nameLen).toString(); const start = p + 30 + nameLen + extraLen; out[name] = buffer.subarray(start, start + size); p = start + size; } return out; };
const crc32 = data => { let c = 0xffffffff; for (const byte of data) { c ^= byte; for (let i = 0; i < 8; i++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : c >>> 1; } return (c ^ 0xffffffff) >>> 0; };

test('exports owned task images and manifest as a readable ZIP', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nibiru-archive-')); const image = join(dir, 'result.png'); await writeFile(image, Buffer.from('png-bytes'));
  try { const task = { id: 'task-1', user_id: 7, name: '中文任务', created_at: new Date().toISOString(), params: JSON.stringify({ prompts: ['a'] }) }; const batch = { id: 'batch-1', model_name: 'Model', prompt: 'a', negative_prompt: '', params: JSON.stringify({ seed: 42 }), status: 'completed' }; const row = { id: 'image-1', batch_id: batch.id, image_index: 0, path: image, filename: 'result.png', created_at: task.created_at, seed: 42 }; const row2 = { ...row, id: 'image-2' }; const res = response(); await exportTaskArchive({ res, db: dbFixture({ task, batches: [batch], images: [row, row2] }), user: { id: 7 }, taskId: task.id, imageDir:dir }); assert.equal(res.status, 200); const files = parseEntries(res.body); assert.deepEqual(files['prompt-0001/image-0001.png'], Buffer.from('png-bytes')); assert.deepEqual(files['prompt-0001/image-0002.png'], Buffer.from('png-bytes')); assert.equal(res.body.readUInt32LE(14), crc32(files['prompt-0001/image-0001.png'])); const manifest = JSON.parse(files['manifest.json']); assert.equal(manifest.task.name, '中文任务'); assert.equal(manifest.images[0].seed, 42); assert.equal(manifest.images[1].archivePath, 'prompt-0001/image-0002.png'); assert.match(res.headers['content-disposition'], /filename\*=UTF-8''/); } finally { await rm(dir, { recursive: true, force: true }); }
});

test('denies foreign tasks, active tasks, and tasks without images before headers', async () => {
  const missing = { id: 'missing', user_id: 7, name: 'x', created_at: new Date().toISOString(), params: '{}' };
  let res = response(); await exportTaskArchive({ res, db: dbFixture({}), user: { id: 8 }, taskId: 'missing' }); assert.equal(res.status, 404);
  res = response(); await exportTaskArchive({ res, db: dbFixture({ task: missing, active: { 1: 1 } }), user: { id: 7 }, taskId: missing.id }); assert.equal(res.status, 409);
  res = response(); await exportTaskArchive({ res, db: dbFixture({ task: missing, batches: [{ id: 'b' }], images: [] }), user: { id: 7 }, taskId: missing.id }); assert.equal(res.status, 404);
});

test('fails with conflict when any image file is missing', async () => {
  const task = { id: 'task-2', user_id: 7, name: 'x', created_at: new Date().toISOString(), params: '{}' }; const batch = { id: 'b', model_name: 'M', prompt: 'p', negative_prompt: '', params: '{}', status: 'completed' }; const res = response(); await exportTaskArchive({ res, db: dbFixture({ task, batches: [batch], images: [{ id: 'i', batch_id: 'b', image_index: 0, path: '/definitely/missing.png' }] }), user: { id: 7 }, taskId: task.id }); assert.equal(res.status, 409); assert.match(res.headers['content-type'], /json/);
});

test('rejects outside-root image paths without requiring symlinks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nibiru-outside-'));
  try {
    const outside = join(dir, 'outside.png'); await writeFile(outside, Buffer.from('private'));
    const task = {id:'outside-task',user_id:7,params:'{}'};
    const batch = {id:'outside-batch',status:'completed',params:'{}'};
    const res = response();
    await exportTaskArchive({res,db:dbFixture({task,batches:[batch],images:[{id:'outside-image',batch_id:batch.id,path:outside}]}),user:{id:7},taskId:task.id,imageDir:join(dir,'images')});
    assert.equal(res.status,409);
    assert.equal(res.body.includes(Buffer.from('private')),false);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('rejects symlink image paths', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'nibiru-archive-root-')); const outside = join(dir, 'outside.png'); const link = join(dir, 'link.png'); await writeFile(outside, Buffer.from('x'));
  try { await symlink(outside, link); } catch(error) {
    await rm(dir, {recursive:true,force:true});
    if(process.platform==='win32'&&error.code==='EPERM'){t.skip('Windows file symlink creation requires Developer Mode or symlink privileges');return;}
    throw error;
  }
  try { const task = { id: 'task-3', user_id: 7, name: 'x', created_at: new Date().toISOString(), params: '{}' }; const batch = { id: 'b', model_name: 'M', prompt: 'p', negative_prompt: '', params: '{}', status: 'completed' }; const row = { id: 'i', batch_id: 'b', image_index: 0, path: link, filename: 'x.png' }; const res = response(); await exportTaskArchive({ res, db: dbFixture({ task, batches: [batch], images: [row] }), user: { id: 7 }, taskId: task.id, imageDir: dir }); assert.equal(res.status, 409); } finally { await rm(dir, { recursive: true, force: true }); }
});

test('limits concurrent exports per user and releases the lock after completion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nibiru-archive-lock-')); const image = join(dir, 'x.png'); await writeFile(image, Buffer.from('x')); const task = { id: 'task-lock', user_id: 7, name: 'x', created_at: new Date().toISOString(), params: '{}' }; const batch = { id: 'b', model_name: 'M', prompt: 'p', negative_prompt: '', params: '{}', status: 'completed' }; const makeDb = () => dbFixture({ task, batches: [batch], images: [{ id: 'i', batch_id: 'b', image_index: 0, path: image, filename: 'x.png' }] });
  try { const database = makeDb(); const first = response({ pause: true }); const firstPromise = exportTaskArchive({ res: first, db: database, user: { id: 7 }, taskId: task.id, imageDir: dir }); const second = response(); await exportTaskArchive({ res: second, db: database, user: { id: 7 }, taskId: task.id, imageDir: dir }); assert.equal(second.status, 429); first.released = true; first.emit('drain'); await firstPromise; const third = response(); await exportTaskArchive({ res: third, db: database, user: { id: 7 }, taskId: task.id, imageDir: dir }); assert.equal(third.status, 200); } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ZIP64 headers encode both sizes and independently encode large offsets',async()=>{
  const {localHeader,centralHeader,zipEndRecords}=await import('../server/task-archive.mjs');
  const size=0x100000001,offset=0x100000010n,date={time:0,day:33};
  const local=localHeader('a',size,123,date);
  assert.equal(local.readUInt16LE(28),20);
  assert.equal(local.readBigUInt64LE(35),BigInt(size));assert.equal(local.readBigUInt64LE(43),BigInt(size));
  const central=centralHeader('a',100,123,date,offset);
  assert.equal(central.readUInt32LE(20),100);assert.equal(central.readUInt32LE(24),100);
  assert.equal(central.readUInt32LE(42),0xffffffff);assert.equal(central.readBigUInt64LE(51),offset);
  const end=zipEndRecords(3,200n,offset);
  assert.equal(end.readBigUInt64LE(24),3n);assert.equal(end.readBigUInt64LE(32),3n);
  assert.equal(end.readBigUInt64LE(40),200n);assert.equal(end.readBigUInt64LE(48),offset);
});
