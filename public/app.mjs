import {previewLayout} from './grid-layout.mjs';
import {taskParameters} from './task-state.mjs';
import {disposeTaskExports} from './tasks.mjs';
import { renderAuth, renderWorkspace } from './views.mjs';
import { el, button, t, icon } from './ui.mjs';
import {generationBlock} from './workspace-state.mjs';

const app = document.querySelector('#app');
const defaults = { prompt:'', negativePrompt:'bad quality,worst quality', modelId:'', batchSize:1, repeat:1, width:1024, height:1024, steps:8, cfg:1, sampler:'euler', scheduler:'simple', seed:-1, denoise:1 };
const state = {
  user:null, setupRequired:false, authMode:'login', authBusy:false, models:[], capabilities:{}, batches:[],
  activeBatchId:null, activeView:'generate', language:'zh', theme:'light', loading:false,
  draft:{...defaults}, advanced:false, historyFilters:{q:'',date:'',sort:'desc'}, historyBatches:[],
  taskParams:taskParameters(defaults),taskPresetId:null,taskParamsExpanded:false,presetEditor:null,presetSaveBusy:false,historySelection:[],
  tasks:[], taskDraft:{name:'',text:'',parseMode:'lines',gridColumns:4,gridLabels:true}, taskBusy:false, selectedTaskId:null, imageIndices:{}, imageView:'grid',
  adminDefaults:null,adminData:null, adminTab:'models', railOpen:false, presets:[], activePresetId:null, presetName:'', presetBusy:false,
  heroCollapsed:false,navCollapsed:false,navOpen:false,
};
let pollBusy = false;
let filterTimer;
let historyRequest = 0;
let lastCapabilitiesAt = Date.now();
let composing=false,renderPending=false;
const media = matchMedia('(prefers-color-scheme: dark)');

let sessionEpoch=0;
const pendingRequests=new Set();
function clearPrivateSession(){
  sessionEpoch++;
  for(const controller of pendingRequests)controller.abort();pendingRequests.clear();
  for(const dialog of document.querySelectorAll('.image-dialog,.batch-dialog,.confirm-dialog')){for(const image of dialog.querySelectorAll('img'))image.removeAttribute('src');if(dialog.open)dialog.close();dialog.remove();}
  disposeTaskExports();
  Object.assign(state,{user:null,batches:[],historyBatches:[],historySelection:[],presets:[],presetEditor:null,presetName:'',activePresetId:null,adminData:null,tasks:[],selectedTaskId:null,activeBatchId:null,imageIndices:{},draft:{...defaults},taskParams:taskParameters(defaults),taskPresetId:null,taskDraft:{name:'',text:'',parseMode:'lines',gridColumns:4,gridLabels:true},loading:false,taskBusy:false});
}
async function request(path,options={}){
  const epoch=sessionEpoch,controller=new AbortController();pendingRequests.add(controller);
  try{
    const response=await fetch(path,{credentials:'same-origin',...options,signal:controller.signal,headers:{'Content-Type':'application/json',...options.headers}});
    let data={};try{data=await response.json();}catch{}
    if(epoch!==sessionEpoch)throw new DOMException('Session changed','AbortError');
    if(!response.ok){
      if(response.status===401&&state.user){clearPrivateSession();render();}
      const error=new Error(data.error||`Request failed (${response.status})`);error.status=response.status;throw error;
    }
    return data;
  }finally{pendingRequests.delete(controller);}
}

function toast(message, type = 'error') {
  const translations = {
    'Batch not found':'任务不存在', 'Batch is not active':'该任务已结束，请刷新队列', 'Unable to cancel batch':'取消任务失败，请重试',
    'Invalid username or password':'用户名或密码错误', 'Invalid or expired invite':'邀请码无效、已使用或已过期',
    'Username already exists':'用户名已存在', 'Invalid registration':'请检查用户名、两次密码和邀请码',
    'Invalid credentials':'请检查用户名和密码长度（密码最多 128 位）', 'Invalid setup key':'初始化密钥不正确', 'Too many requests':'请求过于频繁，请稍后再试', 'Current password is incorrect':'当前密码不正确', 'Use a new password of 12–128 characters':'请设置 12–128 位的新密码，并确保两次输入一致',
    'Invalid generation parameters':'请检查生成参数范围、图片尺寸和种子', 'Too many login attempts':'尝试次数过多，请稍后重试',
    'Authentication required':'登录已失效，请重新登录', 'Active generations must finish before clearing history':'有任务正在处理，请等待完成或取消后再清除', 'Invalid preset':'请检查预设名称和参数范围', 'Preset name already exists':'该预设名称已存在，请换一个名称', 'Active generations must finish or be cancelled first':'请先等待生成完成或取消任务', 'Preset limit reached':'最多可保存 30 组预设，同名保存可覆盖更新', 'Unknown or disabled model':'模型已停用或不存在，请重新选择',
  };
  const node = el('div',{class:`toast ${type}`,text:state.language === 'zh' ? translations[message] || message : message});
  document.querySelector('#toast-region').append(node); setTimeout(()=>node.remove(),5000);
}
function positionToasts() {
  const region=document.querySelector('#toast-region');
  const canvas=app.querySelector('.canvas-wrap');
  const anchor=app.querySelector('.canvas-result-foot')||app.querySelector('.composer');
  if(!canvas||!anchor){region.style.removeProperty('right');region.style.removeProperty('bottom');region.style.removeProperty('max-width');return;}
  const bounds=canvas.getBoundingClientRect(), target=anchor.getBoundingClientRect();
  region.style.right=`${Math.max(12,innerWidth-bounds.right+20)}px`;
  region.style.bottom=`${Math.max(20,innerHeight-target.top+12)}px`;
  region.style.maxWidth=`${Math.max(0,bounds.width-40)}px`;
}
const toastLayoutObserver=new ResizeObserver(positionToasts);
window.addEventListener('resize',positionToasts);
window.addEventListener('scroll',positionToasts,true);
function layoutPreview(){
  const grid=app.querySelector('.result-grid');
  if(!grid)return;
  const ratios=[...grid.querySelectorAll('img')].map(img=>img.naturalWidth&&img.naturalHeight?img.naturalWidth/img.naturalHeight:Number(grid.dataset.imageAspect));
  const gap=parseFloat(getComputedStyle(grid).gap)||0;
  const {columns,rows}=previewLayout(ratios.length,grid.clientWidth,grid.clientHeight,ratios,gap);
  grid.style.gridTemplateColumns=`repeat(${columns},minmax(0,1fr))`;
  grid.style.gridTemplateRows=`repeat(${rows},minmax(0,1fr))`;
}
const previewObserver=new ResizeObserver(layoutPreview);
app.addEventListener('load',event=>{if(event.target.matches?.('.result-grid img'))layoutPreview();},true);
function render() {
  if(composing){renderPending=true;return;}
  renderPending=false;
  const active = document.activeElement;
  const focus = active?.name ? { name:active.name, start:active.selectionStart, end:active.selectionEnd,scroll:active.scrollTop } : null;
  const focusLabel=active?.getAttribute('aria-label');
  const scroll=app.querySelector('.center-stage')?.scrollTop;
  document.documentElement.dataset.theme = state.theme === 'system' ? (media.matches ? 'dark' : 'light') : state.theme;
  document.documentElement.lang = state.language === 'en' ? 'en' : 'zh-CN';
  app.replaceChildren(state.user ? renderWorkspace(state,actions) : renderAuth(state,actions));
  previewObserver.disconnect();
  const preview=app.querySelector('.result-grid');
  if(preview){layoutPreview();previewObserver.observe(preview);}
  toastLayoutObserver.disconnect();
  for(const node of app.querySelectorAll('.composer,.canvas-wrap,.canvas-result-foot'))toastLayoutObserver.observe(node);
  positionToasts();
  const stage=app.querySelector('.center-stage');if(stage&&scroll)stage.scrollTop=scroll;
  if (focus) {
    const input = [...app.querySelectorAll('[name]')].find(n=>n.name===focus.name);
    if (input) { input.focus({preventScroll:true});input.scrollTop=focus.scroll; try { input.setSelectionRange(focus.start,focus.end); } catch {} }
  }
  else if(focusLabel){[...app.querySelectorAll('button[aria-label]')].find(node=>node.getAttribute('aria-label')===focusLabel)?.focus({preventScroll:true});}
  const overlay=state.navOpen?app.querySelector('.side-nav'):state.railOpen&&matchMedia('(max-width:1279px)').matches?app.querySelector('.right-rail'):null;
  if(overlay){for(const sibling of overlay.parentElement.children)if(sibling!==overlay&&!sibling.matches('.nav-scrim,.queue-scrim'))sibling.inert=true;if(!overlay.contains(document.activeElement))overlay.querySelector('button')?.focus();}
}
async function refreshBatches() {
  const data = await request('/api/batches?sort=desc');
  const changed = JSON.stringify(data.batches) !== JSON.stringify(state.batches);
  state.batches = data.batches;
  if (!state.activeBatchId && state.batches.length) state.activeBatchId = state.batches[0].id;
  return changed;
}
async function loadWorkspace() {
  state.theme = state.user.preferences?.theme || 'light'; state.language = state.user.preferences?.language || 'zh';
  const [models,caps,saved] = await Promise.all([request('/api/models'),request('/api/capabilities'),request('/api/presets')]);
  state.models = models.models; state.capabilities = caps; state.imageView=state.user.preferences?.imageView||'grid';
  state.presets=saved.presets; state.activePresetId=saved.activePresetId;
  const selected=state.presets.find(p=>p.id===state.activePresetId);
  state.draft={...defaults,modelId:state.models[0]?.id??'',...selected?.params};
  if(saved.preferredModelId!=null)state.draft.modelId=saved.preferredModelId;
  state.presetName=selected?.name||'';
  state.taskParams=taskParameters(defaults,{modelId:state.models[0]?.id??''});state.taskPresetId=null;
  if(selected && !state.models.some(m=>String(m.id)===String(state.draft.modelId))) {
    state.draft.modelId=''; toast(t(state,'预设中的模型不可用，请选择模型','The preset model is unavailable. Choose a model.'));
  }
  try { const visible=localStorage.getItem(`nibiru.rail.${state.user.id}`); state.railOpen=matchMedia('(min-width:1280px)').matches&&visible!=='false';state.heroCollapsed=localStorage.getItem(`nibiru.hero.${state.user.id}`)==='compact'; }
  catch { state.railOpen=matchMedia('(min-width:1280px)').matches; }
  await refreshBatches();
}
async function loadHistory() {
  const version = ++historyRequest;
  const params = new URLSearchParams({...state.historyFilters,tzOffset:String(new Date().getTimezoneOffset())});
  const data = await request(`/api/batches?${params}`);
  if (version === historyRequest) state.historyBatches = data.batches;
}
const actions = {
  toast,
  setComposing(value){composing=value;if(!value&&renderPending)queueMicrotask(render);},
  toggleHero(){state.heroCollapsed=!state.heroCollapsed;try{localStorage.setItem(`nibiru.hero.${state.user.id}`,state.heroCollapsed?'compact':'expanded');}catch{} render();app.querySelector('.hero-toggle')?.focus({preventScroll:true});},
  toggleNav(){if(matchMedia('(max-width:760px)').matches){state.navOpen=!state.navOpen;if(state.navOpen)state.railOpen=false;}else state.navCollapsed=!state.navCollapsed;render();if(!state.navOpen)app.querySelector('.nav-toggle')?.focus({preventScroll:true});},
  setAuthMode(mode) { state.authMode = mode; render(); },
  async auth(form) {
    const payload = Object.fromEntries(new FormData(form));
    if (payload.confirmPassword !== undefined && payload.password !== payload.confirmPassword) return toast(t(state,'两次密码不一致','Passwords do not match'));
    clearPrivateSession();state.authBusy = true; form.querySelector('button[type=submit]').disabled = true;
    try {
      const endpoint = state.setupRequired ? '/api/setup' : `/api/auth/${state.authMode}`;
      state.user = (await request(endpoint,{method:'POST',body:JSON.stringify(payload)})).user;
      state.setupRequired = false; state.activeView = 'generate'; await loadWorkspace(); render();
    } catch (error) { toast(error.message); } finally { state.authBusy = false; const b=form.querySelector('button[type=submit]'); if(b)b.disabled=false; }
  },
  async logout() {
    try { await request('/api/auth/logout',{method:'POST'}); clearPrivateSession();render(); }
    catch(error){toast(error.message);}
  },
  async navigate(view) {
    document.body.classList.remove('nav-open');state.navOpen=false;state.activeView=view;
    try { if(view==='history'){await refreshBatches();await loadHistory();} if(view==='settings')state.presets=(await request('/api/presets')).presets; if(view==='tasks')state.tasks=(await request('/api/tasks')).tasks; if(view==='admin'){state.adminData=await request('/api/admin/overview');state.adminDefaults=(await request('/api/admin/workspace-defaults')).defaults;state.presets=(await request('/api/presets')).presets;} } catch(error){toast(error.message);}
    render();
  },
  newIdea() { state.draft.prompt=''; render(); document.querySelector('[name=prompt]')?.focus(); },
  setDraft(name,value) { state.draft[name] = value;if(name==='modelId'){request('/api/preferences',{method:'PATCH',body:JSON.stringify({preferredModelId:value===''?null:Number(value)})}).catch(error=>toast(error.message));render();} },
  setAdvanced(value) { state.advanced = value; render(); },
  suggestion(prompt) { state.draft.prompt=prompt;render();document.querySelector('[name=prompt]')?.focus(); },
  selectBatch(id) { state.activeBatchId=id;if(matchMedia('(max-width:1279px)').matches)state.railOpen=false;render(); },
  toggleRail() { state.railOpen=!state.railOpen;state.navOpen=false;try{localStorage.setItem(`nibiru.rail.${state.user.id}`,String(state.railOpen));}catch{} render();if(!state.railOpen)app.querySelector('.rail-toggle')?.focus({preventScroll:true}); },
  async refresh() { try{const [,caps]=await Promise.all([refreshBatches(),request('/api/capabilities')]);state.capabilities=caps;lastCapabilitiesAt=Date.now();render();}catch(error){toast(error.message);} },
  setPresetName(value) { state.presetName=value; },
  async savePreset() {
    const name=state.presetName.trim();
    if(!name)return toast(t(state,'请为这组参数填写名称','Give these settings a name'));
    const params={...state.draft,modelId:state.draft.modelId===''?null:Number(state.draft.modelId)};
    for(const key of ['batchSize','repeat','width','height','steps','cfg','seed','denoise'])params[key]=Number(params[key]);
    state.presetBusy=true;render();
    try {
      const saved=await request('/api/presets',{method:'POST',body:JSON.stringify({name,params})});
      state.presets=saved.presets;state.activePresetId=saved.activePresetId;state.presetName=name;
      toast(t(state,'参数已保存，下次打开会自动恢复','Settings saved. They will be restored next time.'),'success');
    }catch(error){toast(error.message);}finally{state.presetBusy=false;render();}
  },
  async selectPreset(id) {
    state.presetBusy=true;render();
    try {
      const saved=await request('/api/presets/active',{method:'PATCH',body:JSON.stringify({id:id||null})});
      state.presets=saved.presets;state.activePresetId=saved.activePresetId;
      const selected=state.presets.find(p=>p.id===state.activePresetId);
      state.draft={...defaults,modelId:state.models[0]?.id??'',...selected?.params};
      state.presetName=selected?.name||'';
      if(selected&&!state.models.some(m=>String(m.id)===String(state.draft.modelId))) {state.draft.modelId='';toast(t(state,'预设中的模型不可用，请选择模型','The preset model is unavailable. Choose a model.'));}
    }catch(error){toast(error.message);}finally{state.presetBusy=false;render();}
  },
  async generate() {
    if(generationBlock(state)||composing)return;
    const payload = {...state.draft};
    for(const key of ['batchSize','repeat','width','height','steps','cfg','seed','denoise'])payload[key]=Number(payload[key]);
    state.loading=true;render();
    try {
      const result=await request('/api/generations',{method:'POST',body:JSON.stringify(payload)});
      state.activeBatchId=result.batches[0].id;await refreshBatches();toast(t(state,'已加入生成队列','Added to the queue'),'success');
    }catch(error){toast(error.message);}finally{state.loading=false;render();}
  },
  reuse(batch) {
    state.draft={...defaults,...batch.params,prompt:batch.prompt,negativePrompt:batch.negativePrompt};
    state.activeBatchId=batch.id;state.activeView='generate';state.advanced=true;state.activePresetId=null;state.presetName='';
    if(!state.models.some(m=>String(m.id)===String(state.draft.modelId)))state.draft.modelId=state.models[0]?.id||'';
    render();toast(t(state,'已载入生成参数','Generation settings restored'),'success');
  },
  filterHistory(patch,debounce=false) {
    state.historySelection=[];Object.assign(state.historyFilters,patch); clearTimeout(filterTimer);
    const load=async()=>{try{await loadHistory();if(state.activeView==='history')render();}catch(error){toast(error.message);}};
    if(debounce)filterTimer=setTimeout(load,350);else load();
  },
  async changePassword(form){
    const values=Object.fromEntries(new FormData(form));
    if(values.newPassword!==values.confirmPassword)return toast(t(state,'两次新密码不一致','New passwords do not match'));
    const submit=form.querySelector('button[type=submit]');submit.disabled=true;
    try{await request('/api/auth/password',{method:'POST',body:JSON.stringify(values)});form.reset();toast(t(state,'密码已修改，其他登录会话已退出','Password changed. Other sessions have been signed out.'),'success');}catch(error){toast(error.message);}finally{submit.disabled=false;}
  },
  async savePreferences(theme,language,imageView=state.imageView) {
    try{const result=await request('/api/preferences',{method:'PATCH',body:JSON.stringify({theme,language,imageView})});state.user=result.user;state.theme=theme;state.language=language;state.imageView=imageView;render();}
    catch(error){toast(error.message);}
  },
  setImageIndex(batchId,index){state.imageIndices[batchId]=index;},
  async confirm(title,message,label) {
    return new Promise(resolve=>{
      const dialog=el('dialog',{class:'confirm-dialog','aria-label':title},el('h2',{text:title}),el('p',{text:message}));
      dialog.append(el('div',{class:'confirm-actions'},button(t(state,'取消','Cancel'),()=>dialog.close('cancel')),button(label,()=>dialog.close('confirm'),'button danger')));
      dialog.addEventListener('close',()=>{resolve(dialog.returnValue==='confirm');dialog.remove();},{once:true});document.body.append(dialog);dialog.showModal();
    });
  },
  async clearHistory(){
    if(!await actions.confirm(t(state,'清除历史记录？','Clear history?'),t(state,'这将永久删除当前账户的历史记录和已保存图片。账户、参数预设不会删除。有进行中的任务时，请先等待完成或取消。','This permanently removes your history and saved images. Your account and presets remain. Wait for or cancel active tasks first.'),t(state,'确认清除','Clear history')))return;
    try{await request('/api/history',{method:'DELETE',body:JSON.stringify({confirm:true})});disposeTaskExports();state.batches=[];state.historyBatches=[];state.tasks=[];state.activeBatchId=null;state.selectedTaskId=null;render();toast(t(state,'历史记录已清除','History cleared'),'success');}catch(error){toast(error.message);}
  },
  async deleteModel(model){
    if(!await actions.confirm(t(state,'删除注册模型？','Delete registered model?'),t(state,`移除“${model.name}”的网站注册。历史图片会保留，远端模型文件不会删除。`,`Remove “${model.name}” from this website. Existing images and the remote model file remain.`),t(state,'删除注册','Delete registration')))return;
    try{await actions.admin(`/api/admin/models/${model.id}`,{method:'DELETE',body:JSON.stringify({confirm:true})});}catch{}
  },
  setTaskParamsExpanded(value){state.taskParamsExpanded=value;},
  setTaskParam(name,value){state.taskParams[name]=value;state.taskPresetId=null;const select=document.getElementById('taskParam-preset');if(select)select.value='';},
  loadTaskPreset(id){
    const preset=state.presets.find(p=>p.id===id);
    state.taskParams=taskParameters(defaults,{modelId:state.models[0]?.id??'',...preset?.params});state.taskPresetId=preset?.id||null;render();
  },
  editPreset(preset){state.presetEditor={id:preset.id,name:preset.name,params:{...preset.params},originalParams:{...preset.params}};render();},
  updatePresetEditor(name,value){if(!state.presetEditor)return;if(name==='name')state.presetEditor.name=value;else state.presetEditor.params[name]=value;},
  cancelPresetEditing(){state.presetEditor=null;render();},
  async savePresetEdits(){
    if(!state.presetEditor||state.presetSaveBusy)return;
    const editor=state.presetEditor,params={...editor.params};
    for(const name of ['modelId','batchSize','repeat','width','height','steps','cfg','seed','denoise'])params[name]=params[name]===null?null:Number(params[name]);
    state.presetSaveBusy=true;
    try{const data=await request(`/api/presets/${editor.id}`,{method:'PATCH',body:JSON.stringify({name:editor.name,...(JSON.stringify(params)!==JSON.stringify(editor.originalParams)?{params}:{})})});state.presets=data.presets;state.activePresetId=data.activePresetId;state.presetEditor=null;toast(t(state,'预设已更新','Preset updated'),'success');}catch(error){toast(error.message);}finally{state.presetSaveBusy=false;render();}
  },
  async deletePreset(preset){
    if(!await actions.confirm(t(state,'删除参数预设？','Delete preset?'),t(state,`删除“${preset.name}”，不会删除图片或修改已提交的任务。`,`Delete “${preset.name}”? Images and submitted tasks are retained.`),t(state,'删除预设','Delete preset')))return;
    try{const data=await request(`/api/presets/${preset.id}`,{method:'DELETE',body:JSON.stringify({confirm:true})});state.presets=data.presets;state.activePresetId=data.activePresetId;if(state.taskPresetId===preset.id)state.taskPresetId=null;if(state.presetEditor?.id===preset.id)state.presetEditor=null;render();}catch(error){toast(error.message);}
  },
  toggleHistoryBatch(id,checked){state.historySelection=checked?[...new Set([...state.historySelection,id])]:state.historySelection.filter(x=>x!==id);render();},
  selectHistoryPage(){state.historySelection=state.historyBatches.filter(b=>!['queued','running'].includes(b.status)).map(b=>b.id);render();},
  clearHistorySelection(){state.historySelection=[];render();},
  async deleteHistoryItems({batchIds=[],imageIds=[]}={}){
    if(!batchIds.length&&!imageIds.length)return;
    const message=t(state,`将永久删除 ${batchIds.length?`${batchIds.length} 个批次及其中所有图片`:`${imageIds.length} 张图片`}。此操作无法撤销。`,`Permanently delete ${batchIds.length?`${batchIds.length} batches and all their images`:`${imageIds.length} images`}? This cannot be undone.`);
    if(!await actions.confirm(t(state,'删除所选历史？','Delete selected history?'),message,t(state,'确认删除','Delete')))return;
    try{await request('/api/history/selection',{method:'DELETE',body:JSON.stringify({batchIds,imageIds,confirm:true})});disposeTaskExports();state.historySelection=[];await refreshBatches();await loadHistory();if(!state.batches.some(b=>b.id===state.activeBatchId))state.activeBatchId=state.batches[0]?.id||null;document.querySelector('.batch-dialog')?.close();document.querySelector('.image-dialog')?.close();render();toast(t(state,'所选历史已删除','Selection deleted'),'success');}catch(error){toast(error.message);}
  },
  showBatch(batch){
    const dialog=el('dialog',{class:'batch-dialog','aria-label':t(state,'批次图片','Batch images')});
    const selected=new Set();const canDelete=!['queued','running'].includes(batch.status);
    const bulk=button(t(state,'删除选中图片','Delete selected images'),()=>actions.deleteHistoryItems({imageIds:[...selected]}),'button danger',{disabled:true});
    dialog.append(el('div',{class:'batch-dialog-head'},el('h2',{text:`${batch.modelName} · ${batch.images.length} ${t(state,'张图片','images')}`}),button(icon('close'),()=>dialog.close(),'icon-button',{'aria-label':t(state,'关闭批次预览','Close batch preview')})));
    dialog.append(el('div',{class:'batch-dialog-grid'},batch.images.map((image,index)=>el('article',{},button(el('img',{src:image.url,alt:batch.prompt}),()=>actions.showImage(image,batch),'batch-dialog-image'),
      el('div',{class:'batch-dialog-actions'},el('label',{},el('input',{type:'checkbox',disabled:!canDelete,'aria-label':t(state,`选择图片 ${index+1}`,`Select image ${index+1}`),onchange:e=>{if(e.target.checked)selected.add(image.id);else selected.delete(image.id);bulk.disabled=!selected.size;}}),`${index+1}`),
        el('a',{href:`${image.url}?download=1`,download:`nibiru-${image.id}.png`,class:'text-button'},t(state,'下载','Download')),button(t(state,'删除','Delete'),()=>actions.deleteHistoryItems({imageIds:[image.id]}),'text-button danger',{disabled:!canDelete}))))));
    dialog.append(el('div',{class:'confirm-actions'},bulk));dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
  },
  setTaskDraft(name,value){state.taskDraft[name]=value;if(name==='batchSize')state.taskParams.batchSize=Number(value);if(['gridColumns','gridLabels'].includes(name))render();},
  selectTask(id){state.selectedTaskId=id;render();},
  async refreshTasks(){try{state.tasks=(await request('/api/tasks')).tasks;render();}catch(error){toast(error.message);}},
  async submitTask(){
    if(state.taskBusy)return;
    const requestKey=state.taskDraft.requestKey||crypto.randomUUID();state.taskDraft.requestKey=requestKey;
    const params={...state.taskParams,repeat:1};for(const key of ['batchSize','repeat','width','height','steps','cfg','seed','denoise'])params[key]=Number(params[key]);
    state.taskBusy=true;render();
    try{const result=await request('/api/tasks',{method:'POST',body:JSON.stringify({name:state.taskDraft.name,text:state.taskDraft.text,parseMode:state.taskDraft.parseMode,params,requestKey})});state.selectedTaskId=result.task.id;state.taskDraft.requestKey=null;state.tasks=[result.task,...state.tasks.filter(x=>x.id!==result.task.id)];toast(t(state,'批量任务已加入轮转队列','Batch task added to the fair queue'),'success');}
    catch(error){toast(error.message);}finally{state.taskBusy=false;render();}
  },
  async cancelBatch(id){
    if(!await actions.confirm(t(state,'删除待处理任务？','Cancel pending images?'),t(state,'将取消这个批次中尚未开始的图片，已生成的图片会保留。正在生成的单张图片完成后仍会保存。','Cancel unstarted images in this batch. Completed images and the image already running will be saved.'),t(state,'删除待处理','Cancel pending')))return;
    try{await request(`/api/batches/${id}/cancel`,{method:'POST',body:JSON.stringify({})});await refreshBatches();render();toast(t(state,'已取消待处理图片','Pending images cancelled'),'success');}catch(error){toast(error.message);}
  },
  async cancelTask(id){
    if(!await actions.confirm(t(state,'取消剩余任务？','Cancel remaining images?'),t(state,'停止提交未开始的图片；当前正在生成的单张图片完成后仍会保存。','Unstarted images will be cancelled. The image already running will finish and be saved.'),t(state,'取消剩余','Cancel remaining')))return;
    try{await request(`/api/tasks/${id}/cancel`,{method:'POST',body:JSON.stringify({})});await actions.refreshTasks();}catch(error){toast(error.message);}
  },
  async saveWorkspaceDefaults(form){
    const values=Object.fromEntries(new FormData(form));const submit=form.querySelector('button[type=submit]');submit.disabled=true;
    try{const result=await request('/api/admin/workspace-defaults',{method:'PATCH',body:JSON.stringify({modelId:values.modelId?Number(values.modelId):null,presetId:values.presetId==='__saved__'?null:values.presetId||null,keepPreset:values.presetId==='__saved__'})});state.adminDefaults=result.defaults;toast(t(state,'新用户初始默认值已保存，不影响已进入工作区的用户','Initial defaults saved. Existing workspaces are unchanged.'),'success');render();}catch(error){toast(error.message);submit.disabled=false;}
  },
  setAdminTab(tab){state.adminTab=tab;render();},
  async admin(path,options) {
    try{const result=await request(path,options);state.adminData=await request('/api/admin/overview');state.models=(await request('/api/models')).models;render();return result;}
    catch(error){toast(error.message);throw error;}
  },
  showImage(image,batch) {
    if(!image?.url)return;
    const dialog=el('dialog',{class:'image-dialog','aria-label':t(state,'图片预览','Image preview')});
    const close=button(icon('close'),()=>dialog.close(),'dialog-close',{'aria-label':t(state,'关闭','Close')});
    const toolbar=el('div',{class:'dialog-actions'},el('span',{class:'dialog-caption',text:`${batch?.modelName||'Nibiru'} · ${batch?.params?.width||''} × ${batch?.params?.height||''}`}),
      el('a',{href:`${image.url}?download=1`,download:`nibiru-${image.id}.png`,class:'button primary'},icon('down'),t(state,'下载原图','Download')));
    if(batch)toolbar.append(button(t(state,'复用参数','Reuse settings'),()=>{dialog.close();actions.reuse(batch);}));
    dialog.append(close,el('img',{src:image.url,alt:batch?.prompt||'Generated image'}),toolbar);
    dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
  },
};
media.addEventListener('change',()=>{if(state.theme==='system')render();});
document.addEventListener('keydown',event=>{
  const overlay=state.navOpen?app.querySelector('.side-nav'):state.railOpen&&matchMedia('(max-width:1279px)').matches?app.querySelector('.right-rail'):null;
  if(!overlay)return;
  if(event.key==='Escape'){event.preventDefault();state.navOpen?actions.toggleNav():actions.toggleRail();return;}
  if(event.key==='Tab'){const items=[...overlay.querySelectorAll('button,a,input,select,textarea')].filter(node=>!node.disabled&&node.getClientRects().length);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
});
matchMedia('(max-width:1279px)').addEventListener('change',()=>{state.railOpen=false;state.navOpen=false;if(state.user)render();});
setInterval(async()=>{
  if(!state.user||pollBusy||document.hidden)return;pollBusy=true;
  try {let changed=await refreshBatches();if(Date.now()-lastCapabilitiesAt>30000){lastCapabilitiesAt=Date.now();const caps=await request('/api/capabilities');changed=changed||caps.online!==state.capabilities.online;state.capabilities=caps;}if(state.activeView==='tasks'){const tasks=(await request('/api/tasks')).tasks;changed=changed||JSON.stringify(tasks)!==JSON.stringify(state.tasks);state.tasks=tasks;}if(changed){if(state.activeView==='history')await loadHistory();render();}}catch(error){if(error.status===401)toast(error.message);}finally{pollBusy=false;}
},2000);
async function init(){
  try{const session=await request('/api/session');state.user=session.user;state.setupRequired=session.setupRequired;if(state.user)await loadWorkspace();}
  catch(error){toast(error.message);}render();
}
init();
