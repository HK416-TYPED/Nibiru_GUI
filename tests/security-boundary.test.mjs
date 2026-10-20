import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {createServer} from '../server/index.mjs';
const setupToken='isolated-security-setup-token-12345678';
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'nibiru-security-'));const server=createServer({dataDir:dir,workerInterval:100000,comfyUrl:'http://127.0.0.1:1',setupToken});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,{method='GET',body,headers={}}={})=>{const response=await fetch(url+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,headers:response.headers,data:await response.json()};};
 const setup=async()=>{const response=await call('/api/setup',{method:'POST',headers:{'x-nibiru-setup-token':setupToken},body:{username:'admin',password:'old-password-123',confirmPassword:'old-password-123'}});assert.equal(response.status,201);return response.headers.get('set-cookie').split(';')[0];};
 return{server,url,call,setup,close:async()=>{await server.app.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}};
}
test('first-run administrator setup requires the independent bootstrap secret',async()=>{const f=await fixture();try{const r=await f.call('/api/setup',{method:'POST',body:{username:'admin',password:'password1',confirmPassword:'password1'}});assert.equal(r.status,403);await f.setup();}finally{await f.close();}});
test('rejects unapproved Host headers before exposing API data',async()=>{const f=await fixture();try{const status=await new Promise((resolve,reject)=>{httpRequest(f.url+'/api/session',{headers:{host:'attacker.example'}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));}).on('error',reject).end();});assert.equal(status,403);}finally{await f.close();}});
test('malformed cookies are ignored and invalid JSON shapes and oversized passwords are rejected',async()=>{const f=await fixture();try{
 assert.equal((await f.call('/api/session',{headers:{cookie:'nibiru_session=%ZZ'}})).status,200);
 assert.equal((await f.call('/api/auth/login',{method:'POST',body:null})).status,400);
 assert.equal((await f.call('/api/auth/login',{method:'POST',body:{username:'admin',password:'x'.repeat(129)}})).status,400);
}finally{await f.close();}});
test('blocks cross-site write metadata and framing while preserving authenticated same-origin requests',async()=>{const f=await fixture();try{
 const cookie=await f.setup();const r=await f.call('/api/preferences',{method:'PATCH',headers:{cookie,'sec-fetch-site':'cross-site'},body:{theme:'dark'}});assert.equal(r.status,403);
 const page=await fetch(f.url);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(page.headers.get('x-content-type-options'),'nosniff');
 assert.equal((await f.call('/api/preferences',{method:'PATCH',headers:{cookie,origin:f.url},body:{theme:'dark'}})).status,200);
}finally{await f.close();}});
test('login throttling cannot be cleared using a successful login',async()=>{const f=await fixture();try{await f.setup();for(let i=0;i<10;i++)await f.call('/api/auth/login',{method:'POST',body:{username:'admin',password:'bad-password'}});const r=await f.call('/api/auth/login',{method:'POST',body:{username:'admin',password:'old-password-123'}});assert.equal(r.status,429);}finally{await f.close();}});
test('password changes revoke previous sessions and require the current password',async()=>{const f=await fixture();try{
 const cookie=await f.setup();let r=await f.call('/api/auth/password',{method:'POST',headers:{cookie},body:{currentPassword:'wrong-password',newPassword:'new-private-password-456',confirmPassword:'new-private-password-456'}});assert.equal(r.status,400);
 r=await f.call('/api/auth/password',{method:'POST',headers:{cookie},body:{currentPassword:'old-password-123',newPassword:'new-private-password-456',confirmPassword:'new-private-password-456'}});assert.equal(r.status,200);
 assert.equal((await f.call('/api/session',{headers:{cookie}})).data.user,null);
 const nextCookie=r.headers.get('set-cookie').split(';')[0];assert.equal((await f.call('/api/session',{headers:{cookie:nextCookie}})).data.user.username,'admin');
}finally{await f.close();}});

test('revoked accounts cannot finish a write that started before revocation',async()=>{
 const f=await fixture();try{
  const admin=await f.setup();
  const inv=await f.call('/api/admin/invites',{method:'POST',headers:{cookie:admin},body:{count:1,expiresInDays:1}});
  const reg=await f.call('/api/auth/register',{method:'POST',body:{username:'revoked',password:'member-password-123',confirmPassword:'member-password-123',inviteCode:inv.data.invites[0].code}});
  const cookie=reg.headers.get('set-cookie').split(';')[0];
  let sawData;const received=new Promise(resolve=>{sawData=resolve;});
  f.server.on('request',req=>{if(req.url==='/api/generations')req.once('data',sawData);});
  let request;
  const result=new Promise((resolve,reject)=>{request=httpRequest(f.url+'/api/generations',{method:'POST',headers:{cookie,'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});request.on('error',reject);request.write('{"prompt":');});
  await received;
  assert.equal((await f.call(`/api/admin/users/${reg.data.user.id}`,{method:'PATCH',headers:{cookie:admin},body:{disabled:true}})).status,200);
  request.end('"cannot enqueue"}');assert.equal(await result,401);
  assert.equal(f.server.app.db.prepare('SELECT COUNT(*) n FROM batches').get().n,0);
 }finally{await f.close();}
});
test('source secrets and database files are never served as public assets',async()=>{
 const f=await fixture();try{for(const path of ['/.env','/.setup-token','/../server/app.mjs','/data/nibiru.sqlite']){const r=await fetch(f.url+path);assert.equal(r.status,404);}}finally{await f.close();}
});

test('account image storage quotas reject more GPU work before it is enqueued',async()=>{
 const f=await fixture();try{
  const cookie=await f.setup();const uid=f.server.app.db.prepare('SELECT id FROM users WHERE username=?').get('admin').id;
  const id='quota-batch';f.server.app.db.prepare('INSERT INTO batches(id,user_id,created_at,status,prompt,negative_prompt,model_name,params,workflow) VALUES(?,?,?,?,?,?,?,?,?)').run(id,uid,new Date().toISOString(),'completed','x','','model','{}','{}');
  f.server.app.db.prepare('INSERT INTO images(id,batch_id,user_id,path,created_at,byte_size) VALUES(?,?,?,?,?,?)').run('quota-image',id,uid,'unused-path',new Date().toISOString(),20*1024**3);
  const r=await f.call('/api/generations',{method:'POST',headers:{cookie},body:{prompt:'too much'}});assert.equal(r.status,429);assert.equal(f.server.app.db.prepare('SELECT COUNT(*) n FROM generation_jobs').get().n,0);
 }finally{await f.close();}
});

test('only admins configure onboarding defaults and users retain their subsequent choices',async()=>{
 const f=await fixture();try{
  const admin=await f.setup();
  const model=await f.call('/api/admin/models',{method:'POST',headers:{cookie:admin},body:{name:'Second',filename:'second.safetensors'}});
  const params={modelId:1,prompt:'',negativePrompt:'bad',batchSize:1,repeat:1,width:512,height:512,steps:12,cfg:2,sampler:'euler',scheduler:'simple',seed:-1,denoise:1};
  const preset=await f.call('/api/presets',{method:'POST',headers:{cookie:admin},body:{name:'Welcome settings',params}});
  assert.equal((await f.call('/api/admin/workspace-defaults',{method:'PATCH',headers:{cookie:admin},body:{modelId:model.data.model.id,presetId:preset.data.activePresetId}})).status,200);
  const inv=await f.call('/api/admin/invites',{method:'POST',headers:{cookie:admin},body:{count:1,expiresInDays:1}});
  const reg=await f.call('/api/auth/register',{method:'POST',body:{username:'newmember',password:'member-password-123',confirmPassword:'member-password-123',inviteCode:inv.data.invites[0].code}});
  const user=reg.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.call('/api/admin/workspace-defaults',{headers:{cookie:user}})).status,403);
  let saved=(await f.call('/api/presets',{headers:{cookie:user}})).data;
  assert.equal(saved.preferredModelId,model.data.model.id);assert.equal(saved.presets[0].params.steps,12);assert.notEqual(saved.activePresetId,preset.data.activePresetId);
  await f.call('/api/presets/active',{method:'PATCH',headers:{cookie:user},body:{id:null}});
  await f.call('/api/preferences',{method:'PATCH',headers:{cookie:user},body:{preferredModelId:1}});
  await f.call('/api/admin/workspace-defaults',{method:'PATCH',headers:{cookie:admin},body:{modelId:model.data.model.id,presetId:null}});
  saved=(await f.call('/api/presets',{headers:{cookie:user}})).data;assert.equal(saved.activePresetId,null);assert.equal(saved.preferredModelId,1);assert.equal(saved.presets.length,1);
 }finally{await f.close();}
});
