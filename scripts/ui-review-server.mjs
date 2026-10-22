// Explicitly isolated UI fixtures. Serves the real frontend, never imports the DB or GPU worker.
// Start: node scripts/ui-review-server.mjs; select /__fixture/offline, empty, running, failed, completed, no-models.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../public/',import.meta.url));
const params={modelId:1,batchSize:4,repeat:1,width:1024,height:1024,steps:8,cfg:1,sampler:'euler',scheduler:'simple',seed:-1,denoise:1,negativePrompt:''};
const user={id:999,username:'UI_TEST',role:'admin',preferences:{theme:'light',language:'zh'}};
let submitted=0,lastPayload=null;
const now=new Date().toISOString();
function batch(status,id='fixture-001') {return {id,status,prompt:'隔离测试：雨后的动漫都市，柔和晨光。',negativePrompt:'',modelName:'测试模型 · 不调用 GPU',params:{...params},createdAt:now,images:status==='completed'?[{id:'fixture-image',url:'/assets/nibbles-explorer-cover.png'}]:[],error:status==='failed'?'模拟服务错误：模型加载失败。':undefined};}
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1:3002');
    const scenario=/fixtureScenario=([a-z-]+)/.exec(req.headers.cookie||'')?.[1]||'offline';
    const json=(body,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
    if(url.pathname.startsWith('/__fixture/')){
      const next=url.pathname.split('/').at(-1);if(!['login','setup','offline','empty','running','failed','completed','no-models'].includes(next))return json({error:'Unknown test scenario'},400);
      submitted=0;lastPayload=null;res.writeHead(302,{'set-cookie':`fixtureScenario=${next}; Path=/; SameSite=Strict`,'location':'/'});return res.end();
    }
    if(url.pathname==='/__stats')return json({scenario,submitted,lastPayload});
    let body={};if(['POST','PATCH'].includes(req.method)){const chunks=[];for await(const chunk of req)chunks.push(chunk);body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}
    if(url.pathname==='/api/session')return json({user:['login','setup'].includes(scenario)?null:user,setupRequired:scenario==='setup'});
    if(url.pathname==='/api/models')return json({models:['offline','no-models'].includes(scenario)?[]:[{id:1,name:'测试模型 · 不调用 GPU'}]});
    if(url.pathname==='/api/capabilities')return json({online:scenario!=='offline',samplers:['euler','heun'],schedulers:['simple']});
    if(url.pathname==='/api/preferences'){Object.assign(user.preferences,body);return json({user});}
    if(url.pathname==='/api/presets')return json({presets:[{id:'fixture-preset',name:'测试预设',params:{...params,steps:12}}],activePresetId:null});
    if(url.pathname==='/api/presets/active')return json({presets:[{id:'fixture-preset',name:'测试预设',params:{...params,steps:12}}],activePresetId:body.id});
    if(url.pathname==='/api/batches')return json({batches:['running','failed','completed'].includes(scenario)?[batch(scenario),...(scenario==='running'?[batch('queued','fixture-002')]:[])]:[]});
    if(url.pathname==='/api/generations'){submitted++;lastPayload=body;await new Promise(r=>setTimeout(r,650));return json({batches:[batch('queued')]},201);}
    if(url.pathname==='/api/tasks')return json({tasks:[]});
    if(url.pathname==='/api/admin/overview')return json({models:[],users:[],invites:[],events:[]});
    if(url.pathname==='/api/admin/workspace-defaults')return json({defaults:{}});
    if(url.pathname.startsWith('/api/'))return json({error:'Unimplemented fixture endpoint'},404);
    const file=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root.endsWith(sep)?root:root+sep))return json({error:'Invalid path'},400);
    let data=await readFile(file);if(url.pathname==='/')data=Buffer.from(data.toString().replace('<title>Nibiru Image Lab</title>','<title>ISOLATED UI FIXTURE — no GPU</title>'));
    res.writeHead(200,{'content-type':{'.html':'text/html; charset=utf-8','.css':'text/css','.mjs':'text/javascript','.png':'image/png','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(data);
  }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
server.listen(3002,'127.0.0.1',()=>console.log('Isolated UI fixture: http://127.0.0.1:3002/__fixture/empty — no database or GPU connection'));
