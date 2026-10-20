import { resolve, sep } from 'node:path';
import { unlinkSync } from 'node:fs';

function failure(status, message) { const error = new Error(message); error.status = status; throw error; }

export function deleteHistorySelection({ db, user, batchIds = [], imageIds = [], imageDir, confirm }) {
  if (confirm !== true) failure(400, 'Confirmation required');
  if (!Array.isArray(batchIds) || !Array.isArray(imageIds) || batchIds.length > 500 || imageIds.length > 500 || batchIds.length + imageIds.length === 0) failure(400, 'Invalid selection');
  if ([...batchIds, ...imageIds].some(x => typeof x !== 'string' || !x.trim())) failure(400, 'Invalid selection');
  const batches = [...new Set(batchIds)]; const images = [...new Set(imageIds)];
  const ownedBatches = new Map(db.prepare('SELECT * FROM batches WHERE user_id=?').all(user.id).map(row => [row.id, row]));
  const selectedBatches = batches.map(id => ownedBatches.get(id));
  if (selectedBatches.some(row => !row)) failure(404, 'History item not found');
  const ownedImages = new Map(db.prepare('SELECT * FROM images WHERE user_id=?').all(user.id).map(row => [row.id, row]));
  const selectedImages = images.map(id => ownedImages.get(id));
  if (selectedImages.some(row => !row)) failure(404, 'History item not found');
  const batchSet = new Set(batches);
  const imageRows = selectedImages.filter(row => !batchSet.has(row.batch_id));
  const affectedBatchIds = [...new Set([...batches, ...imageRows.map(row => row.batch_id)])];
  for (const batchId of affectedBatchIds) {
    const batch = ownedBatches.get(batchId) || db.prepare('SELECT * FROM batches WHERE id=? AND user_id=?').get(batchId,user.id);
    if (['queued', 'running'].includes(batch.status) || db.prepare("SELECT 1 FROM generation_jobs WHERE batch_id=? AND status IN ('queued','running') LIMIT 1").get(batchId)) failure(409, 'Active generations must finish or be cancelled first');
  }
  const affectedTasks=[...new Set(affectedBatchIds.map(id=>ownedBatches.get(id)?.task_id).filter(Boolean))];
  const files = [];
  let deletedBatches = 0; let deletedImages = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const batch of selectedBatches) {
      const rows = db.prepare('SELECT path FROM images WHERE batch_id=? AND user_id=?').all(batch.id, user.id);
      files.push(...rows.map(row => row.path));
      deletedImages += rows.length;
      db.prepare('DELETE FROM images WHERE batch_id=? AND user_id=?').run(batch.id, user.id);
      db.prepare('DELETE FROM generation_jobs WHERE batch_id=? AND user_id=?').run(batch.id, user.id);
      db.prepare('DELETE FROM batches WHERE id=? AND user_id=?').run(batch.id, user.id);
      deletedBatches++;
    }
    for (const image of imageRows) {
      files.push(image.path);
      db.prepare('DELETE FROM images WHERE id=? AND user_id=?').run(image.id, user.id);
      deletedImages++;
      if (!db.prepare('SELECT 1 FROM images WHERE job_id=? LIMIT 1').get(image.job_id)) db.prepare("UPDATE generation_jobs SET status='deleted' WHERE id=? AND user_id=? AND status NOT IN ('queued','running')").run(image.job_id, user.id);
      const remains = db.prepare('SELECT 1 FROM images WHERE batch_id=? LIMIT 1').get(image.batch_id);
      if (!remains) { db.prepare('DELETE FROM generation_jobs WHERE batch_id=? AND user_id=?').run(image.batch_id, user.id); db.prepare('DELETE FROM batches WHERE id=? AND user_id=?').run(image.batch_id, user.id); deletedBatches++; }
    }
    const taskIds = affectedTasks;
    for (const taskId of taskIds) if (!db.prepare('SELECT 1 FROM batches WHERE task_id=? LIMIT 1').get(taskId)) db.prepare('DELETE FROM tasks WHERE id=? AND user_id=?').run(taskId, user.id);
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  const root = resolve(imageDir); const boundary = root.endsWith(sep) ? root : root + sep;
  for (const file of files) { const target = resolve(file); if (target.startsWith(boundary)) try { unlinkSync(target); } catch {} }
  return { deletedBatches, deletedImages };
}
