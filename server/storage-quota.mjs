import {statfsSync} from 'node:fs';
export function checkStorageQuota(db,userId,additionalBytes=0,imageDir=null){
  const configured=Number(process.env.MAX_USER_IMAGE_BYTES||20*1024**3);
  const maximum=Number.isSafeInteger(configured)&&configured>0?configured:20*1024**3;
  const used=Number(db.prepare('SELECT COALESCE(SUM(byte_size),0) n FROM images WHERE user_id=?').get(userId).n);
  if(used+additionalBytes>maximum||used>=maximum){const error=new Error('Image storage quota reached. Delete old images before generating more.');error.status=429;throw error;}
  if(imageDir){const fs=statfsSync(imageDir);const free=Number(fs.bavail)*Number(fs.bsize);if(free-additionalBytes<1024**3){const error=new Error('Image storage is low. Free disk space before generating more.');error.status=507;throw error;}}
}
