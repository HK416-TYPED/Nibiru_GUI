import { el, field, button, icon, brand, t, localDate, dateTime } from './ui.mjs';
import { renderAdmin } from './admin.mjs';
import {renderPresetManager} from './parameter-editor.mjs';
import { renderTasks } from './tasks.mjs';
import { singleImageViewer } from './single-view.mjs';
import {navigation, topbar, workspaceHero, composer, rightRail, statusLabel} from './workspace-ui.mjs';
import {workspaceIdentity} from './workspace-config.mjs';

export function renderAuth(state, actions) {
  const setup=state.setupRequired, register=state.authMode==='register';
  const form=el('form',{class:'auth-form',onsubmit:e=>{e.preventDefault();actions.auth(form);}});
  form.append(field(t(state,'用户名','Username'),el('input',{name:'username',required:true,minlength:2,maxlength:32,pattern:'[A-Za-z0-9_-]{2,32}',autocomplete:'username',placeholder:t(state,'2–32 位字母、数字或下划线','2–32 letters, numbers or underscores')})),
    field(t(state,'密码','Password'),el('input',{name:'password',type:'password',required:true,minlength:8,maxlength:128,autocomplete:setup||register?'new-password':'current-password',placeholder:t(state,'至少 8 位字符','At least 8 characters')})));
  if(setup)form.append(field(t(state,'初始化密钥','Setup key'),el('input',{name:'setupToken',type:'password',required:true,autocomplete:'off',placeholder:t(state,'见服务端私有数据目录中的 .setup-token','See .setup-token in the server private data directory')})));
  if(setup||register)form.append(field(t(state,'确认密码','Confirm password'),el('input',{name:'confirmPassword',type:'password',required:true,minlength:8,maxlength:128,autocomplete:'new-password',placeholder:t(state,'再次输入密码','Enter password again')})));
  if(register&&!setup)form.append(field(t(state,'邀请码','Invitation code'),el('input',{name:'inviteCode',required:true,autocomplete:'off',placeholder:t(state,'输入你的专属邀请码','Your single-use invitation code')})));
  form.append(el('button',{class:'button primary wide',type:'submit',disabled:state.authBusy},t(state,setup?'创建并进入工作区':register?'创建账户':'进入工作区',setup?'Create workspace':register?'Create account':'Enter workspace'),icon('arrow')));
  const title=setup?t(state,'初始化工作区','Set up workspace'):register?t(state,'使用邀请码注册','Create an account'):t(state,'登录工作区','Sign in');
  return el('main',{class:'auth-shell'},
    el('section',{class:'auth-art','aria-label':t(state,'项目主视觉','Project artwork')},el('img',{class:'auth-illustration',src:workspaceIdentity.heroImage,alt:'',width:workspaceIdentity.heroWidth,height:workspaceIdentity.heroHeight}),brand(),el('div',{class:'art-caption'},el('p',{class:'eyebrow',text:workspaceIdentity.project}),el('div',{class:'art-wordmark',text:'IMAGINE.', 'aria-hidden':'true'})),el('div',{class:'art-bottom'},el('span',{text:workspaceIdentity.team}),el('span',{text:'NOOB & CHEESE'}))),
    el('section',{class:'auth-panel'},el('div',{class:'auth-form-wrap'},el('div',{class:'mobile-brand'},brand()),el('div',{class:'beta-tag'},el('i',{class:'status-dot'}),'PRIVATE BETA'),
      el('h1',{text:title}),el('p',{class:'auth-description',text:t(state,setup?'创建管理员账户后，即可邀请成员加入。':register?'填写账户信息和有效邀请码。':'使用你的账户访问生成任务、图库和参数预设。',setup?'Create an administrator account to invite members.':register?'Enter your account details and a valid invitation code.':'Access your generations, image archive and saved settings.')}),form,
      !setup&&button(t(state,register?'已有账户？返回登录':'还没有账户？使用邀请码注册',register?'Already a member? Sign in':'Have an invitation? Create an account'),()=>actions.setAuthMode(register?'login':'register'),'text-button'),
      el('div',{class:'auth-footnote',text:t(state,'私有创作空间 · 仅对受邀成员开放','A private studio · By invitation only')}))));
}
function canvas(state,actions){
  const batch=state.batches.find(b=>b.id===state.activeBatchId);
  if(!batch)return workspaceHero(state,actions);
  if(!batch.images.length)return el('div',{class:'generation-state'},el('div',{class:['failed','cancelled'].includes(batch.status)?'failed-symbol':'generation-spinner',text:batch.status==='failed'?'!':batch.status==='cancelled'?'−':''}),
    el('p',{class:'eyebrow',text:batch.modelName}),el('h2',{text:statusLabel(state,batch.status)}),el('p',{class:'muted',text:batch.status==='cancelled'?t(state,'待处理图片已取消。','Pending images were cancelled.'):batch.status==='failed'?batch.error:t(state,'画面正在酝酿。你可以继续构思下一个想法。','Your image is taking shape. Keep exploring your next idea.')}),
    el('p',{class:'pending-prompt',text:batch.prompt}),batch.status==='failed'&&button(t(state,'载入参数，重新尝试','Load settings to try again'),()=>actions.reuse(batch)));
  return el('div',{class:'canvas-result'},el('div',{class:'canvas-result-head'},el('span',{text:batch.modelName}),el('span',{class:'muted',text:`${batch.params.width} × ${batch.params.height} · ${batch.images.length} ${t(state,'张','images')}`})),
    state.imageView==='single'?singleImageViewer(state,actions,batch):el('div',{class:`result-grid count-${batch.images.length}`,'data-image-aspect':Number(batch.params.width)/Number(batch.params.height)},batch.images.map((img,i)=>button(el('img',{src:img.url,alt:batch.prompt}),()=>actions.showImage(img,batch),'result-tile',{'aria-label':t(state,`放大图片 ${i+1}`,`View image ${i+1}`)}))),
    el('div',{class:'canvas-result-foot'},el('span',{class:'muted',text:dateTime(state,batch.createdAt)}),button(t(state,'复用参数','Reuse settings'),()=>actions.reuse(batch),'text-button')));
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
      el('div',{class:'setting-row'},el('div',{},el('strong',{text:'NIBBLES · NOOB & CHEESE'}),el('p',{class:'muted',text:'PRIVATE BETA · 0.1.0'})),button(t(state,'退出登录','Sign out'),actions.logout))));
}
export function renderWorkspace(state,actions){
  const shell=el('div',{class:`workspace-shell view-${state.activeView} ${state.railOpen?'':'rail-hidden'} ${state.navCollapsed?'nav-collapsed':''} ${state.navOpen?'nav-visible':''}`},topbar(state,actions),navigation(state,actions));
  if(state.navOpen)shell.append(button('',actions.toggleNav,'nav-scrim',{'aria-label':t(state,'关闭导航遮罩','Close navigation overlay'),tabindex:-1}));
  if(state.activeView==='generate'){
    const hasBatch=state.batches.some(batch=>batch.id===state.activeBatchId);
    shell.append(el('main',{class:'center-stage',id:'main-workspace'},el('div',{class:`canvas-wrap ${hasBatch?'has-result':''}`},canvas(state,actions)),composer(state,actions)));
    if(state.railOpen)shell.append(button('',actions.toggleRail,'queue-scrim',{'aria-label':t(state,'关闭队列遮罩','Close queue overlay'),tabindex:-1}),rightRail(state,actions));
  }
  else {
    const page=el('main',{class:'page-view'});
    if(state.activeView==='history')page.append(history(state,actions));
    else if(state.activeView==='settings')page.append(settings(state,actions));
    else if(state.activeView==='admin')page.append(renderAdmin(state,actions));
    else if(state.activeView==='tasks')page.append(renderTasks(state,actions));
    shell.append(page);
  }
  return shell;
}
