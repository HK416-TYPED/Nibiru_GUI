import test from 'node:test';
import assert from 'node:assert/strict';
import {generationBlock,isGenerateShortcut,queueGroups} from '../public/workspace-state.mjs';

test('IME composition, held keys and plain Enter do not submit a generation',()=>{
  assert.equal(isGenerateShortcut({key:'Enter',ctrlKey:true}),true);
  assert.equal(isGenerateShortcut({key:'Enter',metaKey:true}),true);
  for(const patch of [{isComposing:true},{keyCode:229},{repeat:true}])assert.equal(isGenerateShortcut({key:'Enter',ctrlKey:true,...patch}),false);
  assert.equal(isGenerateShortcut({key:'Enter'}),false);
});
test('submission is blocked while offline, loading or without a selected enabled model',()=>{
  const state={loading:false,capabilities:{online:true},models:[{id:1}],draft:{modelId:'1'}};
  assert.equal(generationBlock(state),null);
  assert.equal(generationBlock({...state,loading:true}),'submitting');
  assert.equal(generationBlock({...state,presetBusy:true}),'preset-loading');
  assert.equal(generationBlock({...state,capabilities:{online:false}}),'offline');
  assert.equal(generationBlock({...state,capabilities:{}}),'offline');
  assert.equal(generationBlock({...state,models:[]}),'no-models');
  assert.equal(generationBlock({...state,draft:{modelId:7}}),'choose-model');
});
test('queue separates active work from terminal states without changing original data',()=>{
  const batches=['completed','running','failed','queued','cancelled','completed'].map((status,id)=>({status,id}));
  const before=JSON.stringify(batches),groups=queueGroups(batches);
  assert.deepEqual(groups.active.map(x=>x.status),['running','queued']);
  assert.deepEqual(groups.recent.map(x=>x.status),['completed','failed','cancelled']);
  assert.equal(JSON.stringify(batches),before);
});
