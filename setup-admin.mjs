import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {rmSync} from 'node:fs';
import {openDb} from './server/db.mjs';
import {hashPasswordAsync,validUsername,validPassword} from './server/security.mjs';

export async function setupAdmin(db,{username,password}){
  if(db.prepare('SELECT 1 FROM users LIMIT 1').get())throw new Error('Database already initialized; existing accounts will not be overwritten');
  if(!validUsername(username)||!validPassword(password)||password.length<12)throw new Error('Configure a valid admin username and a password of 12–128 characters');
  const hash=await hashPasswordAsync(password);
  db.exec('BEGIN IMMEDIATE');
  try{
    if(db.prepare('SELECT 1 FROM users LIMIT 1').get())throw new Error('Database already initialized');
    db.prepare('INSERT INTO users(username,password_hash,role,created_at,preferences) VALUES(?,?,?,?,?)').run(username,hash,'admin',new Date().toISOString(),JSON.stringify({theme:'light',language:'zh'}));
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dataDir=process.env.DATA_DIR||'./data';
  const db=openDb(dataDir);
  try{
    await setupAdmin(db,{username:process.env.ADMIN_USERNAME||'DeepGHS',password:process.env.ADMIN_PASSWORD});
    rmSync(join(dataDir,'.setup-token'),{force:true});
    console.log('Administrator initialized.');
  }catch(error){console.error(error.message);process.exitCode=1;}finally{db.close();}
}
