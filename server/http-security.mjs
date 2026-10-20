import {readFileSync,writeFileSync,existsSync,chmodSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
export function httpError(status,message){const error=new Error(message);error.status=status;return error;}
export const csp="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
export function securityHeaders(res,https=false){
 res.setHeader('Content-Security-Policy',csp);res.setHeader('X-Frame-Options','DENY');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 if(https)res.setHeader('Strict-Transport-Security','max-age=31536000');
}
export function requestBoundary(req,configuredOrigin){
 let target;try{target=new URL(`http://${req.headers.host}`);}catch{throw httpError(403,'Invalid host');}
 if(target.username||target.password||target.pathname!=='/'||target.search||target.hash)throw httpError(403,'Invalid host');
 const local=['127.0.0.1','localhost','[::1]'].includes(target.hostname);
 if(!local&&target.host!==configuredOrigin?.host)throw httpError(403,'Host not allowed');
 if(['POST','PATCH','PUT','DELETE'].includes(req.method)){
  if(req.headers['sec-fetch-site']==='cross-site')throw httpError(403,'Cross-origin request');
  if(req.headers.origin){const expected=configuredOrigin?.host===target.host?configuredOrigin.origin:`${req.socket.encrypted?'https:':'http:'}//${target.host}`;if(req.headers.origin!==expected)throw httpError(403,'Cross-origin request');}
  if(req.url.split('?')[0]!=='/api/auth/logout'&&req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')throw httpError(415,'JSON required');
 }
}
export function originConfig(value){
 if(!value)return null;const u=new URL(value);
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('APP_ORIGIN must be an exact HTTP(S) origin');return u;
}
export async function readJsonBody(req){
 const declared=Number(req.headers['content-length']||0);if(declared>1_000_000)throw httpError(413,'Request too large');
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>1_000_000)throw httpError(413,'Request too large');chunks.push(chunk);}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw httpError(400,'Invalid JSON');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw httpError(400,'JSON object required');
 return body;
}
export function bootstrapGate(dataDir,required,configured){
 const path=join(dataDir,'.setup-token');let secret=configured;
 if(required&&configured&&!/^[A-Za-z0-9_-]{32,256}$/.test(configured))throw new Error('NIBIRU_SETUP_TOKEN must contain 32–256 URL-safe random characters');
 if(required&&!secret){if(existsSync(path))secret=readFileSync(path,'utf8').trim();else{secret=randomBytes(32).toString('base64url');writeFileSync(path,secret+'\n',{mode:0o600,flag:'wx'});}chmodSync(path,0o600);}
 return {matches(value){if(typeof value!=='string'||value.length>256||!secret)return false;const a=Buffer.from(value),b=Buffer.from(secret);return a.length===b.length&&timingSafeEqual(a,b);},consume(){if(required&&existsSync(path))unlinkSync(path);}};
}
export function rateLimiter(){
 const buckets=new Map();
 return (key,limit,windowMs=60000)=>{
  const now=Date.now();if(buckets.size>5000){for(const [k,v]of buckets)if(v.until<=now)buckets.delete(k);if(buckets.size>5000)throw httpError(429,'Too many requests');}
  let bucket=buckets.get(key);if(!bucket||bucket.until<=now){bucket={count:0,until:now+windowMs};buckets.set(key,bucket);}
  if(++bucket.count>limit)throw httpError(429,'Too many requests');
 };
}
