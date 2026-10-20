import test from 'node:test';
import assert from 'node:assert/strict';
import {taskParameters} from '../public/task-state.mjs';
test('task settings clone a preset without mutating generation settings and force a single repetition',()=>{
  const generation={modelId:1,steps:8,batchSize:1,repeat:32,prompt:'draft'};
  const preset={steps:27,batchSize:8,repeat:16,prompt:'saved'};
  const task=taskParameters(generation,preset);task.steps=12;
  assert.equal(task.repeat,1);assert.equal(task.batchSize,8);assert.equal(task.prompt,'');
  assert.equal(generation.steps,8);assert.equal(generation.repeat,32);assert.equal(preset.steps,27);
});
