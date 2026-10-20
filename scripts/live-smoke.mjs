// Opt-in check for an explicitly identified disposable local instance.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const generate=process.argv.includes('--generate');
if(generate&&(!process.argv.includes('--disposable')||!process.env.TEST_URL))throw new Error('--generate requires --disposable and an explicit TEST_URL');
const base=process.env.TEST_URL||'http://127.0.0.1:3002';
const url=new URL(base);
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('TEST_URL must be a loopback HTTP(S) URL');
const username=process.env.TEST_USERNAME,password=process.env.TEST_PASSWORD;
if(!username||!password)throw new Error('TEST_USERNAME and TEST_PASSWORD must be supplied through the environment');
let cookie='';
async function api(path,method='GET',body){const res=await fetch(new URL(path,url),{method,headers:{'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];const data=await res.json();if(!res.ok)throw new Error(`Smoke request failed (${res.status})`);return data;}
const session=await api('/api/session');
if(session.setupRequired){if(!process.argv.includes('--disposable')||!process.env.TEST_SETUP_TOKEN)throw new Error('Disposable setup requires TEST_SETUP_TOKEN');await api('/api/setup','POST',{username,password,confirmPassword:password,setupToken:process.env.TEST_SETUP_TOKEN});}
else await api('/api/auth/login','POST',{username,password});
assert.equal((await api('/api/session')).user.username,username);
if(generate){
 const model=(await api('/api/models')).models[0];assert.ok(model);
 const result=await api('/api/generations','POST',{prompt:'A small green ceramic vase on ivory linen in soft daylight.',negativePrompt:'text,watermark',modelId:model.id,batchSize:1,repeat:1,width:512,height:512,steps:8,cfg:1,sampler:'euler',scheduler:'simple',seed:4272026,denoise:1});
 const id=result.batches[0].id;let batch;const deadline=Date.now()+240000;
 while(Date.now()<deadline){batch=(await api('/api/batches')).batches.find(b=>b.id===id);if(batch.status==='failed')throw new Error('Generation failed');if(batch.status==='completed')break;await new Promise(r=>setTimeout(r,1500));}
 assert.equal(batch.status,'completed');assert.equal(batch.images.length,1);
 const response=await fetch(new URL(batch.images[0].url,url),{headers:{Cookie:cookie}});assert.equal(response.status,200);
 const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 await mkdir('.local',{recursive:true,mode:0o700});await writeFile('.local/live-result.png',bytes,{mode:0o600});
 console.log(`PASS: disposable live generation completed (${bytes.length} PNG bytes)`);
}else console.log('PASS: local authentication and session check');
