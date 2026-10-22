export function generationBlock(state) {
  if (state.loading) return 'submitting';
  if (state.presetBusy) return 'preset-loading';
  if (state.capabilities.online !== true) return 'offline';
  if (!state.models.length) return 'no-models';
  if (!state.models.some(model => String(model.id) === String(state.draft.modelId))) return 'choose-model';
  return null;
}

export function isGenerateShortcut(event) {
  return Boolean(event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing && event.keyCode !== 229 && !event.repeat);
}

export function queueGroups(batches) {
  return {
    active: batches.filter(batch => ['queued', 'running'].includes(batch.status)),
    recent: batches.filter(batch => ['completed', 'failed', 'cancelled'].includes(batch.status)).slice(0, 3),
  };
}
