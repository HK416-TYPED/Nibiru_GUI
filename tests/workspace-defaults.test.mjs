import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {openDb,now} from '../server/db.mjs';import {getWorkspaceDefaults,saveWorkspaceDefaults,initializeWorkspace} from '../server/workspace-defaults.mjs';
async function fx(){const d=await mkdtemp(join(tmpdir(),'nibiru-workspace-'));const db=openDb(d);return {d,db,close:async()=>{db.close();await rm(d,{recursive:true,force:true})}}}
function seed(db){const a=db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES('a','x','admin',?)").run(now()).lastInsertRowid;const u=db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES('u','x','user',?)").run(now()).lastInsertRowid;db.prepare("INSERT INTO models(name,kind,filename,enabled) VALUES('M','unet','m.safetensors',1),('Off','unet','o.safetensors',0)").run();return {a,u}}
test('workspace defaults snapshot and new-user initialization are isolated',async()=>{const f=await fx();try{const {a,u}=seed(f.db);const mid=f.db.prepare('SELECT id FROM models WHERE name=\'M\'').get().id;const pid='p1';f.db.prepare('INSERT INTO presets(id,user_id,name,params,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(pid,a,'Default',JSON.stringify({modelId:mid,prompt:'hello'}),now(),now());const d=saveWorkspaceDefaults(f.db,{id:a},{modelId:mid,presetId:pid});assert.equal(d.sourcePresetId,pid);const fresh=initializeWorkspace(f.db,u);const prefs=JSON.parse(fresh.preferences);assert.equal(prefs.preferredModelId,mid);assert.ok(prefs.activePresetId);assert.notEqual(prefs.activePresetId,pid);const copied=f.db.prepare('SELECT * FROM presets WHERE id=?').get(prefs.activePresetId);assert.equal(JSON.parse(copied.params).prompt,'hello');const again=initializeWorkspace(f.db,u);assert.equal(again.preferences,fresh.preferences);f.db.prepare('UPDATE presets SET params=? WHERE id=?').run(JSON.stringify({modelId:mid,prompt:'changed'}),pid);assert.equal(getWorkspaceDefaults(f.db).preset.params.prompt,'hello');}finally{await f.close()}});
test('invalid or foreign workspace configuration is rejected',async()=>{const f=await fx();try{const {a,u}=seed(f.db);assert.throws(()=>saveWorkspaceDefaults(f.db,{id:a},{modelId:999,presetId:null}),e=>e.status===400);f.db.prepare('INSERT INTO presets(id,user_id,name,params,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('x',u,'User',JSON.stringify({prompt:'x'}),now(),now());assert.throws(()=>saveWorkspaceDefaults(f.db,{id:a},{modelId:null,presetId:'x'}),e=>e.status===404);}finally{await f.close()}});

test('model override and later administrator edits never reset a user who has already entered',async()=>{
 const f=await fx();try{
  const {a,u}=seed(f.db);const db=f.db;
  const first=db.prepare("SELECT id FROM models WHERE name='M'").get().id;
  const other=Number(db.prepare("INSERT INTO models(name,kind,filename,enabled) VALUES('Other','unet','other.safetensors',1)").run().lastInsertRowid);
  db.prepare('INSERT INTO presets(id,user_id,name,params,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('source',a,'Welcome',JSON.stringify({modelId:first,steps:12}),now(),now());
  saveWorkspaceDefaults(db,{id:a},{modelId:other,presetId:'source'});
  const row=initializeWorkspace(db,u),prefs=JSON.parse(row.preferences);
  assert.equal(prefs.preferredModelId,other);
  assert.equal(JSON.parse(db.prepare('SELECT params FROM presets WHERE id=?').get(prefs.activePresetId).params).modelId,other);
  db.prepare('UPDATE users SET preferences=? WHERE id=?').run(JSON.stringify({...prefs,preferredModelId:first,activePresetId:null}),u);
  saveWorkspaceDefaults(db,{id:a},{modelId:other,presetId:null});
  const after=JSON.parse(initializeWorkspace(db,u).preferences);assert.equal(after.preferredModelId,first);assert.equal(after.activePresetId,null);
  const fresh=Number(db.prepare("INSERT INTO users(username,password_hash,created_at) VALUES('new','x',?)").run(now()).lastInsertRowid);
  assert.equal(JSON.parse(initializeWorkspace(db,fresh).preferences).preferredModelId,other);
 }finally{await f.close();}
});
test('unavailable models fall back safely and configured snapshots survive source deletion',async()=>{
 const f=await fx();try{
  const {a,u}=seed(f.db),db=f.db;const modelId=db.prepare("SELECT id FROM models WHERE name='M'").get().id;
  db.prepare('INSERT INTO presets(id,user_id,name,params,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('source',a,'Welcome',JSON.stringify({modelId,steps:9}),now(),now());
  saveWorkspaceDefaults(db,{id:a},{modelId,presetId:'source'});db.prepare('DELETE FROM presets WHERE id=?').run('source');
  saveWorkspaceDefaults(db,{id:a},{modelId:null,keepPreset:true});
  const prefs=JSON.parse(initializeWorkspace(db,u).preferences);assert.equal(prefs.preferredModelId,modelId);assert.ok(prefs.activePresetId);
 }finally{await f.close();}
});
