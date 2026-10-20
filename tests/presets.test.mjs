import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server/index.mjs';

const params={modelId:1,prompt:'',negativePrompt:'bad',batchSize:1,repeat:1,width:512,height:512,steps:8,cfg:1,sampler:'euler',scheduler:'simple',seed:-1,denoise:1};
async function fixture(dir=undefined){const dataDir=dir||await mkdtemp(join(tmpdir(),'nibiru-presets-'));const server=createServer({setupToken:'test-only-init-token-not-for-production-32',dataDir,workerInterval:100000,comfyUrl:'http://127.0.0.1:1'});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;const call=async(path,init={})=>{const headers=new Headers(init.headers);headers.set('x-nibiru-setup-token','test-only-init-token-not-for-production-32');if(init.body&&!headers.has('content-type'))headers.set('content-type','application/json');const r=await fetch(base+path,{...init,headers});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};};return {dataDir,server,call,close:async()=>{await server.app.close();await new Promise(r=>server.close(r));}};}
const jar=r=>r.cookie.split(';')[0];
test('presets save, overwrite, activate, restore, and preferences merge',async()=>{const f=await fixture();try{let r=await f.call('/api/setup',{method:'POST',body:JSON.stringify({username:'admin',password:'password1',confirmPassword:'password1'})});const c=jar(r);r=await f.call('/api/presets',{headers:{cookie:c}});assert.deepEqual(r.body.activePresetId,null);r=await f.call('/api/presets',{method:'POST',headers:{cookie:c},body:JSON.stringify({name:'Draft',params})});assert.equal(r.status,201);assert.equal(r.body.activePresetId,r.body.presets[0].id);const pid=r.body.activePresetId;r=await f.call('/api/preferences',{method:'PATCH',headers:{cookie:c},body:JSON.stringify({theme:'dark',language:'en'})});assert.equal(r.body.user.preferences.activePresetId,pid);await f.close();const g=await fixture(f.dataDir);r=await g.call('/api/presets',{headers:{cookie:c}});assert.equal(r.body.activePresetId,pid);await g.close();}finally{await rm(f.dataDir,{recursive:true,force:true});}});
test('presets are isolated and invalid params are rejected',async()=>{const f=await fixture();try{let r=await f.call('/api/setup',{method:'POST',body:JSON.stringify({username:'admin',password:'password1',confirmPassword:'password1'})});const admin=jar(r);r=await f.call('/api/admin/invites',{method:'POST',headers:{cookie:admin},body:JSON.stringify({count:1,expiresInDays:1})});const code=r.body.invites[0].code;r=await f.call('/api/auth/register',{method:'POST',body:JSON.stringify({username:'user',password:'password1',confirmPassword:'password1',inviteCode:code})});const user=jar(r);r=await f.call('/api/presets',{method:'POST',headers:{cookie:user},body:JSON.stringify({name:'Bad',params:{...params,width:513}})});assert.equal(r.status,400);r=await f.call('/api/presets',{method:'POST',headers:{cookie:admin},body:JSON.stringify({name:'A',params})});const other=r.body.presets[0].id;r=await f.call('/api/presets/active',{method:'PATCH',headers:{cookie:user},body:JSON.stringify({id:other})});assert.equal(r.status,404);r=await f.call('/api/presets/active',{method:'PATCH',headers:{cookie:user},body:JSON.stringify({id:null})});assert.equal(r.status,200);assert.equal(r.body.activePresetId,null);}finally{await f.close();}});

test('same-name save replaces parameters and default selection survives reopening', async () => {
  const f = await fixture();
  try {
    const setup = await f.call('/api/setup',{method:'POST',body:JSON.stringify({username:'admin',password:'password1',confirmPassword:'password1'})});
    const cookie=jar(setup);
    const save = params => f.call('/api/presets',{method:'POST',headers:{cookie},body:JSON.stringify({name:'常用参数',params})});
    const first=await save(params);
    const second=await save({...params,steps:12,sampler:'ddim',unexpected:'discard'});
    assert.equal(second.status,201);
    assert.equal(second.body.presets.length,1);
    assert.equal(second.body.activePresetId,first.body.activePresetId);
    assert.equal(second.body.presets[0].params.steps,12);
    assert.equal(second.body.presets[0].params.unexpected,undefined);
    const cleared=await f.call('/api/presets/active',{method:'PATCH',headers:{cookie},body:JSON.stringify({id:null})});
    assert.equal(cleared.body.activePresetId,null);
    const session=await f.call('/api/session',{headers:{cookie}});
    assert.equal(session.body.user.preferences.activePresetId,null);
    assert.equal((await f.call('/api/presets',{headers:{cookie}})).body.presets.length,1);
  } finally {await f.close();await rm(f.dataDir,{recursive:true,force:true});}
});
