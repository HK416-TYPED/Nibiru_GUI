import { el, field, button, icon, brand, t, localDate, dateTime } from './ui.mjs';
import { renderAdmin } from './admin.mjs';
import {renderPresetManager} from './parameter-editor.mjs';
import { renderTasks } from './tasks.mjs';
import { singleImageViewer } from './single-view.mjs';

export function renderAuth(state, actions) {
  const setup=state.setupRequired, register=state.authMode==='register';
  const form=el('form',{class:'auth-form',onsubmit:e=>{e.preventDefault();actions.auth(form);}});
  form.append(field(t(state,'用户名','Username'),el('input',{name:'username',required:true,minlength:2,maxlength:32,pattern:'[A-Za-z0-9_-]{2,32}',autocomplete:'username',placeholder:t(state,'2–32 位字母、数字或下划线','2–32 letters, numbers or underscores')})),
    field(t(state,'密码','Password'),el('input',{name:'password',type:'password',required:true,minlength:8,maxlength:128,autocomplete:setup||register?'new-password':'current-password',placeholder:t(state,'至少 8 位字符','At least 8 characters')})));
  if(setup)form.append(field(t(state,'初始化密钥','Setup key'),el('input',{name:'setupToken',type:'password',required:true,autocomplete:'off',placeholder:t(state,'见服务端私有数据目录中的 .setup-token','See .setup-token in the server private data directory')})));
  if(setup||register)form.append(field(t(state,'确认密码','Confirm password'),el('input',{name:'confirmPassword',type:'password',required:true,minlength:8,maxlength:128,autocomplete:'new-password',placeholder:t(state,'再次输入密码','Enter password again')})));
  if(register&&!setup)form.append(field(t(state,'邀请码','Invitation code'),el('input',{name:'inviteCode',required:true,autocomplete:'off',placeholder:t(state,'输入你的专属邀请码','Your single-use invitation code')})));
  form.append(el('button',{class:'button primary wide',type:'submit',disabled:state.authBusy},t(state,setup?'创建并进入工作区':register?'创建账户':'进入工作区',setup?'Create workspace':register?'Create account':'Enter workspace'),icon('arrow')));
  const title=setup?t(state,'创建你的工作区','Create your workspace'):register?t(state,'从一个想法开始。','Begin with an idea.'):t(state,'欢迎回来。','Welcome back.');
  return el('main',{class:'auth-shell'},
    el('section',{class:'auth-art'},brand(),el('div',{class:'art-caption'},el('h2',{text:t(state,'让想象，有迹可循。','Give imagination a place.')}),el('p',{text:t(state,'每一次探索，都值得被留下。','Every exploration is worth keeping.')}))),
    el('section',{class:'auth-panel'},el('div',{class:'auth-form-wrap'},el('div',{class:'mobile-brand'},brand()),el('div',{class:'beta-tag'},el('i',{class:'status-dot'}),'PRIVATE BETA'),
      el('h1',{text:title}),el('p',{class:'auth-description',text:t(state,setup?'首次使用：创建本机超级管理员，之后可邀请成员加入。':register?'仅限邀请。你的作品和探索，都会妥善保存。':'登录 Nibiru，继续你的下一次探索。',setup?'First run: create the administrator, then invite your team.':register?'Invitation only. A private home for your creations.':'Sign in to continue your next exploration.')}),form,
      !setup&&button(t(state,register?'已有账户？返回登录':'还没有账户？使用邀请码注册',register?'Already a member? Sign in':'Have an invitation? Create an account'),()=>actions.setAuthMode(register?'login':'register'),'text-button'),
      el('div',{class:'auth-footnote',text:t(state,'私有创作空间 · 仅对受邀成员开放','A private studio · By invitation only')}))));
}
function navigation(state,actions){
  const entries=[['generate',t(state,'生成','Generate'),'plus'],['tasks',t(state,'任务','Tasks'),'tasks'],['history',t(state,'历史','History'),'image'],['settings',t(state,'设置','Settings'),'settings']];
  if(state.user.role==='admin')entries.push(['admin',t(state,'超级管理员设置','Administration'),'shield']);
  return el('aside',{class:'side-nav'},brand(),
    el('nav',{'aria-label':t(state,'主导航','Main navigation')},entries.map(([id,label,glyph])=>button([icon(glyph),el('span',{text:label}),state.activeView===id&&el('i',{class:'nav-dot'})],()=>actions.navigate(id),`nav-item ${state.activeView===id?'active':''}`,{'aria-current':state.activeView===id?'page':undefined,title:label}))),
    el('div',{class:'nav-spacer'}),el('div',{class:'sidebar-note'},el('span',{text:'LESS FRICTION.'}),el('span',{text:'MORE IMAGINATION.'})),
    el('div',{class:'profile'},el('div',{class:'avatar',text:state.user.username[0].toUpperCase()}),el('div',{class:'profile-copy'},el('strong',{text:state.user.username}),el('small',{text:t(state,state.user.role==='admin'?'管理员':'内测成员',state.user.role==='admin'?'Administrator':'Beta member')})),button(icon('arrow'),actions.logout,'logout',{'aria-label':t(state,'退出登录','Sign out')})));
}
function topbar(state,actions){
  const working=state.batches.some(b=>['running','queued'].includes(b.status));
  const offline=state.capabilities.online===false;
  const failed=!working&&state.batches[0]?.status==='failed';
  const color=offline||failed?'error':working?'busy':'';
  const message=offline?t(state,'服务未连接','Service offline'):working?t(state,'正在处理…','Processing…'):failed?t(state,'生成失败','Generation failed'):t(state,'准备就绪','Ready');
  return el('header',{class:'topbar'},
    button(icon('menu'),()=>document.body.classList.toggle('nav-open'),'mobile-menu',{'aria-label':t(state,'打开导航','Open navigation')}),
    el('div',{class:'queue-status',role:'status'},el('i',{class:`status-dot ${color}`}),el('span',{text:message})),
    state.activeView==='generate'&&button([icon('image'),el('span',{text:t(state,state.railOpen?'隐藏队列':'显示队列',state.railOpen?'Hide queue':'Show queue')})],actions.toggleRail,'rail-toggle',{'aria-label':t(state,state.railOpen?'隐藏任务队列':'显示任务队列',state.railOpen?'Hide task queue':'Show task queue'),'aria-expanded':String(state.railOpen)}));
}

function emptyCanvas(state,actions){
  return el('div',{class:'empty-canvas'},el('div',{class:'empty-orbit','aria-hidden':'true'},el('span',{class:'empty-ring'}),el('span',{class:'empty-ring ring-small'}),el('span',{class:'empty-star'}),el('span',{class:'orbit-satellite'})),
    el('h2',{text:t(state,'把想象，变成画面。','An idea. A new possibility.')}),el('p',{text:t(state,'写下你脑海中的场景，其他的交给 Nibiru。','Describe the scene in your mind. Let Nibiru take it from there.')}),
    el('div',{class:'suggestions'},...[
      [t(state,'云端建筑','Cloud architecture'),'A glass greenhouse floating above a sea of clouds, soft morning light, surreal architectural photography'],
      [t(state,'静物光影','Still life studies'),'An olive green ceramic vase and a pear on cream linen, soft window light, editorial still life photography'],
      [t(state,'电影场景','Cinematic scenes'),'A quiet old bookstore glowing in a rainy neon street at night, cinematic composition, analog film'],
    ].map(([label,prompt])=>button([icon('plus',13),label],()=>actions.suggestion(prompt),'suggestion'))));
}
function statusLabel(state,status){return t(state,{queued:'排队中',running:'生成中',completed:'已完成',failed:'生成失败',cancelled:'已取消'}[status],{queued:'Queued',running:'Generating',completed:'Complete',failed:'Failed',cancelled:'Cancelled'}[status]);}
function canvas(state,actions){
  const batch=state.batches.find(b=>b.id===state.activeBatchId);
  if(!batch)return emptyCanvas(state,actions);
  if(!batch.images.length)return el('div',{class:'generation-state'},el('div',{class:['failed','cancelled'].includes(batch.status)?'failed-symbol':'generation-spinner',text:batch.status==='failed'?'!':batch.status==='cancelled'?'−':''}),
    el('p',{class:'eyebrow',text:batch.modelName}),el('h2',{text:statusLabel(state,batch.status)}),el('p',{class:'muted',text:batch.status==='cancelled'?t(state,'待处理图片已取消。','Pending images were cancelled.'):batch.status==='failed'?batch.error:t(state,'画面正在酝酿。你可以继续构思下一个想法。','Your image is taking shape. Keep exploring your next idea.')}),
    el('p',{class:'pending-prompt',text:batch.prompt}),batch.status==='failed'&&button(t(state,'载入参数，重新尝试','Load settings to try again'),()=>actions.reuse(batch)));
  return el('div',{class:'canvas-result'},el('div',{class:'canvas-result-head'},el('span',{text:batch.modelName}),el('span',{class:'muted',text:`${batch.params.width} × ${batch.params.height} · ${batch.images.length} ${t(state,'张','images')}`})),
    state.imageView==='single'?singleImageViewer(state,actions,batch):el('div',{class:`result-grid count-${batch.images.length}`,'data-image-aspect':Number(batch.params.width)/Number(batch.params.height)},batch.images.map((img,i)=>button(el('img',{src:img.url,alt:batch.prompt}),()=>actions.showImage(img,batch),'result-tile',{'aria-label':t(state,`放大图片 ${i+1}`,`View image ${i+1}`)}))),
    el('div',{class:'canvas-result-foot'},el('span',{class:'muted',text:dateTime(state,batch.createdAt)}),button(t(state,'复用参数','Reuse settings'),()=>actions.reuse(batch),'text-button')));
}
function composer(state,actions){
  const draft=state.draft;
  const input=(name,attrs={})=>el('input',{name,value:draft[name],oninput:e=>actions.setDraft(name,e.target.value),...attrs});
  const select=(name,values)=>el('select',{name,value:draft[name],onchange:e=>actions.setDraft(name,e.target.value)},values.map(v=>el('option',{value:v.value??v,text:v.label??v})));
  const form=el('form',{class:`composer ${state.advanced?'expanded':''}`,onsubmit:e=>{e.preventDefault();actions.generate();}});
  form.append(el('div',{class:'composer-heading'},button([icon('plus',16),t(state,'新的想法','A new idea')],actions.newIdea,'composer-title',{'aria-label':t(state,'新的想法','A new idea'),title:t(state,'清空 Prompt 并开始新的想法','Clear the prompt and start a new idea')}),el('div',{class:'mode-switch'},
    button(t(state,'基础','Basic'),()=>actions.setAdvanced(false),state.advanced?'':'selected',{'aria-pressed':!state.advanced}),
    button([icon('sliders',13),t(state,'进阶','Advanced')],()=>actions.setAdvanced(true),state.advanced?'selected':'',{'aria-pressed':state.advanced}))));
  const presetField=field(t(state,'参数预设','Parameter preset'),el('select',{name:'presetId',value:state.activePresetId||'',disabled:state.presetBusy,onchange:e=>actions.selectPreset(e.target.value)},
        el('option',{value:'',text:t(state,'默认参数','Default settings')}),state.presets.map(p=>el('option',{value:p.id,text:p.name}))));
  presetField.classList.add('composer-preset');
  if(state.advanced){
    form.append(el('div',{class:'preset-toolbar'},
      field(t(state,'预设名称','Preset name'),el('input',{name:'presetName',maxlength:60,value:state.presetName,placeholder:t(state,'例如：快速测试','e.g. Quick test'),oninput:e=>actions.setPresetName(e.target.value)})),
      button(t(state,state.presetBusy?'保存中…':'保存参数',state.presetBusy?'Saving…':'Save settings'),actions.savePreset,'button',{disabled:state.presetBusy})),
      el('p',{class:'preset-hint',text:t(state,'选中的预设随账户保存，下次打开自动恢复。同名保存会更新原预设。','The selected preset is restored next time. Saving with the same name updates it.')}));
    const advanced=el('div',{class:'advanced-grid'},field(t(state,'负面提示词','Negative prompt'),el('textarea',{name:'negativePrompt',rows:2,maxlength:16384,value:draft.negativePrompt,placeholder:t(state,'不希望出现在画面中的内容','What to leave out'),oninput:e=>actions.setDraft('negativePrompt',e.target.value)})),
      field(t(state,'步数 · Steps','Steps'),input('steps',{type:'number',min:1,max:200,required:true})),field('CFG',input('cfg',{type:'number',min:0,max:50,step:.1,required:true})),
      field(t(state,'采样器','Sampler'),select('sampler',state.capabilities.samplers?.length?state.capabilities.samplers:['euler'])),field(t(state,'调度器','Scheduler'),select('scheduler',state.capabilities.schedulers?.length?state.capabilities.schedulers:['simple'])),
      field(t(state,'种子 · -1 为随机','Seed · -1 for random'),input('seed',{type:'number',min:-1,max:Number.MAX_SAFE_INTEGER,step:1,required:true})),field(t(state,'降噪强度','Denoise'),input('denoise',{type:'number',min:0,max:1,step:.01,required:true})),
      field(t(state,'宽度','Width'),input('width',{type:'number',min:64,max:4096,step:8,required:true})),field(t(state,'高度','Height'),input('height',{type:'number',min:64,max:4096,step:8,required:true})));
    form.append(advanced);
  }
  const prompt=el('textarea',{name:'prompt',required:true,rows:2,maxlength:16384,value:draft.prompt,'aria-label':t(state,'正面提示词','Prompt'),placeholder:t(state,'描述画面中的主角、场景、光线和风格…','Describe your subject, scene, light and style…'),oninput:e=>actions.setDraft('prompt',e.target.value),onkeydown:e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();form.requestSubmit();}}});
  form.append(prompt,el('div',{class:'composer-row'},field(t(state,'模型','MODEL'),select('modelId',state.models.length?state.models.map(m=>({value:m.id,label:m.name})):[{value:'',label:t(state,'暂无可用模型','No enabled models')}])),
    presetField,field(t(state,'每批张数','BATCH SIZE'),select('batchSize',[1,2,4,8])),field(t(state,'生成次数','REPEAT'),input('repeat',{type:'number',min:1,max:32,step:1,required:true})),
    el('div',{class:'composer-submit'},el('span',{class:'keyboard-hint',text:'⌘ / Ctrl + Enter'}),el('button',{type:'submit',class:'button primary generate-button',disabled:state.loading||!state.models.length},t(state,state.loading?'提交中…':'生成图像',state.loading?'Submitting…':'Generate'),icon('arrow',16)))));
  return form;
}
function rightRail(state,actions){
  const rail=el('aside',{class:`right-rail ${state.railOpen?'is-open':''}`,'aria-label':t(state,'任务队列','Task queue')},el('div',{class:'rail-head'},el('div',{},el('h3',{text:t(state,'任务队列','Task queue')})),
    button(icon('refresh',16),actions.refresh,'icon-button',{'aria-label':t(state,'刷新队列','Refresh queue')}),button(icon('close'),actions.toggleRail,'rail-close',{'aria-label':t(state,'关闭队列','Close queue')})));
  const list=el('div',{class:'batch-list'});
  const pending=state.batches.filter(b=>['queued','running'].includes(b.status));
  if(!pending.length)list.append(el('div',{class:'rail-empty'},icon('image',28),el('p',{text:t(state,'暂无待处理任务','No pending tasks')}),el('small',{text:t(state,'已完成的图片可在历史中查看','Completed images are available in History')})));
  for(const batch of pending){
    list.append(el('div',{class:'queue-item'},button([
      el('div',{class:'batch-thumbnails'},batch.images.length?batch.images.slice(0,4).map(img=>el('img',{src:img.url,loading:'lazy',alt:batch.prompt})):el('div',{class:`thumb-placeholder ${batch.status}`,text:statusLabel(state,batch.status)})),
      el('div',{class:'batch-meta'},el('strong',{text:batch.modelName}),el('span',{text:dateTime(state,batch.createdAt)})),
      el('div',{class:'batch-caption'},el('span',{text:batch.prompt}),el('small',{text:batch.images.length?`${batch.images.length} ${t(state,'张','images')}`:statusLabel(state,batch.status)})),
    ],()=>actions.selectBatch(batch.id),`batch-card ${batch.id===state.activeBatchId?'selected':''}`),
      el('div',{class:'queue-item-actions'},el('small',{class:'muted',text:`${statusLabel(state,batch.status)} · ${batch.images.length}/${batch.params.batchSize}`}),button(t(state,'删除待处理','Cancel pending'),()=>actions.cancelBatch(batch.id),'text-button danger'))));
  }
  rail.append(list,button([t(state,'查看全部历史','View all history'),icon('chevron',14)],()=>actions.navigate('history'),'rail-footer'));
  return rail;
}
function heading(state,zh,en){return el('div',{class:'page-heading'},el('h1',{text:t(state,zh,en)}));}
function history(state,actions){
  const content=el('div',{class:'history-page'},heading(state,'历史','History'));
  const filters=state.historyFilters;
  content.append(el('div',{class:'history-tools'},icon('search'),el('input',{type:'search',name:'historySearch',value:filters.q,placeholder:t(state,'搜索提示词或描述…','Search prompts…'),'aria-label':t(state,'搜索历史','Search history'),oninput:e=>actions.filterHistory({q:e.target.value},true)}),
    el('input',{type:'date',name:'historyDate',value:filters.date,'aria-label':t(state,'跳转日期','Jump to date'),onchange:e=>actions.filterHistory({date:e.target.value})}),
    el('select',{name:'historySort',value:filters.sort,'aria-label':t(state,'排序','Sort'),onchange:e=>actions.filterHistory({sort:e.target.value})},el('option',{value:'desc',text:t(state,'最新优先','Newest first')}),el('option',{value:'asc',text:t(state,'最早优先','Oldest first')})),
    (filters.q||filters.date)&&button(t(state,'清除','Clear'),()=>actions.filterHistory({q:'',date:''}),'text-button')));
  content.append(el('div',{class:'history-selection-bar'},button(t(state,'全选当前结果','Select current results'),actions.selectHistoryPage,'text-button'),button(t(state,'取消选择','Clear selection'),actions.clearHistorySelection,'text-button'),el('span',{class:'muted',text:t(state,`已选 ${state.historySelection.length} 个批次`,`${state.historySelection.length} batches selected`)}),button(t(state,'删除选中','Delete selected'),()=>actions.deleteHistoryItems({batchIds:state.historySelection}),'button danger',{disabled:!state.historySelection.length})));
  const days=[...new Set(state.batches.map(b=>localDate(b.createdAt)))].sort().reverse();
  const timeline=el('aside',{class:'timeline'},el('p',{class:'eyebrow',text:t(state,'时间轴','TIMELINE')}),button(t(state,'全部日期','All dates'),()=>actions.filterHistory({date:''}),!filters.date?'selected':''),days.map(day=>button(day,()=>actions.filterHistory({date:day}),filters.date===day?'selected':'')));
  const gallery=el('div',{class:'history-sections'}),groups=new Map();
  for(const batch of state.historyBatches){const day=localDate(batch.createdAt);if(!groups.has(day))groups.set(day,[]);groups.get(day).push(batch);}
  for(const [day,batches] of groups){
    const grid=el('div',{class:'history-grid'});
    for(const batch of batches){
      const first=batch.images[0],active=['queued','running'].includes(batch.status),selected=state.historySelection.includes(batch.id);
      const card=el('article',{class:`gallery-card ${selected?'selected':''}`},
        first?button(el('img',{src:first.url,alt:batch.prompt,loading:'lazy'}),()=>actions.showBatch(batch),'gallery-image',{'aria-label':t(state,`查看批次，${batch.images.length} 张图片`,`Open batch, ${batch.images.length} images`)}):el('div',{class:'gallery-pending',text:statusLabel(state,batch.status)}),
        el('label',{class:'gallery-select'},el('input',{type:'checkbox',checked:selected,disabled:active,'aria-label':t(state,`选择批次 ${batch.id}`,`Select batch ${batch.id}`),onchange:e=>actions.toggleHistoryBatch(batch.id,e.target.checked)})),
        el('span',{class:'gallery-count',text:t(state,`${batch.images.length} 张`,`${batch.images.length} images`)}),
        el('div',{class:'gallery-details'},el('p',{text:batch.prompt,title:batch.prompt}),el('div',{class:'gallery-info'},el('span',{text:`${batch.params.width} × ${batch.params.height}`}),el('span',{text:batch.modelName})),
          el('div',{class:'gallery-actions'},button(t(state,'复用参数','Reuse'),()=>actions.reuse(batch),'text-button'),button(t(state,'删除批次','Delete batch'),()=>actions.deleteHistoryItems({batchIds:[batch.id]}),'text-button danger',{disabled:active}))));
      grid.append(el('div',{class:`history-batch ${batch.images.length>1?'stacked':''}`},batch.images.length>1&&el('span',{class:'stack-layer back','aria-hidden':'true'}),batch.images.length>2&&el('span',{class:'stack-layer middle','aria-hidden':'true'}),card));
    }
    gallery.append(el('section',{class:'history-day'},el('h3',{text:day}),grid));
  }
  if(!groups.size)gallery.append(el('div',{class:'empty-page'},icon('image',32),el('h3',{text:t(state,'这里还没有作品','No images here yet')}),el('p',{text:t(state,filters.q||filters.date?'换个关键词或日期试试看。':'开始创作，你的图片会自动保存在这里。',filters.q||filters.date?'Try another keyword or date.':'Start creating. Your images will be saved here.')})));
  content.append(el('div',{class:'history-layout'},timeline,gallery));return content;
}
function passwordSettings(state,actions){
  const form=el('form',{class:'password-change-form',onsubmit:e=>{e.preventDefault();actions.changePassword(form);}},
    field(t(state,'当前密码','Current password'),el('input',{name:'currentPassword',type:'password',autocomplete:'current-password',required:true,maxlength:128})),
    field(t(state,'新密码','New password'),el('input',{name:'newPassword',type:'password',autocomplete:'new-password',required:true,minlength:12,maxlength:128,placeholder:t(state,'至少 12 位，建议使用随机密码','At least 12 characters; a random password is recommended')})),
    field(t(state,'确认新密码','Confirm new password'),el('input',{name:'confirmPassword',type:'password',autocomplete:'new-password',required:true,minlength:12,maxlength:128})),
    el('button',{type:'submit',class:'button'},t(state,'修改密码','Change password')));
  return el('section',{class:'setting-section password-section'},el('h3',{text:t(state,'账户安全','Account security')}),el('p',{class:'muted',text:t(state,'修改密码后，其他已登录设备会退出。','Changing your password signs out other sessions.')}),form);
}
function settings(state,actions){
  return el('div',{},heading(state,'设置','Settings'),
    el('div',{class:'settings-card'},el('div',{class:'settings-profile'},el('div',{class:'avatar',text:state.user.username[0].toUpperCase()}),el('div',{},el('h3',{text:state.user.username}),el('p',{class:'muted',text:t(state,state.user.role==='admin'?'超级管理员':'内测成员',state.user.role==='admin'?'Administrator':'Beta member')}))),
      el('div',{class:'setting-section'},el('h3',{text:t(state,'外观','Appearance')}),el('p',{class:'muted',text:t(state,'选择适合你的光线。偏好会随账户保存。','Choose your light. Preferences are saved to your account.')}),
        el('div',{class:'theme-options'},...['light','dark','system'].map(theme=>button([el('span',{class:`theme-preview ${theme}`},el('i'),el('i'),el('i')),el('strong',{text:t(state,{light:'浅色',dark:'深色',system:'跟随系统'}[theme],{light:'Light',dark:'Dark',system:'System'}[theme])}),state.theme===theme&&icon('check',15)],()=>actions.savePreferences(theme,state.language),`theme-choice ${state.theme===theme?'selected':''}`,{'aria-pressed':state.theme===theme})))),
      el('div',{class:'setting-row'},el('div',{},el('strong',{text:t(state,'界面语言','Language')}),el('p',{class:'muted',text:t(state,'在中文与英文之间切换','Switch between Chinese and English')})),el('select',{name:'language',value:state.language,'aria-label':t(state,'界面语言','Language'),onchange:e=>actions.savePreferences(state.theme,e.target.value)},el('option',{value:'zh',text:'简体中文'}),el('option',{value:'en',text:'English'}))),
      el('div',{class:'setting-row'},el('div',{},el('strong',{text:t(state,'单图浏览','Single-image browsing')}),el('p',{class:'muted',text:t(state,'开启后上下滚动切换图片，左侧圆点显示当前位置。','Scroll vertically through images, with position dots on the left.')})),
        el('input',{type:'checkbox',role:'switch',class:'setting-switch','aria-label':t(state,'单图浏览','Single-image browsing'),checked:state.imageView==='single',onchange:e=>actions.savePreferences(state.theme,state.language,e.target.checked?'single':'grid')})),
      el('div',{class:'setting-row'},el('div',{},el('strong',{text:t(state,'个人图库','Your archive')}),el('p',{class:'muted',text:t(state,'图片与参数自动保存，仅当前账户可见。','Images and settings are saved automatically, privately.')})),button(t(state,'清除历史记录','Clear history'),actions.clearHistory,'button danger')),
      passwordSettings(state,actions),
      renderPresetManager(state,actions),
      el('div',{class:'setting-row'},el('div',{},el('strong',{text:'Nibiru Image Lab'}),el('p',{class:'muted',text:'PRIVATE BETA · 0.1.0'})),button(t(state,'退出登录','Sign out'),actions.logout))));
}
export function renderWorkspace(state,actions){
  const shell=el('div',{class:`workspace-shell view-${state.activeView} ${state.railOpen?'':'rail-hidden'}`},navigation(state,actions));
  shell.append(button('',()=>document.body.classList.remove('nav-open'),'nav-scrim',{'aria-label':t(state,'关闭导航','Close navigation')}));
  if(state.activeView==='generate'){shell.append(el('main',{class:'center-stage'},topbar(state,actions),el('div',{class:'canvas-wrap'},canvas(state,actions)),composer(state,actions)));if(state.railOpen)shell.append(rightRail(state,actions));}
  else {
    const page=el('main',{class:'page-view'},topbar(state,actions));
    if(state.activeView==='history')page.append(history(state,actions));
    else if(state.activeView==='settings')page.append(settings(state,actions));
    else if(state.activeView==='admin')page.append(renderAdmin(state,actions));
    else if(state.activeView==='tasks')page.append(renderTasks(state,actions));
    shell.append(page);
  }
  return shell;
}
