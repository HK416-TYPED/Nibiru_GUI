import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
export const hashPassword = (p) => { const salt = randomBytes(16); return `${salt.toString('hex')}:${scryptSync(p, salt, 64).toString('hex')}`; };
export const verifyPassword = (p, encoded) => { try { const [s, h] = encoded.split(':'); const a = Buffer.from(h, 'hex'); return timingSafeEqual(a, scryptSync(p, Buffer.from(s, 'hex'), a.length)); } catch { return false; } };
export const token = () => randomBytes(32).toString('base64url');
export const id = () => randomUUID();
export function parseCookies(header=''){
 const cookies=Object.create(null);
 for(const entry of header.split(';')){const eq=entry.indexOf('=');if(eq<0)continue;const name=entry.slice(0,eq).trim();try{cookies[name]=decodeURIComponent(entry.slice(eq+1));}catch{}}
 return cookies;
}

export function cookie(name, value, maxAge = 604800, secure = false) { return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`; }
export const validUsername = (x) => typeof x === 'string' && /^[\w-]{2,32}$/u.test(x);

// HTTP authentication uses bounded asynchronous work, avoiding event-loop blocking.
import {scrypt as scryptCallback} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scryptCallback);
let passwordWork=0;const passwordWaiters=[];
async function boundedPasswordWork(fn){
 if(passwordWork>=2){if(passwordWaiters.length>=16){const error=new Error('Authentication busy');error.status=429;throw error;}await new Promise(resolve=>passwordWaiters.push(resolve));}else passwordWork++;
 try{return await fn();}finally{const next=passwordWaiters.shift();if(next)next();else passwordWork--;}
}
export const validPassword=p=>typeof p==='string'&&p.length>=8&&p.length<=128&&Buffer.byteLength(p,'utf8')<=512;
export async function hashPasswordAsync(password){
 if(!validPassword(password))throw new Error('Invalid password length');
 return boundedPasswordWork(async()=>{const salt=randomBytes(16).toString('hex');const hash=await derive(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024});return `scrypt$32768$8$3$${salt}$${hash.toString('hex')}`;});
}
export async function verifyPasswordAsync(password,encoded){
 if(typeof password!=='string'||password.length>128||typeof encoded!=='string')return false;
 return boundedPasswordWork(async()=>{
  let salt,hash,options;
  if(encoded.startsWith('scrypt$')){const parts=encoded.split('$');if(parts.length!==6||parts[1]!=='32768'||parts[2]!=='8'||parts[3]!=='3')return false;[, , , ,salt,hash]=parts;options={N:32768,r:8,p:3,maxmem:64*1024*1024};}
  else{[salt,hash]=encoded.split(':');if(!/^[a-f0-9]{32}$/.test(salt||''))return false;salt=Buffer.from(salt,'hex');options={N:16384,r:8,p:1,maxmem:32*1024*1024};}
  if(!/^[a-f0-9]{128}$/.test(hash||''))return false;
  const expected=Buffer.from(hash,'hex');const actual=await derive(password,salt,64,options);return timingSafeEqual(expected,actual);
 });
}
