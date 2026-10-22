import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb, now } from '../server/db.mjs';
import { hashPassword } from '../server/security.mjs';
import { deleteHistorySelection } from '../server/history-selection.mjs';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'nibiru-selection-')); const imageDir = join(dir, 'images'); mkdirSync(imageDir, { recursive: true }); const db = openDb(dir);
  const created = now(); db.prepare('INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)').run(1, 'one', hashPassword('password1'), created); db.prepare('INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)').run(2, 'two', hashPassword('password1'), created); db.prepare('INSERT INTO models(id,name,kind,filename) VALUES(?,?,?,?)').run(1, 'Model One', 'unet', 'model.safetensors');
  const user = db.prepare('SELECT * FROM users WHERE id=1').get(); const paths = [];
  const batch = (id, userId = 1, status = 'completed', taskId = null) => { db.prepare('INSERT INTO batches(id,user_id,task_id,created_at,status,prompt,negative_prompt,model_id,model_name,params,workflow) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, userId, taskId, created, status, id, '', 1, 'Model One', JSON.stringify({ batchSize: 1, repeat: 1 }), '{}'); return id; };
  const image = (id, batchId, index, jobId = `${batchId}-job`, path = join(imageDir, `${id}.png`), userId = 1) => { writeFileSync(path, Buffer.from('png')); paths.push(path); db.prepare('INSERT OR IGNORE INTO generation_jobs(id,batch_id,user_id,image_index,seed,status,workflow,created_at) VALUES(?,?,?,?,?,?,?,?)').run(jobId, batchId, userId, index, 10 + index, 'completed', '{}', created); db.prepare('INSERT INTO images(id,batch_id,user_id,job_id,image_index,path,filename,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, batchId, userId, jobId, index, path, `${id}.png`, created); };
  const close = async () => { db.close(); await rm(dir, { recursive: true, force: true }); }; return { db, user, imageDir, paths, batch, image, close };
}

test('deleting one selected image keeps its sibling and history metadata', async () => {
  const f = await fixture(); try { f.batch('batch'); f.image('image-a', 'batch', 0, 'job'); f.image('image-b', 'batch', 1, 'job'); const r = deleteHistorySelection({ db: f.db, user: f.user, imageIds: ['image-a'], imageDir: f.imageDir, confirm: true }); assert.deepEqual(r, { deletedBatches: 0, deletedImages: 1 }); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM images WHERE batch_id=?').get('batch').n, 1); assert.equal(f.db.prepare('SELECT status FROM generation_jobs WHERE id=?').get('job').status, 'completed'); assert.equal(f.db.prepare('SELECT model_name FROM batches WHERE id=?').get('batch').model_name, 'Model One'); assert.equal(existsSync(f.paths[0]), false); assert.equal(existsSync(f.paths[1]), true); } finally { await f.close(); }
});

test('deleting a batch removes all child images and jobs', async () => {
  const f = await fixture(); try { f.batch('batch'); f.image('image-a', 'batch', 0); f.image('image-b', 'batch', 1, 'job-b'); const r = deleteHistorySelection({ db: f.db, user: f.user, batchIds: ['batch'], imageDir: f.imageDir, confirm: true }); assert.deepEqual(r, { deletedBatches: 1, deletedImages: 2 }); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM batches').get().n, 0); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM images').get().n, 0); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM generation_jobs').get().n, 0); assert.equal(f.paths.every(x => !existsSync(x)), true); } finally { await f.close(); }
});

test('deduplicates overlapping batch and image selections and rolls back foreign selections', async () => {
  const f = await fixture(); try { f.batch('mine'); f.image('mine-image', 'mine', 0); f.batch('other', 2); f.image('other-image', 'other', 0, 'other-job', undefined, 2); assert.deepEqual(deleteHistorySelection({ db: f.db, user: f.user, batchIds: ['mine'], imageIds: ['mine-image', 'mine-image'], imageDir: f.imageDir, confirm: true }), { deletedBatches: 1, deletedImages: 1 }); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM batches WHERE id=?').get('other').n, 1); assert.throws(() => deleteHistorySelection({ db: f.db, user: f.user, batchIds: ['other'], imageDir: f.imageDir, confirm: true }), e => e.status === 404); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM batches WHERE id=?').get('other').n, 1); assert.throws(() => deleteHistorySelection({ db: f.db, user: f.user, imageIds: ['other-image'], imageDir: f.imageDir, confirm: true }), e => e.status === 404); } finally { await f.close(); }
});

test('rejects active selected batches or images without changing rows', async () => {
  const f = await fixture(); try { f.batch('active', 1, 'running'); f.image('active-image', 'active', 0, 'active-job'); f.db.prepare("UPDATE generation_jobs SET status='running' WHERE id='active-job'").run(); assert.throws(() => deleteHistorySelection({ db: f.db, user: f.user, batchIds: ['active'], imageDir: f.imageDir, confirm: true }), e => e.status === 409); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM images WHERE id=?').get('active-image').n, 1); } finally { await f.close(); }
});

test('requires confirmation and deletes only files contained by imageDir while retaining presets', async () => {
  const f = await fixture(); try { f.db.prepare('INSERT INTO presets(id,user_id,name,params,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('preset', 1, 'keep', '{}', now(), now()); f.batch('safe'); const outside = join(f.imageDir, '..', 'outside.png'); f.image('unsafe', 'safe', 0, 'unsafe-job', outside); assert.throws(() => deleteHistorySelection({ db: f.db, user: f.user, imageIds: ['unsafe'], imageDir: f.imageDir, confirm: false }), e => e.status === 400); const r = deleteHistorySelection({ db: f.db, user: f.user, imageIds: ['unsafe', 'unsafe'], imageDir: f.imageDir, confirm: true }); assert.deepEqual(r, { deletedBatches: 1, deletedImages: 1 }); assert.equal(existsSync(outside), true); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM presets').get().n, 1); } finally { await f.close(); }
});
