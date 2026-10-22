import { mkdirSync, chmodSync, existsSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {fileURLToPath} from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { isWithinDirectory } from './path-safety.mjs';

export function openDb(dataDir) {
  const resolved=resolve(dataDir); const publicRoot=realpathSync(fileURLToPath(new URL('../public',import.meta.url)));
  if(isWithinDirectory(publicRoot,resolved)) throw new Error('DATA_DIR cannot be inside public');
  mkdirSync(resolved, { recursive: true, mode:0o700 });
  const actual=realpathSync(resolved);if(isWithinDirectory(publicRoot,actual))throw new Error('DATA_DIR cannot be inside public');
  chmodSync(resolved,0o700);
  const dbPath=join(resolved, 'nibiru.sqlite'); const db = new DatabaseSync(dbPath);
  chmodSync(dbPath,0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', disabled INTEGER NOT NULL DEFAULT 0, preferences TEXT NOT NULL DEFAULT '{"theme":"light","language":"zh"}', created_at TEXT NOT NULL, last_login_at TEXT);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS invites (id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, used_at TEXT, used_by INTEGER REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS models (id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, filename TEXT NOT NULL, clip_name TEXT, clip_type TEXT, vae_name TEXT, enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, status TEXT NOT NULL, prompt TEXT NOT NULL, negative_prompt TEXT NOT NULL, model_id INTEGER REFERENCES models(id), model_name TEXT NOT NULL, params TEXT NOT NULL, prompt_id TEXT, workflow TEXT NOT NULL, error TEXT);
    CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, path TEXT NOT NULL, filename TEXT, subfolder TEXT, type TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS presets (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, params TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id,name));
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT NOT NULL, params TEXT NOT NULL, cancel_requested INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS generation_jobs (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, image_index INTEGER NOT NULL, seed INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued', workflow TEXT NOT NULL, prompt_id TEXT, submitted INTEGER NOT NULL DEFAULT 0, started_at TEXT, retry_count INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL, UNIQUE(batch_id,image_index));
    CREATE TABLE IF NOT EXISTS scheduler_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  try {db.exec('ALTER TABLE users ADD COLUMN workspace_initialized INTEGER NOT NULL DEFAULT 0');db.exec('UPDATE users SET workspace_initialized=1');} catch {}
  try { db.exec('ALTER TABLE batches ADD COLUMN submitted INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE batches ADD COLUMN started_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE batches ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE batches ADD COLUMN task_id TEXT'); } catch {}
  try { db.exec('ALTER TABLE batches ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE images ADD COLUMN job_id TEXT'); } catch {}
  try { db.exec('ALTER TABLE images ADD COLUMN image_index INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE images ADD COLUMN byte_size INTEGER NOT NULL DEFAULT 0');for(const row of db.prepare('SELECT id,path FROM images').all()){try{db.prepare('UPDATE images SET byte_size=? WHERE id=?').run(statSync(row.path).size,row.id);}catch{}} } catch {}
  try { db.exec('ALTER TABLE tasks ADD COLUMN request_key TEXT'); } catch {}
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS tasks_request_key ON tasks(user_id,request_key) WHERE request_key IS NOT NULL');
  db.exec(`CREATE INDEX IF NOT EXISTS jobs_status_user ON generation_jobs(status,user_id);
    CREATE INDEX IF NOT EXISTS jobs_batch ON generation_jobs(batch_id,image_index);
    CREATE INDEX IF NOT EXISTS images_batch ON images(batch_id,image_index);
    CREATE INDEX IF NOT EXISTS batches_user_date ON batches(user_id,created_at);
    CREATE INDEX IF NOT EXISTS tasks_user_date ON tasks(user_id,created_at);`);
  chmodSync(dbPath,0o600); for(const suffix of ['-wal','-shm']){const p=dbPath+suffix;if(existsSync(p))try{chmodSync(p,0o600)}catch{}}
  return db;
}

export const now = () => new Date().toISOString();
export function userView(r) { if (!r) return null; return { id: r.id, username: r.username, role: r.role, disabled: !!r.disabled, preferences: typeof r.preferences === 'string' ? JSON.parse(r.preferences) : r.preferences }; }
export function modelView(r) { return { id: r.id, name: r.name, kind: r.kind, filename: r.filename, clipName: r.clip_name, clipType: r.clip_type, vaeName: r.vae_name, enabled: !!r.enabled }; }
export function inviteView(r) { return { id: r.id, code: r.code, createdAt: r.created_at, expiresAt: r.expires_at, usedAt: r.used_at, usedBy: r.used_by }; }
