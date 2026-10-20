import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const ZIP32 = 0xffffffff;
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); table[i] = c >>> 0; }
  return table;
})();
const crc32 = buffer => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const zipDate = date => { const d = new Date(date || Date.now()); return { time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2), day: (d.getUTCFullYear() - 1980 << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate() }; };
const safeText = value => String(value ?? '').replace(/[\x00-\x1f\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'task';
const ext = path => { const value = extname(path || '').toLowerCase(); return ['.png', '.jpg', '.jpeg', '.webp'].includes(value) ? value : '.png'; };
const write = (res, chunk) => new Promise((resolve, reject) => { const onDrain = () => { cleanup(); resolve(); }; const onError = error => { cleanup(); reject(error); }; const cleanup = () => { res.off('drain', onDrain); res.off('error', onError); res.off('close', onClose); }; const onClose = () => onError(new Error('Archive response closed')); if (res.write(chunk)) resolve(); else { res.once('drain', onDrain); res.once('error', onError); res.once('close', onClose); } });
const trackers = new WeakMap();
const trackerFor = db => { let tracker = trackers.get(db); if (!tracker) { tracker = { users: new Set(), tasks: new Set() }; trackers.set(db, tracker); } return tracker; };
export const isTaskExporting = (db, taskId) => trackerFor(db).tasks.has(String(taskId));
export const isUserExporting = (db, userId) => trackerFor(db).users.has(String(userId));

function zip64Extra(size,offset=null){
  const fields=[];
  if(size>=ZIP32)fields.push(BigInt(size),BigInt(size));
  if(offset!==null&&BigInt(offset)>=BigInt(ZIP32))fields.push(BigInt(offset));
  if(!fields.length)return Buffer.alloc(0);
  const buffer=Buffer.alloc(4+fields.length*8);buffer.writeUInt16LE(1,0);buffer.writeUInt16LE(fields.length*8,2);
  fields.forEach((value,index)=>buffer.writeBigUInt64LE(value,4+index*8));return buffer;
}
export function localHeader(name,size,crc,date){
  const n=Buffer.from(name),extra=zip64Extra(size),large=size>=ZIP32,buffer=Buffer.alloc(30+n.length+extra.length);
  buffer.writeUInt32LE(0x04034b50,0);buffer.writeUInt16LE(large?45:10,4);buffer.writeUInt16LE(0x800,6);
  buffer.writeUInt16LE(date.time,10);buffer.writeUInt16LE(date.day,12);buffer.writeUInt32LE(crc,14);
  buffer.writeUInt32LE(large?ZIP32:size,18);buffer.writeUInt32LE(large?ZIP32:size,22);
  buffer.writeUInt16LE(n.length,26);buffer.writeUInt16LE(extra.length,28);n.copy(buffer,30);extra.copy(buffer,30+n.length);return buffer;
}
export function centralHeader(name,size,crc,date,offset){
  const n=Buffer.from(name),largeSize=size>=ZIP32,largeOffset=BigInt(offset)>=BigInt(ZIP32),extra=zip64Extra(size,offset);
  const buffer=Buffer.alloc(46+n.length+extra.length);buffer.writeUInt32LE(0x02014b50,0);buffer.writeUInt16LE(45,4);buffer.writeUInt16LE(largeSize||largeOffset?45:10,6);buffer.writeUInt16LE(0x800,8);
  buffer.writeUInt16LE(date.time,12);buffer.writeUInt16LE(date.day,14);buffer.writeUInt32LE(crc,16);
  buffer.writeUInt32LE(largeSize?ZIP32:size,20);buffer.writeUInt32LE(largeSize?ZIP32:size,24);
  buffer.writeUInt16LE(n.length,28);buffer.writeUInt16LE(extra.length,30);buffer.writeUInt32LE(largeOffset?ZIP32:Number(offset),42);n.copy(buffer,46);extra.copy(buffer,46+n.length);return buffer;
}
export function zipEndRecords(count,size,offset,force64=false){
  size=BigInt(size);offset=BigInt(offset);
  const large=force64||count>=0xffff||size>=BigInt(ZIP32)||offset>=BigInt(ZIP32),parts=[];
  if(large){
    const end=Buffer.alloc(56);end.writeUInt32LE(0x06064b50,0);end.writeBigUInt64LE(44n,4);end.writeUInt16LE(45,12);end.writeUInt16LE(45,14);end.writeBigUInt64LE(BigInt(count),24);end.writeBigUInt64LE(BigInt(count),32);end.writeBigUInt64LE(size,40);end.writeBigUInt64LE(offset,48);parts.push(end);
    const locator=Buffer.alloc(20);locator.writeUInt32LE(0x07064b50,0);locator.writeBigUInt64LE(offset+size,8);locator.writeUInt32LE(1,16);parts.push(locator);
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(large?0xffff:count,8);end.writeUInt16LE(large?0xffff:count,10);end.writeUInt32LE(large?ZIP32:Number(size),12);end.writeUInt32LE(large?ZIP32:Number(offset),16);parts.push(end);return Buffer.concat(parts);
}

export async function exportTaskArchive({req,res,db,user,taskId,imageDir}){
  const jsonError=(status,error)=>{if(res.destroyed)return res;res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'});res.end(JSON.stringify({error}));return res;};
  const task=db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(taskId,user.id);
  if(!task)return jsonError(404,'Task not found');
  if(db.prepare("SELECT 1 FROM generation_jobs j JOIN batches b ON b.id=j.batch_id WHERE b.task_id=? AND j.status IN ('queued','running') LIMIT 1").get(task.id))return jsonError(409,'Task is still active');
  const tracker=trackerFor(db),userKey=String(user.id),taskKey=String(task.id);
  if(tracker.users.has(userKey)||tracker.tasks.has(taskKey)||tracker.tasks.size>=2){res.setHeader?.('Retry-After','5');return jsonError(429,'Too many active task exports');}
  tracker.users.add(userKey);tracker.tasks.add(taskKey);
  const started=Date.now();let closed=false;const close=()=>{closed=true;};res.on('close',close);
  const check=()=>{if(closed||req?.aborted||res.destroyed||Date.now()-started>600000)throw new Error('Export interrupted');};
  const entries=[];
  async function safeOpen(path,root){
    const link=await lstat(path);if(!link.isFile()||link.isSymbolicLink())throw new Error('Unsafe image');
    const actual=await realpath(path);if(!actual.startsWith(root))throw new Error('Unsafe image');
    const handle=await open(actual,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    const stat=await handle.stat();if(!stat.isFile()){await handle.close();throw new Error('Unsafe image');}return{handle,stat,actual};
  }
  try{
    const batches=db.prepare('SELECT * FROM batches WHERE task_id=? ORDER BY rowid').all(task.id);
    const images=db.prepare('SELECT i.*,j.seed FROM images i JOIN batches b ON b.id=i.batch_id LEFT JOIN generation_jobs j ON j.id=i.job_id WHERE b.task_id=? ORDER BY b.rowid,i.image_index,i.rowid').all(task.id);
    if(!images.length)return jsonError(404,'Task has no images');
    if(images.length>4096)return jsonError(413,'Too many images in one export');
    if(!imageDir)return jsonError(409,'Image directory is unavailable');
    const root=resolve(await realpath(imageDir))+sep;
    const positions=new Map();
    for(const image of images){
      check();const {handle,stat,actual}=await safeOpen(image.path,root);
      let crc=0xffffffff,position=0;
      try{
        const buffer=Buffer.allocUnsafe(64*1024);
        while(position<stat.size){check();const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,stat.size-position),position);if(!bytesRead)throw new Error('Image changed');for(let i=0;i<bytesRead;i++)crc=crcTable[(crc^buffer[i])&255]^(crc>>>8);position+=bytesRead;}
      }finally{await handle.close();}
      const ordinal=(positions.get(image.batch_id)||0)+1;positions.set(image.batch_id,ordinal);
      const batchIndex=batches.findIndex(b=>b.id===image.batch_id);
      entries.push({path:actual,name:`prompt-${String(batchIndex+1).padStart(4,'0')}/image-${String(ordinal).padStart(4,'0')}${ext(image.filename||image.path)}`,size:stat.size,crc:(crc^0xffffffff)>>>0,dev:stat.dev,ino:stat.ino,mtimeMs:stat.mtimeMs});
    }
    const manifest=Buffer.from(JSON.stringify({task:{id:task.id,name:task.name,createdAt:task.created_at,params:JSON.parse(task.params||'{}')},batches:batches.map(b=>({id:b.id,prompt:b.prompt,negativePrompt:b.negative_prompt,modelName:b.model_name,params:JSON.parse(b.params||'{}'),status:b.status,error:b.error||null})),images:images.map((image,index)=>({archivePath:entries[index].name,id:image.id,batchId:image.batch_id,imageIndex:image.image_index,seed:image.seed??null,filename:image.filename,createdAt:image.created_at}))},null,2));
    entries.push({name:'manifest.json',data:manifest,size:manifest.length,crc:crc32(manifest)});
    const fallback=safeText(task.name).replace(/[^A-Za-z0-9._-]/g,'_')||'task';
    const disposition=`attachment; filename="${fallback}.zip"; filename*=UTF-8''${encodeURIComponent(safeText(task.name)).replace(/'/g,'%27')}.zip`;
    check();res.writeHead(200,{'content-type':'application/zip','content-disposition':disposition,'cache-control':'private, no-store'});
    let offset=0n;const central=[];
    for(const entry of entries){
      check();const date=zipDate(task.created_at),header=localHeader(entry.name,entry.size,entry.crc,date);
      let opened;
      try{
        if(!entry.data){opened=await safeOpen(entry.path,root);const stat=opened.stat;if(stat.size!==entry.size||stat.dev!==entry.dev||stat.ino!==entry.ino||stat.mtimeMs!==entry.mtimeMs)throw new Error('Image changed');}
        await write(res,header);
        if(entry.data)await write(res,entry.data);
        else{let position=0;while(position<entry.size){check();const buffer=Buffer.allocUnsafe(Math.min(64*1024,entry.size-position));const {bytesRead}=await opened.handle.read(buffer,0,buffer.length,position);if(!bytesRead)throw new Error('Image changed');await write(res,buffer.subarray(0,bytesRead));position+=bytesRead;}}
      }finally{if(opened)await opened.handle.close();}
      central.push(centralHeader(entry.name,entry.size,entry.crc,date,offset));offset+=BigInt(header.length)+BigInt(entry.size);
    }
    const centralSize=central.reduce((sum,header)=>sum+BigInt(header.length),0n);
    for(const header of central){check();await write(res,header);}
    await write(res,zipEndRecords(central.length,centralSize,offset,entries.some(e=>e.size>=ZIP32)));res.end();return res;
  }catch{if(!res.headersSent)return jsonError(409,'Task images are unavailable or changed during export');res.destroy();return res;}
  finally{res.off('close',close);tracker.users.delete(userKey);tracker.tasks.delete(taskKey);}
}
