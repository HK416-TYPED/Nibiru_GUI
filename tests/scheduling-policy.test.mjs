import test from 'node:test';
import assert from 'node:assert/strict';
import {roundCapacity,updateImageEstimate} from '../server/scheduling-policy.mjs';
test('round admission adapts to measured latency, waiting users and external load',()=>{
  assert.equal(roundCapacity({waitingUsers:10,estimatedImageMs:3000}),10);
  assert.equal(roundCapacity({waitingUsers:10,estimatedImageMs:10000}),3);
  assert.equal(roundCapacity({waitingUsers:10,estimatedImageMs:20000}),1);
  assert.equal(roundCapacity({waitingUsers:10,estimatedImageMs:3000,externalQueueDepth:4}),2);
  assert.equal(roundCapacity({waitingUsers:2,estimatedImageMs:1000}),2);
  assert.equal(roundCapacity({waitingUsers:0}),0);
  assert.ok(updateImageEstimate(10000,20000)>10000);
  assert.ok(updateImageEstimate(10000,1000)<10000);
});
