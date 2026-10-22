import { createServer as nodeServer } from 'node:http';
import {originConfig} from './http-security.mjs';
import { createApp } from './app.mjs';
import { resolve } from 'node:path';
import { isWithinDirectory } from './path-safety.mjs';
import { pathToFileURL } from 'node:url';
export function validateRuntimeConfig(env=process.env) { const host=env.HOST||'127.0.0.1'; const publicHost=!['127.0.0.1','::1','localhost'].includes(host);const origin=originConfig(env.APP_ORIGIN); if(publicHost&&(origin?.protocol!=='https:'||env.SECURE_COOKIE!=='1')) throw new Error('Public binding requires HTTPS APP_ORIGIN and SECURE_COOKIE=1'); const data=resolve(env.DATA_DIR||'./data'); const pub=resolve(process.cwd(),'public'); if(isWithinDirectory(pub,data))throw new Error('DATA_DIR cannot be inside public'); const port=Number(env.PORT||3000);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');return {host,port}; }
export function createServer(options={}) { const app=createApp(options); const server=nodeServer((req,res)=>Promise.resolve(app(req,res)).catch(()=>{if(!res.headersSent){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'Internal server error'}));}else res.destroy();})); server.requestTimeout=30000; server.headersTimeout=15000; server.keepAliveTimeout=5000; server.maxRequestsPerSocket=1000; server.app=app; return server; }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) { const cfg=validateRuntimeConfig(); const server=createServer(); server.listen(cfg.port,cfg.host,()=>console.log(`Nibiru listening on http://${cfg.host}:${cfg.port}`)); }
