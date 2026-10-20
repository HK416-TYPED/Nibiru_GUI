import { el, field, button, t } from './ui.mjs';

const tr = (state, zh, en) => t(state, zh, en);
const inp = (name, value, attrs = {}) => el('input', { id: `taskParam-${name}`, name: `taskParam-${name}`, value: value ?? '', ...attrs });
const select = (name, value, values) => el('select', { id: `taskParam-${name}`, name: `taskParam-${name}` }, ...values.map(item => el('option', { value: item, selected: String(value) === String(item) }, item)));
const params = state => state.taskParams || {};
const models = state => state.models || [];
const capabilities = state => state.capabilities || {};

function bindInput(state, actions, name, node) {
  node.addEventListener('input', e => actions.setTaskParam(name, e.target.value));
  node.addEventListener('change', e => actions.setTaskParam(name, e.target.type === 'number' ? Number(e.target.value) : e.target.value));
  return node;
}

export function renderTaskParameters(state, actions) {
  const p = params(state); const modelOptions = models(state).map(model => el('option', { value: model.id, selected: String(p.modelId) === String(model.id) }, model.name));
  if(!models(state).some(m=>String(m.id)===String(p.modelId)))modelOptions.unshift(el('option',{value:p.modelId||'',selected:true},tr(state,'请选择可用模型','Choose an available model')));
  const presetOptions = [el('option', { value: '', selected: !state.taskPresetId }, tr(state, '默认 / 自定义参数', 'Default / Custom settings')), ...(state.presets || []).map(preset => el('option', { value: preset.id, selected: String(state.taskPresetId) === String(preset.id) }, preset.name))];
  const form = el('div', { class: 'task-params' },
    field(tr(state, '参数预设', 'Parameter preset'), el('select', { id: 'taskParam-preset', name: 'taskParam-preset', onchange: e => actions.loadTaskPreset(e.target.value) }, ...presetOptions)),
    field(tr(state, '模型', 'Model'), bindInput(state, actions, 'modelId', el('select', { id: 'taskParam-modelId', name: 'taskParam-modelId' }, ...modelOptions))),
    field(tr(state, '反向 Prompt', 'Negative prompt'), bindInput(state, actions, 'negativePrompt', el('textarea', { id: 'taskParam-negativePrompt', name: 'taskParam-negativePrompt', rows: '2', value: p.negativePrompt || '', placeholder: tr(state, '不希望出现的内容…', 'What to avoid…') }))),
    el('div', { class: 'task-params-grid' },
      field(tr(state, '宽度', 'Width'), bindInput(state, actions, 'width', inp('width', p.width || 1024, { type: 'number', min: 64, max:4096, step: 8 }))),
      field(tr(state, '高度', 'Height'), bindInput(state, actions, 'height', inp('height', p.height || 1024, { type: 'number', min: 64, max:4096, step: 8 }))),
      field(tr(state, 'Steps', 'Steps'), bindInput(state, actions, 'steps', inp('steps', p.steps || 8, { type: 'number', min: 1, max: 200 }))),
      field(tr(state, 'CFG', 'CFG'), bindInput(state, actions, 'cfg', inp('cfg', p.cfg ?? 1, { type: 'number', min: 0, max: 50, step: .1 }))),
      field(tr(state, '采样器', 'Sampler'), bindInput(state, actions, 'sampler', select('sampler', p.sampler || 'euler', capabilities(state).samplers || ['euler']))),
      field(tr(state, '调度器', 'Scheduler'), bindInput(state, actions, 'scheduler', select('scheduler', p.scheduler || 'simple', capabilities(state).schedulers || ['simple']))),
      field('Seed', bindInput(state, actions, 'seed', inp('seed', p.seed ?? -1, { type: 'number',min:-1,max:Number.MAX_SAFE_INTEGER }))),
      field(tr(state, '降噪', 'Denoise'), bindInput(state, actions, 'denoise', inp('denoise', p.denoise ?? 1, { type: 'number', min: 0, max: 1, step: .05 })))),
    el('div', { class: 'task-params-note' }, tr(state, '任务固定每条 prompt 生成一次；批次大小在任务表单中设置。', 'Each prompt runs once; batch size is configured in the task form.')));
  return form;
}

function presetFields(state, actions, editor) {
  const p = editor.params || {}; const update = (name, node) => { const value = e => e.target.type === 'number' ? Number(e.target.value) : e.target.value; node.addEventListener('input', e => actions.updatePresetEditor(name, value(e))); node.addEventListener('change', e => actions.updatePresetEditor(name, value(e))); return node; };
  const modelsOptions = models(state).map(model => el('option', { value: model.id, selected: String(p.modelId) === String(model.id) }, model.name));
  if(!models(state).some(m=>String(m.id)===String(p.modelId)))modelsOptions.unshift(el('option',{value:p.modelId||'',selected:true},tr(state,'原模型不可用（可仅修改名称）','Original model unavailable (rename is still available)')));
  return el('form', { id: 'preset-editor', class: 'preset-editor', onsubmit: e => { e.preventDefault(); actions.savePresetEdits(); } },
    field(tr(state, '名称', 'Name'), update('name', el('input', { id: 'preset-name', name: 'name', value: editor.name || '', required: '', maxlength: 60 }))),
    field(tr(state, '模型', 'Model'), update('modelId', el('select', { id: 'preset-modelId', name: 'modelId' }, ...modelsOptions))),
    field(tr(state, '正向 Prompt', 'Positive prompt'), update('prompt', el('textarea', { id: 'preset-prompt', name: 'prompt', rows: 2, value: p.prompt || '' }))),
    field(tr(state, '反向 Prompt', 'Negative prompt'), update('negativePrompt', el('textarea', { id: 'preset-negativePrompt', name: 'negativePrompt', rows: 2, value: p.negativePrompt || '' }))),
    el('div', { class: 'preset-editor-grid' },
      field(tr(state, '宽度', 'Width'), update('width', inp('width', p.width || 1024, { type: 'number', min: 64, max:4096, step: 8 }))), field(tr(state, '高度', 'Height'), update('height', inp('height', p.height || 1024, { type: 'number', min: 64, max:4096, step: 8 }))),
      field(tr(state, 'Steps', 'Steps'), update('steps', inp('steps', p.steps || 8, { type: 'number', min: 1, max: 200 }))), field(tr(state, 'CFG', 'CFG'), update('cfg', inp('cfg', p.cfg ?? 1, { type: 'number', min: 0, max: 50, step: .1 }))),
      field(tr(state, '采样器', 'Sampler'), update('sampler', select('sampler', p.sampler || 'euler', capabilities(state).samplers || ['euler']))), field(tr(state, '调度器', 'Scheduler'), update('scheduler', select('scheduler', p.scheduler || 'simple', capabilities(state).schedulers || ['simple']))),
      field('Seed', update('seed', inp('seed', p.seed ?? -1, { type: 'number',min:-1,max:Number.MAX_SAFE_INTEGER }))), field(tr(state, '降噪', 'Denoise'), update('denoise', inp('denoise', p.denoise ?? 1, { type: 'number', min: 0, max: 1, step: .05 }))),
      field(tr(state, '批次大小', 'Batch size'), update('batchSize', select('batchSize', p.batchSize || 1, [1, 2, 4, 8]))), field(tr(state, '重复次数', 'Repeats'), update('repeat', inp('repeat', p.repeat || 1, { type: 'number', min: 1, max: 32 })))));
}

export function renderPresetManager(state, actions) {
  const list = state.presets || []; const editor = state.presetEditor;
  const cards = list.length ? list.map(preset => el('article', { class: 'preset-card' }, el('div', { class: 'preset-card-main' }, el('strong', {}, preset.name), preset.id === state.activePresetId && el('span', { class: 'preset-active' }, tr(state, '当前使用', 'Active')), el('small', { class: 'muted' }, `${preset.params?.sampler || 'euler'} · ${preset.params?.steps || 8} steps · ${preset.params?.width || 1024}×${preset.params?.height || 1024}`)), el('div', { class: 'preset-card-actions' }, button(tr(state, '使用', 'Use'), () => actions.selectPreset(preset.id), 'button small'), button(tr(state, '编辑', 'Edit'), () => actions.editPreset(preset), 'button small'), button(tr(state, '删除', 'Delete'), () => actions.deletePreset(preset), 'button small danger'))) ) : [el('p', { class: 'muted' }, tr(state, '还没有预设。', 'No presets yet.'))];
  return el('section', { class: 'preset-manager' }, el('div', { class: 'preset-manager-heading' }, el('div', {}, el('h2', {}, tr(state, '参数预设', 'Parameter presets')), el('p', { class: 'muted' }, tr(state, '保存常用的生成参数，任务中可以直接加载。', 'Save common generation settings for reuse.')))), el('div', { class: 'preset-list' }, ...cards), editor ? el('div', { class: 'preset-editor-wrap' }, presetFields(state, actions, editor), el('div', { class: 'preset-editor-actions' }, button(tr(state, '保存修改', 'Save changes'), () => {}, 'button primary', { type: 'submit', form: 'preset-editor' }), button(tr(state, '取消', 'Cancel'), actions.cancelPresetEditing, 'button'))) : null);
}
