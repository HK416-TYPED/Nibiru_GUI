import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server/index.mjs';

async function fixture() {
  const dir=await mkdtemp(join(tmpdir(),'nibiru-')); const server=createServer({setupToken:'test-only-init-token-not-for-production-32',dataDir:dir,workerInterval:100000,comfyUrl:'http://127.0.0.1:1'}); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`; const call=async (path,init={})=>{const h=new Headers(init.headers);h.set('x-nibiru-setup-token','test-only-init-token-not-for-production-32');if(init.body&&!h.has('content-type'))h.set('content-type','application/json');const r=await fetch(base+path,{...init,headers:h});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};};
  const close=async()=>{server.app.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}; return {call,close};
}
function jar(res){return res.cookie?.split(';')[0]||'';}

test('setup, invite is one-time, and admin overview is protected', async()=>{const f=await fixture();try{let r=await f.call('/api/setup',{method:'POST',body:JSON.stringify({username:'admin',password:'password1',confirmPassword:'password1'})});assert.equal(r.status,201);const admin=jar(r);r=await f.call('/api/admin/invites',{method:'POST',headers:{cookie:admin},body:JSON.stringify({count:1,expiresInDays:1})});assert.equal(r.status,201);const code=r.body.invites[0].code;r=await f.call('/api/auth/register',{method:'POST',body:JSON.stringify({username:'u1',password:'password1',confirmPassword:'password1',inviteCode:code})});assert.equal(r.status,201);r=await f.call('/api/auth/register',{method:'POST',body:JSON.stringify({username:'u2',password:'password1',confirmPassword:'password1',inviteCode:code})});assert.equal(r.status,400);r=await f.call('/api/admin/overview',{headers:{cookie:jar(r)}});assert.equal(r.status,401);r=await f.call('/api/admin/overview',{headers:{cookie:admin}});assert.equal(r.status,200);assert.equal(r.body.users.length,2);}finally{await f.close();}});

test('generation validation rejects invalid model and unsafe dimensions', async()=>{const f=await fixture();try{let r=await f.call('/api/setup',{method:'POST',body:JSON.stringify({username:'admin',password:'password1',confirmPassword:'password1'})});const c=jar(r);r=await f.call('/api/generations',{method:'POST',headers:{cookie:c},body:JSON.stringify({prompt:'x',modelId:999,width:512,height:512})});assert.equal(r.status,400);r=await f.call('/api/generations',{method:'POST',headers:{cookie:c},body:JSON.stringify({prompt:'x',width:513,height:512})});assert.equal(r.status,400);r=await f.call('/api/generations',{method:'POST',headers:{cookie:c},body:JSON.stringify({prompt:'x',width:512,height:512,steps:1,sampler:'euler',scheduler:'simple'})});assert.equal(r.status,202);}finally{await f.close();}});

test('static modules are served and cross-origin writes are rejected', async()=>{const f=await fixture();try{let r=await f.call('/assets/app.mjs');assert.notEqual(r.status,415);r=await f.call('/api/setup',{method:'POST',headers:{origin:'https://evil.example'},body:JSON.stringify({username:'admin',password:'password1',confirmPassword:'password1'})});assert.equal(r.status,403);}finally{await f.close();}});
