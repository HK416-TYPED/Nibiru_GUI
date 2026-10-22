import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,stat,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,parse} from 'node:path';
import {openDb} from '../server/db.mjs';
import {validateRuntimeConfig} from '../server/index.mjs';
test('new and existing database directories and live WAL/SHM files use private permissions',{skip:process.platform==='win32'?'POSIX mode bits do not represent Windows ACL permissions':false},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nibiru-sec-'));let db;
 try{
  db=openDb(dir);db.exec('CREATE TABLE touch(x);INSERT INTO touch VALUES(1)');
  assert.equal((await stat(dir)).mode&0o777,0o700);
  for(const suffix of ['','-wal','-shm'])assert.equal((await stat(join(dir,'nibiru.sqlite'+suffix))).mode&0o777,0o600);
  db.close();db=null;await chmod(dir,0o755);await chmod(join(dir,'nibiru.sqlite'),0o644);
  db=openDb(dir);assert.equal((await stat(dir)).mode&0o777,0o700);assert.equal((await stat(join(dir,'nibiru.sqlite'))).mode&0o777,0o600);
 }finally{db?.close();await rm(dir,{recursive:true,force:true});}
});
test('runtime refuses unsafe public exposure and malformed public origins',()=>{
 assert.throws(()=>validateRuntimeConfig({HOST:'0.0.0.0',APP_ORIGIN:'http://example.test',SECURE_COOKIE:'0',DATA_DIR:'./data'}));
 assert.throws(()=>validateRuntimeConfig({HOST:'0.0.0.0',APP_ORIGIN:'https://example.test/path',SECURE_COOKIE:'1',DATA_DIR:'./data'}));
 assert.throws(()=>validateRuntimeConfig({HOST:'127.0.0.1',DATA_DIR:'./public'}));
 assert.deepEqual(validateRuntimeConfig({HOST:'127.0.0.1',PORT:'3210',DATA_DIR:'./data'}),{host:'127.0.0.1',port:3210});
});

test('Windows runtime accepts a data directory on another drive',{skip:process.platform!=='win32'},()=>{
 const drive=parse(process.cwd()).root[0].toUpperCase()==='C'?'I':'C';
 assert.deepEqual(validateRuntimeConfig({HOST:'127.0.0.1',DATA_DIR:`${drive}:\\nibiru-data`,PORT:'3210'}),{host:'127.0.0.1',port:3210});
});
