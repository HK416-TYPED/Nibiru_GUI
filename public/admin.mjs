import { el, field, button, icon, t } from './ui.mjs';

const input = (attrs = {}) => el('input', attrs);
const select = (attrs = {}, ...options) => el('select', attrs, ...options);
const option = (value, label, selected = false) => el('option', { value, selected }, label);
const dateText = value => value ? new Date(value).toLocaleString() : '—';
const status = (state, zh, en) => t(state, zh, en);

function panelHeading(state, title, description) {
  return el('div', { class: 'admin-panel-heading' }, el('div', {}, el('h3', {}, title), el('p', { class: 'muted' }, description)));
}

function tabBar(state, actions) {
  const tabs = [['models', '模型', 'Models'], ['invites', '邀请码', 'Invites'], ['users', '用户与活动', 'Users & events'], ['defaults','新用户默认值','New-user defaults']];
  return el('div', { class: 'admin-tabs', role: 'tablist' }, ...tabs.map(([id, zh, en]) => button(status(state, zh, en), () => actions.setAdminTab(id), `admin-tab ${state.adminTab === id ? 'active' : ''}`, { role: 'tab', 'aria-selected': state.adminTab === id })),);
}

function modelForm(state, actions) {
  const names = [...new Set([...(state.capabilities?.unets || []), ...(state.capabilities?.checkpoints || [])])];
  const filename = input({ name:'filename', required:true, maxlength:255, list:'model-names', placeholder:'krea2_turbo_bf16.safetensors' });
  const name = input({ name:'name', required:true, maxlength:255, placeholder:status(state,'例如：Krea2 极速版','e.g. Krea2 Turbo') });
  const form = el('form', { class:'admin-form model-form' },
    field(status(state,'ComfyUI 模型名','ComfyUI model name'), filename),
    field(status(state,'用户显示名称','Display name'), name),
    el('datalist', { id:'model-names' }, ...names.map(value => option(value,value))),
    el('button', { type:'submit', class:'button primary' }, status(state,'添加模型','Add model')));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submit = form.querySelector('button');
    submit.disabled = true;
    try {
      await actions.admin('/api/admin/models', { method:'POST', body:JSON.stringify({name:name.value.trim(),filename:filename.value.trim()}) });
    } catch { submit.disabled = false; }
  });
  return form;
}

function modelRows(state, actions) {
  const models = state.adminData?.models || [];
  if (!models.length) return el('p', {class:'muted'}, status(state,'还没有模型。','No models yet.'));
  return el('div', {class:'admin-table-wrap'}, el('table', {},
    el('thead', {}, el('tr', {}, ...[['用户显示名称','Display name'],['ComfyUI 模型名','ComfyUI model name'],['状态','Status'],['操作','Actions']].map(([zh,en])=>el('th',{},status(state,zh,en))))),
    el('tbody', {}, ...models.map(model=>el('tr', {},
      el('td', {}, el('strong', {}, model.name)),
      el('td', {}, el('code', {title:model.filename}, model.filename)),
      el('td', {}, el('span', {class:`pill ${model.enabled?'ok':'off'}`},status(state,model.enabled?'已启用':'已停用',model.enabled?'Enabled':'Disabled'))),
      el('td', {}, button(status(state,model.enabled?'停用':'启用',model.enabled?'Disable':'Enable'), async()=>{
        try { await actions.admin(`/api/admin/models/${model.id}`, {method:'PATCH',body:JSON.stringify({enabled:!model.enabled})}); } catch {}
      },'button small'),button(status(state,'删除','Delete'),()=>actions.deleteModel(model),'button small danger')))))));
}

function modelsTab(state, actions) {
  return el('div', { class: 'admin-stack' }, el('section', { class: 'admin-panel' }, panelHeading(state, status(state, '添加模型', 'Add model'), status(state, '分别设置实际调用的模型名与用户看到的名称。', 'Set the model used by ComfyUI and its user-facing name.')), modelForm(state, actions)), el('section', { class: 'admin-panel' }, panelHeading(state, status(state, '已注册模型', 'Registered models'), status(state, '只有启用的模型会出现在生成器中。', 'Only enabled models appear in the generator.')), modelRows(state, actions)));
}

function inviteRows(state, actions) {
  const invites = state.adminData?.invites || [];
  if (!invites.length) return el('div', { class: 'admin-empty' }, status(state, '还没有邀请码。', 'No invites generated yet.'));
  return el('div', { class: 'admin-table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ...['邀请码', '创建时间', '有效期', '状态', '使用者'].map((x, i) => el('th', {}, status(state, ['邀请码', '创建时间', '有效期', '状态', '使用者'][i], ['Code', 'Created', 'Expires', 'Status', 'Used by'][i]))))), el('tbody', {}, ...invites.map(invite => {
    const expired = invite.expiresAt && new Date(invite.expiresAt) < new Date() && !invite.usedAt;
    const stateText = invite.usedAt ? status(state, '已使用', 'Used') : expired ? status(state, '已过期', 'Expired') : status(state, '可使用', 'Available');
    return el('tr', {}, el('td', {}, el('code', {}, invite.code), button(status(state, '复制', 'Copy'), async () => { try { await navigator.clipboard.writeText(invite.code); actions.toast(status(state, '已复制邀请码', 'Invite copied'), 'success'); } catch { actions.toast(status(state, '请选中邀请码手动复制', 'Select the invite code to copy it')); } }, 'button small copy-code')), el('td', {}, dateText(invite.createdAt)), el('td', {}, invite.expiresAt ? dateText(invite.expiresAt) : status(state, '永久', 'Never')), el('td', {}, el('span', { class: `pill ${invite.usedAt || expired ? 'off' : 'ok' }` }, stateText)), el('td', {}, invite.usedBy || '—'));
  }))));
}

function invitesTab(state, actions) {
  const count = input({ name: 'count', type: 'number', min: '1', max: '100', value: '1', required: '' });
  const days = select({name:'expiresInDays',value:'7'},...[1,2,3,5,7].map(n=>option(String(n),status(state,`${n} 天`,`${n} days`))),option('permanent',status(state,'永久有效','Never expires')));
  const form=el('form',{class:'admin-form invite-form'},field(status(state,'生成数量','Quantity'),count),field(status(state,'有效期','Valid for'),days),el('button',{class:'button primary',type:'submit'},status(state,'生成邀请码','Generate invites')));
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!form.reportValidity())return;
    const submit=form.querySelector('button');submit.disabled=true;
    try{await actions.admin('/api/admin/invites',{method:'POST',body:JSON.stringify({count:Number(count.value),expiresInDays:days.value==='permanent'?null:Number(days.value)})});}catch{submit.disabled=false;}
  });
  return el('div', { class: 'admin-stack' }, el('section', { class: 'admin-panel' }, panelHeading(state, status(state, '生成邀请码', 'Generate invites'), status(state, '每个邀请码只能注册一个账户。', 'Each invite can register one account.')), form), el('section', { class: 'admin-panel' }, panelHeading(state, status(state, '邀请码记录', 'Invite history'), status(state, '查看有效期与使用情况。', 'Review expiry and usage.')), inviteRows(state, actions)));
}

function table(state, headers, rows) {
  const head = el('thead', {}, el('tr', {}, ...headers.map(([zh, en]) => el('th', {}, status(state, zh, en)))));
  return el('div', { class: 'admin-table-wrap' }, el('table', {}, head, el('tbody', {}, ...rows)));
}

function usersTab(state, actions) {
  const users = state.adminData?.users || [];
  const events = state.adminData?.events || [];
  const userRows = users.map(user => {
    const action = user.id === state.user?.id ? el('span', { class: 'muted' }, status(state, '当前账户', 'Current')) : button(user.disabled ? status(state, '启用账户', 'Enable account') : status(state, '停用账户', 'Disable account'), async () => { await actions.admin(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', body: JSON.stringify({ disabled: !user.disabled }) }); }, 'button small');
    return el('tr', {}, el('td', {}, el('strong', {}, user.username)), el('td', {}, user.role), el('td', {}, dateText(user.lastLoginAt)), el('td', {}, String(user.generationCount || 0)), el('td', {}, el('span', { class: `pill ${user.disabled ? 'off' : 'ok'}` }, user.disabled ? status(state, '已停用', 'Disabled') : status(state, '正常', 'Active'))), el('td', {}, action));
  });
  const eventRows = events.map(event => el('tr', {}, el('td', {}, dateText(event.createdAt)), el('td', {}, event.username || '—'), el('td', {}, event.action), el('td', {}, event.detail || '—')));
  const usersTable = users.length ? table(state, [['用户','User'],['角色','Role'],['最近登录','Last login'],['生成次数','Generations'],['状态','Status'],['操作','Actions']], userRows) : el('div', { class: 'admin-empty' }, status(state, '还没有用户。', 'No users yet.'));
  const eventsTable = events.length ? table(state, [['时间','Time'],['用户','User'],['操作','Action'],['详情','Details']], eventRows) : el('div', { class: 'admin-empty' }, status(state, '暂无活动记录。', 'No activity yet.'));
  return el('div', { class: 'admin-stack' }, el('section', { class: 'admin-panel' }, panelHeading(state, status(state, '用户', 'Users'), status(state, '可停用其他账户，停用后将立即退出登录并停止后续任务。当前账户不可停用。', 'Disable other accounts to revoke sessions and stop pending work. Your own account cannot be disabled.')), usersTable), el('section', { class: 'admin-panel' }, panelHeading(state, status(state, '登录与生成活动', 'Activity'), status(state, '最近的工作区事件。', 'Recent workspace events.')), eventsTable));
}

function defaultsTab(state,actions){
  const saved=state.adminDefaults||{},available=(state.adminData?.models||state.models).filter(m=>m.enabled);
  const model=el('select',{name:'modelId',value:saved.modelId??''},option('',status(state,'自动选择可用模型','Choose an available model automatically')),...available.map(m=>option(m.id,m.name)));
  const presets=state.presets||[];
  const snapshotOnly=!!saved.preset&&!presets.some(p=>p.id===saved.sourcePresetId);
  const preset=el('select',{name:'presetId',value:snapshotOnly?'__saved__':presets.some(p=>p.id===saved.sourcePresetId)?saved.sourcePresetId:''},snapshotOnly&&option('__saved__',status(state,`保留已保存快照：${saved.preset.name}`,`Keep saved snapshot: ${saved.preset.name}`)),option('',status(state,'系统默认参数','System defaults')),...presets.map(p=>option(p.id,p.name)));
  const form=el('form',{class:'admin-form',onsubmit:event=>{event.preventDefault();actions.saveWorkspaceDefaults(form);}},field(status(state,'初始默认模型','Initial default model'),model),field(status(state,'初始参数预设','Initial parameter preset'),preset),el('button',{type:'submit',class:'button primary'},status(state,'保存初始默认值','Save initial defaults')));
  return el('section',{class:'admin-panel'},panelHeading(state,status(state,'新用户初始默认值','New-user defaults'),status(state,'只在新用户第一次进入工作区时应用。之后由用户自由选择，不会覆盖个人设置。','Applied only on first entry. Users remain free to choose their own settings afterward.')),form,
    el('p',{class:'muted',text:status(state,'预设会复制成用户自己的副本；这里指定的模型优先于预设中的模型。可先在生成页保存预设，再来选择。','The preset is copied into the user account. The model selected here overrides the preset model. Save a preset in Generate first to make it available here.')}),
    saved.preset&&el('p',{class:'muted',text:status(state,`已保存的参数快照：${saved.preset.name} · ${saved.preset.params.steps} steps · CFG ${saved.preset.params.cfg}`,`Saved settings snapshot: ${saved.preset.name} · ${saved.preset.params.steps} steps · CFG ${saved.preset.params.cfg}`)}));
}

export function renderAdmin(state, actions) {
  const tab = state.adminTab || 'models';
  return el('div', { class: 'admin-page-content' }, el('div', { class:'page-heading' }, el('h1', { text:status(state,'超级管理员设置','Administration') }), el('p', { class:'muted',text:status(state,'管理模型、邀请成员，了解工作区动态。','Manage models, invitations and workspace activity.') })), tabBar(state, actions), tab === 'models' ? modelsTab(state, actions) : tab === 'invites' ? invitesTab(state, actions) : tab==='defaults'?defaultsTab(state,actions):usersTab(state, actions));
}
