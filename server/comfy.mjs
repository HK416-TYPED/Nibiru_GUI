import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

function req(base, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, base); const fn = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const r = fn(u, { method: opts.method || 'GET', headers: opts.headers || {} }, res => { const chunks=[]; let size=0; res.on('data', c=>{ size+=c.length; if(size>(opts.maxBytes||50*1024*1024)){ r.destroy(new Error('Response too large')); return; } chunks.push(c); }); res.on('end', ()=>resolve({ status:res.statusCode, headers:res.headers, body:Buffer.concat(chunks) })); });
    r.setTimeout(opts.timeout || 15000, () => r.destroy(new Error('ComfyUI request timed out')));
    r.on('error', reject); if (opts.body) r.write(opts.body); r.end();
  });
}
export function makeWorkflow(templatePath, model, p) {
  const wf = JSON.parse(readFileSync(templatePath, 'utf8'));
  const find = (type) => Object.values(wf).find(n => n.class_type === type);
  const k = find('KSampler'); const pos = Object.values(wf).find(n => n._meta?.title === 'Positive') || find('CLIPTextEncode');
  const neg = Object.values(wf).find(n => n._meta?.title === 'Negative'); const latent = find('EmptyLatentImage'); const unet=find('UNETLoader'); const clip=find('CLIPLoader'); const vae=find('VAELoader');
  if (!k || !pos || !latent) throw new Error('workflow missing required nodes');
  Object.assign(k.inputs, { seed:p.seed, steps:p.steps, cfg:p.cfg, sampler_name:p.sampler, scheduler:p.scheduler, denoise:p.denoise });
  pos.inputs.text = p.prompt; if (neg) neg.inputs.text = p.negativePrompt;
  Object.assign(latent.inputs, { width:p.width, height:p.height, batch_size:p.batchSize });
  if (unet && model.kind === 'unet') unet.inputs.unet_name = model.filename;
  if (clip && model.clip_name) { clip.inputs.clip_name=model.clip_name; if(model.clip_type) clip.inputs.type=model.clip_type; }
  if (vae && model.vae_name) vae.inputs.vae_name=model.vae_name;
  if (unet && model.kind === 'checkpoint') {
    const unetId = Object.keys(wf).find(x => wf[x] === unet);
    const clipId = clip && Object.keys(wf).find(x => wf[x] === clip);
    const vaeId = vae && Object.keys(wf).find(x => wf[x] === vae);
    wf[unetId] = { class_type:'CheckpointLoaderSimple', inputs:{ ckpt_name:model.filename }, _meta:{title:'Load Checkpoint'} };
    for (const n of Object.values(wf)) for (const [key,v] of Object.entries(n.inputs||{})) if (Array.isArray(v) && v[0] === clipId) n.inputs[key]=[unetId,1];
    const vaeNode = Object.values(wf).find(n => n.class_type === 'VAEDecode'); if (vaeNode) vaeNode.inputs.vae=[unetId,2];
    delete wf[clipId]; delete wf[vaeId];
  }
  return wf;
}
export async function comfyJson(base, path, method, body) { const r=await req(base,path,{method,body:body&&JSON.stringify(body),headers:body?{'content-type':'application/json'}:{}}); if(r.status < 200 || r.status >= 300) throw new Error(`ComfyUI request rejected (${r.status})`); return JSON.parse(r.body.toString() || '{}'); }
const capabilityCache = new Map();
export async function capabilities(base) {
  const cached = capabilityCache.get(base);
  if (cached && Date.now()-cached.at < 30000) return cached.value;
  try {
    const nodes = ['KSampler','UNETLoader','CheckpointLoaderSimple','CLIPLoader','VAELoader'];
    const responses = await Promise.all(nodes.map(node => comfyJson(base, `/object_info/${node}`, 'GET')));
    const info = Object.assign({}, ...responses);
    const input = (node, key) => info[node]?.input?.required?.[key]?.[0] || info[node]?.input?.optional?.[key]?.[0] || [];
    const value = {
      online: Boolean(info.KSampler),
      samplers: input('KSampler','sampler_name'), schedulers: input('KSampler','scheduler'),
      unets: input('UNETLoader','unet_name'), checkpoints: input('CheckpointLoaderSimple','ckpt_name'),
      clips: input('CLIPLoader','clip_name'), clipTypes: input('CLIPLoader','type'), vaes: input('VAELoader','vae_name'),
    };
    capabilityCache.set(base, { at: Date.now(), value });
    return value;
  } catch {
    return {online:false,samplers:['euler','euler_ancestral','dpmpp_2m','ddim'],schedulers:['simple','normal','karras','exponential'],unets:[],checkpoints:[],clips:[],vaes:[],clipTypes:[]};
  }
}
export async function getHistory(base, promptId) { return comfyJson(base, `/history/${encodeURIComponent(promptId)}`, 'GET'); }
export async function submit(base, workflow, promptId) { return comfyJson(base, '/prompt', 'POST', { prompt:workflow, ...(promptId ? {prompt_id:promptId} : {}) }); }
export async function download(base, q) { const r=await req(base, `/view?${new URLSearchParams(q)}`, {maxBytes:50*1024*1024}); if(r.status!==200) throw new Error(`ComfyUI image ${r.status}`); return r.body; }
