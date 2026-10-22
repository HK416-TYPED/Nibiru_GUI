import {el, field, button, icon, brand, t, dateTime} from './ui.mjs';
import {workspaceIdentity, promptSuggestions} from './workspace-config.mjs';
import {generationBlock, isGenerateShortcut, queueGroups} from './workspace-state.mjs';

export function statusLabel(state, status) {
  return t(state, {queued:'等待中',running:'执行中',completed:'已完成',failed:'失败',cancelled:'已取消'}[status] || status,
    {queued:'Waiting',running:'Running',completed:'Completed',failed:'Failed',cancelled:'Cancelled'}[status] || status);
}

export function connectionStatus(state, detailed=false) {
  const online=state.capabilities.online===true;
  return el('div',{class:`connection-status ${online?'online':'offline'}`,role:'status'},
    el('i',{class:'status-dot','aria-hidden':'true'}),
    el('span',{text:t(state,online?'生成服务已连接':'生成服务未连接',online?'Service connected':'Service offline')}),
    detailed&&el('p',{text:t(state,online?'可以提交创作任务。':'连接恢复前仍可编辑提示词与参数。',online?'Ready to accept generation requests.':'You can keep editing while the service is offline.')}));
}

export function navigation(state, actions) {
  const entries=[['generate','创作工作台','Create','plus'],['tasks','批量任务','Tasks','tasks'],['history','影像档案','Archive','image'],['settings','偏好设置','Settings','settings']];
  if(state.user.role==='admin')entries.push(['admin','管理中心','Administration','shield']);
  return el('aside',{class:`side-nav ${state.navOpen?'is-open':''}`,id:'workspace-navigation','aria-label':t(state,'功能导航','Workspace navigation')},
    el('div',{class:'nav-heading'},el('span',{text:t(state,'创作空间','WORKSPACE')}),button(icon('close'),actions.toggleNav,'icon-button nav-close',{'aria-label':t(state,'关闭导航','Close navigation')})),
    el('nav',{'aria-label':t(state,'主导航','Main navigation')},entries.map(([id,zh,en,glyph],index)=>button([
      icon(glyph),el('span',{text:t(state,zh,en)}),el('small',{class:'nav-index',text:String(index+1).padStart(2,'0'),'aria-hidden':'true'})
    ],()=>actions.navigate(id),`nav-item ${state.activeView===id?'active':''}`,{'aria-current':state.activeView===id?'page':undefined,'aria-label':t(state,zh,en),title:t(state,zh,en)}))),
    el('div',{class:'nav-spacer'}),el('div',{class:'sidebar-note'},el('span',{class:'eyebrow',text:'CREATED BY'}),el('strong',{text:workspaceIdentity.team}),el('span',{text:t(state,'动漫图像 · 内测创作空间','Anime image studio · Private beta')})));
}

export function topbar(state, actions) {
  const labels={generate:['创作工作台','Create'],tasks:['批量任务','Tasks'],history:['影像档案','Archive'],settings:['偏好设置','Settings'],admin:['管理中心','Administration']};
  return el('header',{class:'topbar'},el('div',{class:'header-brand'},brand()),
    button(icon('menu'),actions.toggleNav,'icon-button nav-toggle',{'aria-label':t(state,'展开或收起导航','Toggle navigation'),'aria-controls':'workspace-navigation','aria-expanded':String(matchMedia('(max-width:760px)').matches?state.navOpen:!state.navCollapsed)}),
    el('div',{class:'header-page'},el('strong',{text:t(state,...labels[state.activeView])}),el('span',{text:'IMAGE WORKSPACE'})),
    connectionStatus(state),
    state.activeView==='generate'&&button([icon('tasks'),el('span',{text:t(state,'任务队列','Queue')})],actions.toggleRail,'rail-toggle',{'aria-label':t(state,state.railOpen?'隐藏任务队列':'显示任务队列',state.railOpen?'Hide task queue':'Show task queue'),'aria-controls':'task-queue','aria-expanded':String(state.railOpen)}),
    button([el('span',{class:'avatar',text:state.user.username[0].toUpperCase()}),el('span',{text:state.user.username})],()=>actions.navigate('settings'),'header-account',{'aria-label':t(state,'账户与偏好设置','Account and preferences')}));
}

export function workspaceHero(state, actions) {
  const compact=state.heroCollapsed;
  const hero=el('section',{class:`workspace-hero ${compact?'is-compact':''}`, 'aria-label':t(state,'创作灵感','Creative inspiration')});
  const picture=el('img',{class:'hero-illustration',src:workspaceIdentity.heroImage,alt:'',width:workspaceIdentity.heroWidth,height:workspaceIdentity.heroHeight,decoding:'async',onerror:()=>hero.classList.add('art-unavailable')});
  hero.append(el('div',{class:'hero-art','aria-hidden':'true'},picture),el('div',{class:'geometric-backdrop','aria-hidden':'true'},el('span',{class:'geometry-plane'}),el('span',{class:'geometry-lines'})),
    el('div',{class:'hero-copy'},el('div',{class:'hero-kicker'},el('span',{class:'edition-tag',text:t(state,'灵感起点','INSPIRATION')}),el('span',{text:'01 / CREATE'})),
      el('p',{class:'hero-project',text:workspaceIdentity.project}),el('div',{class:'hero-word','aria-hidden':'true',text:'IMAGINE.'}),
      el('div',{class:'suggestions','aria-label':t(state,'快捷提示词','Prompt suggestions')},promptSuggestions.map(([zh,en,prompt])=>button([icon('plus',14),t(state,zh,en)],()=>actions.suggestion(prompt),'suggestion')))),
    button([icon(compact?'plus':'minus',14),t(state,compact?'展开主视觉':'紧凑工作模式',compact?'Expand artwork':'Compact workspace')],actions.toggleHero,'hero-toggle',{'aria-expanded':String(!compact)}));
  return hero;
}

export function composer(state, actions) {
  const draft=state.draft, blocked=generationBlock(state);
  const input=(name,attrs={})=>el('input',{name,value:draft[name],oninput:e=>actions.setDraft(name,e.target.value),...attrs});
  const select=(name,values)=>el('select',{name,value:draft[name],onchange:e=>actions.setDraft(name,e.target.value)},values.map(v=>el('option',{value:v.value??v,text:v.label??v})));
  const form=el('form',{class:`composer ${state.advanced?'expanded':''}`,onsubmit:e=>{e.preventDefault();actions.generate();},'aria-label':t(state,'提示词工作区','Prompt workspace')});
  form.append(el('div',{class:'composer-heading'},el('div',{},el('h2',{text:t(state,'提示词工作区','Prompt workspace')}),el('span',{class:'eyebrow',text:'PROMPT WORKSPACE'})),
    button(t(state,'清空提示词','Clear prompt'),actions.newIdea,'text-button clear-prompt'),el('div',{class:'mode-switch','aria-label':t(state,'参数模式','Parameter mode')},
      button(t(state,'基础','Basic'),()=>actions.setAdvanced(false),state.advanced?'':'selected',{'aria-pressed':!state.advanced}),
      button([icon('sliders',16),t(state,'进阶','Advanced')],()=>actions.setAdvanced(true),state.advanced?'selected':'',{'aria-pressed':state.advanced}))));
  let composing=false;
  const prompt=el('textarea',{id:'workspace-prompt',name:'prompt',required:true,rows:3,maxlength:16384,value:draft.prompt,'aria-describedby':'prompt-help',
    placeholder:t(state,'描述主角、场景、动作与画面风格，例如：雨后的浮空都市，银发旅人站在天台，柔和晨光…','Describe the subject, scene, action and visual style…'),
    oninput:e=>actions.setDraft('prompt',e.target.value),oncompositionstart:()=>{composing=true;actions.setComposing(true);},oncompositionend:()=>{composing=false;actions.setComposing(false);},
    onkeydown:e=>{if(!composing&&isGenerateShortcut(e)){e.preventDefault();if(!generationBlock(state))form.requestSubmit();}}});
  form.append(field(t(state,'画面描述','Prompt'),prompt),el('div',{class:'prompt-help',id:'prompt-help'},el('span',{text:t(state,'支持中文和英文描述','Chinese and English prompts supported')}),el('kbd',{text:'Ctrl / ⌘ + Enter'})));
  const presetField=field(t(state,'参数预设','Parameter preset'),el('select',{name:'presetId',value:state.activePresetId||'',disabled:state.presetBusy,onchange:e=>actions.selectPreset(e.target.value)},el('option',{value:'',text:t(state,'默认参数','Default settings')}),state.presets.map(p=>el('option',{value:p.id,text:p.name}))));
  presetField.classList.add('composer-preset');
  form.append(el('div',{class:'composer-row'},field(t(state,'生成模型','Model'),select('modelId',state.models.length?state.models.map(m=>({value:m.id,label:m.name})):[{value:'',label:t(state,'暂无可用模型','No enabled models')}])),presetField,
    field(t(state,'每批张数','Images per batch'),select('batchSize',[1,2,4,8])),field(t(state,'生成次数','Repetitions'),input('repeat',{type:'number',min:1,max:32,step:1,required:true}))));
  if(state.advanced){
    const advanced=el('div',{class:'advanced-grid'},field(t(state,'负面提示词','Negative prompt'),el('textarea',{name:'negativePrompt',rows:2,maxlength:16384,value:draft.negativePrompt,oninput:e=>actions.setDraft('negativePrompt',e.target.value)})),
      field(t(state,'步数 · Steps','Steps'),input('steps',{type:'number',min:1,max:200,required:true})),field('CFG',input('cfg',{type:'number',min:0,max:50,step:.1,required:true})),
      field(t(state,'采样器','Sampler'),select('sampler',state.capabilities.samplers?.length?state.capabilities.samplers:['euler'])),field(t(state,'调度器','Scheduler'),select('scheduler',state.capabilities.schedulers?.length?state.capabilities.schedulers:['simple'])),
      field(t(state,'种子 · -1 为随机','Seed · -1 random'),input('seed',{type:'number',min:-1,max:Number.MAX_SAFE_INTEGER,step:1,required:true})),field(t(state,'降噪强度','Denoise'),input('denoise',{type:'number',min:0,max:1,step:.01,required:true})),
      field(t(state,'宽度','Width'),input('width',{type:'number',min:64,max:4096,step:8,required:true})),field(t(state,'高度','Height'),input('height',{type:'number',min:64,max:4096,step:8,required:true})));
    form.append(advanced,el('div',{class:'preset-toolbar'},field(t(state,'预设名称','Preset name'),el('input',{name:'presetName',maxlength:60,value:state.presetName,placeholder:t(state,'为当前参数命名','Name these settings'),oninput:e=>actions.setPresetName(e.target.value)})),button(t(state,state.presetBusy?'保存中…':'保存参数',state.presetBusy?'Saving…':'Save settings'),actions.savePreset,'button',{disabled:state.presetBusy})),
      el('p',{class:'preset-hint',text:t(state,'同名保存会更新原预设。预设随账户保存。','Saving an existing name updates that preset. Presets belong to your account.')}));
  }
  const reasons={'preset-loading':t(state,'正在更新预设，请稍候。','Updating preset, please wait.'),offline:t(state,'生成服务未连接，请联系管理员恢复连接。','Generation service is offline. Contact your administrator.'),'no-models':t(state,'暂无可用模型，请先在管理中心登记模型。','No enabled models. Register a model in Administration.'),'choose-model':t(state,'请选择可用的生成模型。','Choose an enabled model.'),submitting:t(state,'正在提交，请稍候。','Submitting, please wait.')};
  let reason=reasons[blocked]||t(state,'参数已就绪，输入描述后即可生成。','Ready. Enter a prompt to generate.');
  if(!state.models.length&&blocked==='offline')reason=t(state,'生成服务未连接，且暂无可用模型。连接恢复前可继续编辑。','Service offline and no enabled models. You can keep editing.');
  if(!state.models.length&&state.user.role!=='admin')reason=t(state,'暂无可用模型，请联系管理员。你的编辑内容会保留。','No enabled models. Contact your administrator. Your draft is retained.');
  form.append(el('div',{class:'composer-footer'},el('div',{class:'generation-availability',id:'generation-availability'},el('p',{text:reason}),
      !state.models.length&&state.user.role==='admin'&&button(t(state,'前往管理中心','Open Administration'),()=>actions.navigate('admin'),'text-button')),
    el('button',{type:'submit',class:'button primary generate-button',disabled:!!blocked,'aria-describedby':'generation-availability','aria-busy':String(state.loading)},t(state,state.loading?'提交中…':'生成图像',state.loading?'Submitting…':'Generate image'),icon('arrow',18))));
  return form;
}

export function rightRail(state, actions) {
  const groups=queueGroups(state.batches);
  const rail=el('aside',{class:'right-rail is-open',id:'task-queue','aria-label':t(state,'任务队列','Task queue')},
    el('div',{class:'rail-head'},el('h2',{text:t(state,'任务队列','Task queue')}),el('span',{class:'queue-count',text:String(groups.active.length)}),button(icon('refresh'),actions.refresh,'icon-button',{'aria-label':t(state,'刷新连接和队列','Refresh connection and queue')}),button(icon('close'),actions.toggleRail,'icon-button rail-close',{'aria-label':t(state,'关闭队列','Close queue')})),connectionStatus(state,true));
  const list=el('div',{class:'batch-list'});
  if(!groups.active.length)list.append(el('div',{class:'rail-empty'},el('span',{class:'empty-geometry','aria-hidden':'true'}),el('h3',{text:t(state,'暂无待处理任务','No pending tasks')}),el('p',{text:t(state,state.capabilities.online===true?'提交一次创作，进度会显示在这里。':'恢复连接后，即可提交新的创作。',state.capabilities.online===true?'Submit a prompt to see its progress here.':'Reconnect the service to submit a new creation.')})));
  function item(batch) {
    const active=['queued','running'].includes(batch.status);
    return el('article',{class:`queue-item status-${batch.status}`},
      el('div',{class:'queue-item-head'},el('span',{class:'task-status',text:statusLabel(state,batch.status)}),el('time',{datetime:batch.createdAt,text:dateTime(state,batch.createdAt)})),
      button([batch.images[0]?el('img',{class:'queue-thumbnail',src:batch.images[0].url,alt:'',loading:'lazy',width:48,height:48}):icon('image',22),el('span',{},el('strong',{text:batch.modelName}),el('span',{class:'queue-prompt',text:batch.prompt}))],()=>actions.selectBatch(batch.id),'queue-preview',{'aria-label':t(state,`查看任务 ${batch.id}`,`View task ${batch.id}`)}),
      batch.status==='running'&&el('div',{class:'indeterminate-progress',role:'progressbar','aria-label':t(state,'正在生成，进度由服务返回','Generating; awaiting service progress')},el('span')),
      el('div',{class:'queue-item-meta'},el('code',{text:`#${String(batch.id).slice(0,8)}`}),el('span',{text:t(state,`已保存 ${batch.images.length} / ${batch.params.batchSize} 张`,`${batch.images.length} / ${batch.params.batchSize} saved`)})),
      batch.error&&el('p',{class:'queue-error',text:batch.error}),
      el('div',{class:'queue-item-actions'},active?button(t(state,'取消待处理','Cancel pending'),()=>actions.cancelBatch(batch.id),'text-button'):batch.status==='failed'?button(t(state,'载入参数重试','Load settings to retry'),()=>actions.reuse(batch),'text-button'):batch.images.length?button(t(state,'查看结果','View results'),()=>actions.showBatch(batch),'text-button'):null));
  }
  groups.active.forEach(batch=>list.append(item(batch)));
  if(groups.recent.length)list.append(el('h3',{class:'recent-title',text:t(state,'最近结束','Recently finished')}),...groups.recent.map(item));
  rail.append(list,button([t(state,'查看影像档案','Open archive'),icon('arrow',16)],()=>actions.navigate('history'),'rail-footer'));
  return rail;
}
