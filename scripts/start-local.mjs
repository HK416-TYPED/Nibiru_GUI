import {existsSync, copyFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
if(Number(process.versions.node.split('.')[0])<24){console.error('Node.js 24 or newer is required.');process.exit(1);}
if(!existsSync('.env'))copyFileSync('.env.example','.env');
process.loadEnvFile('.env');
try {
  const {validateRuntimeConfig,createServer}=await import('../server/index.mjs');
  const config=validateRuntimeConfig();
  const server=createServer();
  server.on('error',error=>{
    console.error(error.code==='EADDRINUSE'?`Port ${config.port} is already in use. Open the existing server or change PORT in .env.`:error.message);
    server.app.close();process.exitCode=1;
  });
  server.listen(config.port,config.host,()=>{
    console.log(`NIBBLES is ready: http://${config.host}:${config.port}/`);
    console.log('This is the real local service. Accounts and images are saved in DATA_DIR.');
    if(existsSync(join(process.env.DATA_DIR||'data','.setup-token')))console.log('First run: use the initialization key in DATA_DIR/.setup-token to create your administrator.');
    console.log('Keep this process running. Press Ctrl+C to stop.');
  });
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;server.app.close();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}catch(error){console.error(`Unable to start NIBBLES: ${error.message}`);process.exitCode=1;}
