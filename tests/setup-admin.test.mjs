import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDb} from '../server/db.mjs';
import {setupAdmin} from '../setup-admin.mjs';
import {verifyPasswordAsync} from '../server/security.mjs';
test('deployment admin initialization hashes passwords and never overwrites existing users',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nibiru-admin-')),db=openDb(dir);
 try{
  await assert.rejects(setupAdmin(db,{username:'DeepGHS',password:'short'}));
  await setupAdmin(db,{username:'DeepGHS',password:'Disposable-test-password-123'});
  const row=db.prepare('SELECT * FROM users').get();
  assert.equal(row.role,'admin');assert.equal(row.username,'DeepGHS');
  assert.ok(await verifyPasswordAsync('Disposable-test-password-123',row.password_hash));
  await assert.rejects(setupAdmin(db,{username:'other',password:'Different-test-password-123'}),/already initialized/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,1);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
