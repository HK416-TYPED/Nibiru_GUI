import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
if(existsSync('.env'))process.loadEnvFile('.env');
console.log(`Node ${process.versions.node} (${Number(process.versions.node.split('.')[0])>=24?'OK':'requires 24+'})`);
const probes=[['Website',`http://127.0.0.1:${process.env.PORT||3000}/api/session`],['ComfyUI',`${(process.env.COMFYUI_URL||'http://127.0.0.1:8188').replace(/\/$/,'')}/system_stats`]];
for(const [name,url] of probes){
  try{const response=await fetch(url,{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);const data=await response.json();console.log(`${name}: connected${name==='Website'?data.setupRequired?' (administrator setup required)':' (initialized)':''}`);}
  catch(error){console.log(`${name}: not ready (${error.message}). ${name==='ComfyUI'?'Start ComfyUI and check COMFYUI_URL in .env.':'Run start-local.cmd first.'}`);process.exitCode=1;}
}
