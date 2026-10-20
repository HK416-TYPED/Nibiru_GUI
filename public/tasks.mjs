import { el, field, button, icon, t, dateTime } from './ui.mjs';
import {renderTaskParameters} from './parameter-editor.mjs';
import {gridLayout} from './grid-layout.mjs';

const imageCache = new Map();
const exportState = new Map();
const text = (state, zh, en) => t(state, zh, en);
const safeNumber = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const getDraft = state => ({...state.taskDraft,batchSize:Number(state.taskParams.batchSize),repeat:1});
const normalizeText = value => String(value || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const parsedPrompts = draft => (draft.parseMode === 'paragraphs' ? normalizeText(draft.text).split(/\n\s*\n/).map(v=>v.trim()).filter(Boolean) : normalizeText(draft.text).split('\n').map(v=>v.trim()).filter(Boolean));
const countPrompts = draft => parsedPrompts(draft).length;
const statusLabel = (state, status) => ({ queued: text(state,'排队中','Queued'), running: text(state,'生成中','Running'), completed: text(state,'已完成','Completed'), failed: text(state,'有失败','Partial failure'), cancelled: text(state,'已取消','Cancelled'),cancelling:text(state,'取消中','Cancelling') }[status] || status);

function draftPreview(state, actions) {
  const draft = getDraft(state); const prompts = parsedPrompts(draft);
  const total = prompts.length * safeNumber(draft.repeat, 1) * safeNumber(draft.batchSize, 1);
  const notice = total > 4096 || prompts.length > 128 ? text(state, '超过任务限制，请减少 prompt 或生成次数。', 'This exceeds the task limits. Reduce prompts or repeats.') : '';
  return el('div',{class:`tasks-preview ${notice?'is-error':''}`},el('div',{class:'tasks-preview-head'},el('strong',{},text(state,'预览','Preview')),el('span',{},`${prompts.length} ${text(state,'条 prompt','prompts')} · ${total} ${text(state,'张图片','images')}`)),notice&&el('p',{class:'tasks-error',role:'alert'},notice),el('ol',{},...prompts.slice(0,5).map(prompt=>el('li',{},prompt.slice(0,180)))),prompts.length>5&&el('small',{class:'muted'},`+${prompts.length-5} ${text(state,'条','more')}`));
}

function draftForm(state, actions) {
  const draft = getDraft(state); let preview=draftPreview(state,actions); const textInput = el('textarea',{class:'tasks-textarea',rows:'9',name:'text',value:draft.text||'',placeholder:text(state,'每行一个 prompt，或用空行分段…','One prompt per line, or blank lines between paragraphs…'),oninput:e=>{actions.setTaskDraft('text',e.target.value); const next=draftPreview(state,actions); preview.replaceWith(next); preview=next; }});
  const fileInput=el('input',{type:'file',accept:'.txt,text/plain',class:'tasks-file-input',onchange:async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>1000000){actions.toast(text(state,'TXT 文件不能超过 1 MB。','TXT files must be under 1 MB.'),'error');e.target.value='';return}try{const content=normalizeText(await file.text());actions.setTaskDraft('text',content);textInput.value=content;if(!nameInput.value.trim()){nameInput.value=file.name.replace(/\.txt$/i,'');actions.setTaskDraft('name',nameInput.value)}const next=draftPreview(state,actions);preview.replaceWith(next);preview=next}catch{actions.toast(text(state,'读取文件失败。','Could not read that file.'),'error')}}});
  const nameInput=input({name:'name',value:draft.name||'',required:'',maxlength:'80',placeholder:text(state,'例如：十月风格测试','e.g. October style study'),oninput:e=>actions.setTaskDraft('name',e.target.value)}); let renderPreview=()=>{};
  const mode=el('select',{name:'parseMode',value:draft.parseMode||'lines',onchange:e=>{actions.setTaskDraft('parseMode',e.target.value);renderPreview()}},el('option',{value:'lines'},text(state,'每行一个 prompt','One prompt per line')),el('option',{value:'paragraphs'},text(state,'空行分段','Blank-line paragraphs')));
  const repeat=input({name:'task-repeat',type:'number',value:1,readonly:true,'aria-label':text(state,'重复次数（固定为1）','Repeats (fixed at 1)')}); const batch=el('select',{name:'batchSize',value:draft.batchSize||1,onchange:e=>{actions.setTaskDraft('batchSize',Number(e.target.value));renderPreview()}},...[1,2,4,8].map(n=>el('option',{value:n},String(n))));
  const gridColumns=el('select',{name:'gridColumns',value:draft.gridColumns||4,onchange:e=>actions.setTaskDraft('gridColumns',Number(e.target.value))},...[1,2,3,4,8].map(n=>el('option',{value:n},String(n)))); const labels=el('label',{class:'tasks-check'},el('input',{type:'checkbox',checked:draft.gridLabels!==false,onchange:e=>actions.setTaskDraft('gridLabels',e.target.checked)}),el('span',{},text(state,'拼图显示标签','Label grid images')));
  const form=el('form',{class:'tasks-form',onsubmit:e=>{e.preventDefault();const draftNow=getDraft(state);if(new TextEncoder().encode(normalizeText(draftNow.text)).length>1000000){actions.toast(text(state,'文本超过 1 MB。','Text exceeds 1 MB.'),'error');return}actions.setTaskDraft('name',nameInput.value.trim());actions.submitTask();}}); renderPreview=()=>{const next=draftPreview(state,actions);preview.replaceWith(next);preview=next};
  form.append(el('details',{class:'task-parameter-section',open:state.taskParamsExpanded,ontoggle:e=>actions.setTaskParamsExpanded(e.target.open)},el('summary',{},text(state,'任务生成参数 · 独立设置','Task generation settings · Independent')),renderTaskParameters(state,actions)),field(text(state,'任务名称','Task name'),nameInput),field(text(state,'解析方式','Parse mode'),mode),field(text(state,'批次大小','Batch size'),batch),field(text(state,'重复次数','Repeats'),repeat),field(text(state,'Prompt 文本','Prompt text'),textInput),field(text(state,'从 TXT 导入','Import TXT'),fileInput),preview,el('div',{class:'tasks-grid-options'},field(text(state,'拼图列数','Grid columns'),gridColumns),labels),el('div',{class:'tasks-actions'},button(text(state,'提交任务','Submit task'),()=>{},'button primary',{type:'submit',disabled:!!state.taskBusy}),button(text(state,'清空','Clear'),()=>{actions.setTaskDraft('text','');actions.setTaskDraft('name','');textInput.value='';nameInput.value='';const next=draftPreview(state,actions);preview.replaceWith(next);preview=next},'button'))); return form;
}
function input(attrs={}) { return el('input',attrs); }

export function disposeTaskExports(){
  for(const image of imageCache.values())image.removeAttribute('src');

  for(const value of exportState.values())if(value.url)URL.revokeObjectURL(value.url);
  imageCache.clear();exportState.clear();
}
async function loadImage(image){
  if(imageCache.has(image.id))return imageCache.get(image.id);
  const loaded=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Image unavailable'));img.src=image.url;});
  imageCache.set(image.id,loaded);
  if(imageCache.size>128)imageCache.delete(imageCache.keys().next().value);
  return loaded;
}

function flattenImages(task){return(task.batches||[]).flatMap(batch=>(batch.images||[]).map(image=>({image,batch})));}
async function exportPage(state,task,items,pageNumber){
  const draft=getDraft(state),layout=gridLayout(items.length,Number(draft.gridColumns)||4,draft.gridLabels!==false);
  const canvas=document.createElement('canvas');canvas.width=layout.width;canvas.height=layout.height;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');
  ctx.fillStyle='#f7f7ef';ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let i=0;i<items.length;i++){
    const item=items[i],image=await loadImage(item.image);
    const x=(i%layout.columns)*layout.cell,y=Math.floor(i/layout.columns)*(layout.cell+layout.labelHeight);
    const scale=Math.min(layout.cell/image.naturalWidth,layout.cell/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
    ctx.drawImage(image,x+(layout.cell-w)/2,y+(layout.cell-h)/2,w,h);
    if(layout.labelHeight){
      const font=Math.max(7,Math.floor(layout.cell/42));ctx.font=`${font}px system-ui`;ctx.fillStyle='#293329';
      ctx.save();ctx.beginPath();ctx.rect(x,y+layout.cell,layout.cell,layout.labelHeight);ctx.clip();
      ctx.fillText(`${(pageNumber-1)*64+i+1} · ${item.batch.modelName} · seed ${item.image.seed??item.batch.params?.seed}`,x+6,y+layout.cell+font+6);
      ctx.fillText((item.batch.prompt||'').replace(/\s+/g,' ').slice(0,90),x+6,y+layout.cell+2*font+12);ctx.restore();
    }
  }
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('PNG export failed')),'image/png'));
  return {url:URL.createObjectURL(blob),name:`${task.name.replace(/[\/\\:*?"<>|]/g,'_')}-${pageNumber}.png`,width:canvas.width,height:canvas.height};
}
function taskResults(state,actions,task){
  const items=flattenImages(task),draft=getDraft(state);
  const box=el('div',{class:'tasks-export'},el('div',{class:'tasks-section-head'},el('h3',{},text(state,'结果与拼图导出','Results & PNG grids')),el('span',{class:'muted'},`${items.length} ${text(state,'张图片','images')}`)));
  const pages=el('div',{class:'tasks-pages'});
  for(let start=0;start<items.length;start+=64){
    const page=items.slice(start,start+64),number=start/64+1;
    const key=JSON.stringify([task.id,number,draft.gridColumns,draft.gridLabels,page.map(x=>x.image.id)]);
    const saved=exportState.get(key);
    const row=el('div',{class:'tasks-page-row'},el('span',{},text(state,`第 ${number} 页 · ${page.length} 张`,`Page ${number} · ${page.length} images`)),button(text(state,saved?.busy?'正在生成…':'生成 PNG',saved?.busy?'Rendering…':'Generate PNG'),async()=>{
      exportState.set(key,{busy:true});await actions.refreshTasks();
      try{
        const result=await exportPage(state,task,page,number);exportState.set(key,result);
        while(exportState.size>8){const oldest=exportState.keys().next().value;if(oldest===key)break;const value=exportState.get(oldest);if(value.url)URL.revokeObjectURL(value.url);exportState.delete(oldest);}
      }catch(error){console.error('Grid export failed',error);exportState.delete(key);actions.toast(text(state,'图片读取或拼图生成失败，请重试','Could not create the grid. Please retry.'),'error');}
      await actions.refreshTasks();
    },'button small',{disabled:!!saved?.busy}));
    if(saved?.url)row.append(el('a',{class:'button small tasks-download',href:saved.url,download:saved.name},text(state,'下载 PNG','Download PNG')),el('small',{class:'muted',text:`${saved.width} × ${saved.height}`}));
    pages.append(row);
  }
  box.append(pages);
  if(!items.length)box.append(el('p',{class:'muted'},text(state,'生成结果会逐张出现在这里。','Images will appear here as they finish.')));
  box.append(el('div',{class:'tasks-gallery'},items.map(({image,batch},index)=>el('article',{class:'tasks-gallery-item'},button(el('img',{src:image.url,alt:batch.prompt,loading:'lazy'}),()=>actions.showImage(image,batch),'tasks-gallery-image'),el('small',{},`${index+1} · ${batch.modelName} · seed ${image.seed??batch.params.seed}`),button(text(state,'复用参数','Reuse settings'),()=>actions.reuse(batch),'text-button')))));
  for(const batch of task.batches||[])if(batch.status==='failed')box.append(el('p',{class:'tasks-error'},`${batch.prompt.slice(0,80)}: ${batch.error||text(state,'生成失败','Generation failed')}`));
  return box;
}
function taskCard(state,actions,task){const selected=state.selectedTaskId===task.id;const counts=`${task.completedImages||0}/${task.totalImages||0}`;return el('article',{class:`tasks-card ${selected?'selected':''}`},el('button',{class:'tasks-card-main',type:'button',onclick:()=>actions.selectTask(task.id)},el('div',{class:'tasks-card-title'},el('strong',{},task.name),el('span',{class:`tasks-status ${task.status}`},statusLabel(state,task.status))),el('div',{class:'tasks-progress'},el('span',{style:`width:${task.totalImages?Math.min(100,100*task.completedImages/task.totalImages):0}%`}),),el('div',{class:'tasks-card-meta'},el('span',{},counts),el('span',{},dateTime(state,task.createdAt)))),el('a',{href:`/api/tasks/${task.id}/download`,class:'button small task-zip-link','aria-disabled':!task.completedImages||['queued','running','cancelling'].includes(task.status)?'true':'false',onclick:e=>{if(!task.completedImages||['queued','running','cancelling'].includes(task.status))e.preventDefault();}},text(state,'下载全部图片 ZIP','Download all images ZIP')),(task.status==='queued'||task.status==='running')&&button(text(state,'取消','Cancel'),()=>actions.cancelTask(task.id),'button small danger'))}
export function renderTasks(state, actions) {
  const tasks = state.tasks || []; const selected = tasks.find(task => task.id === state.selectedTaskId);
  const heading = el('div',{class:'tasks-heading'},el('h1',{},text(state,'批量任务','Batch tasks')));
  const create = el('section',{class:'tasks-create'},el('div',{class:'tasks-panel'},el('div',{class:'tasks-panel-title'},el('h2',{},text(state,'新建任务','New task')),el('span',{class:'muted'},state.taskBusy?text(state,'提交中…','Submitting…'):'')),draftForm(state,actions)));
  const listContent = tasks.length ? tasks.map(task=>taskCard(state,actions,task)) : [el('div',{class:'tasks-empty'},el('div',{class:'tiny-orbit'}),el('h3',{},text(state,'还没有批量任务','No batch tasks yet')),el('p',{class:'muted'},text(state,'导入一组 prompt，结果会保存在这里。','Import prompts to keep their results here.')) )];
  const list = el('section',{class:'tasks-panel tasks-list-panel'},el('div',{class:'tasks-panel-title'},el('h2',{},text(state,'任务列表','Task list')),button('',actions.refreshTasks,'icon-button',{title:text(state,'刷新','Refresh')})),...listContent);
  const result = selected ? el('section',{class:'tasks-panel tasks-result-panel'},el('div',{class:'tasks-panel-title'},el('h2',{},selected.name),el('span',{class:'muted'},statusLabel(state,selected.status))),taskResults(state,actions,selected)) : null;
  return el('div',{class:'tasks-page'},heading,el('div',{class:'tasks-layout'},create,list,result));
}
