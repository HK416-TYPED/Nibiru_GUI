import test from 'node:test';
import assert from 'node:assert/strict';
import {gridLayout} from '../public/grid-layout.mjs';
test('every grid cell fits without clipping for all supported column choices',()=>{
  for(const count of [1,3,9,32,64])for(const cols of [1,2,3,4,8])for(const labels of [true,false]){
    const g=gridLayout(count,cols,labels);
    assert.ok(g.width*g.height<=16000000);assert.ok(g.width<=8192&&g.height<=8192);
    const lastY=Math.floor((count-1)/g.columns)*(g.cell+g.labelHeight);
    assert.ok(lastY+g.cell+g.labelHeight<=g.height);
    assert.ok(((count-1)%g.columns)*g.cell+g.cell<=g.width);
  }
});

import {previewLayout} from '../public/grid-layout.mjs';
test('preview fits four portraits across a wide short canvas and wraps on narrow screens',()=>{
  assert.deepEqual(previewLayout(4,1200,240,960/1536),{columns:4,rows:1});
  assert.deepEqual(previewLayout(4,350,500,960/1536),{columns:2,rows:2});
  assert.deepEqual(previewLayout(4,600,600,1536/960),{columns:2,rows:2});
  assert.deepEqual(previewLayout(1,1200,240,.625),{columns:1,rows:1});
});
test('resolution proportions and image count determine rows and columns',()=>{
  assert.deepEqual(previewLayout(2,400,600,[2,2]),{columns:1,rows:2});
  assert.deepEqual(previewLayout(2,400,600,[.5,.5]),{columns:2,rows:1});
  assert.deepEqual(previewLayout(4,1200,600,[2,2,2,2]),{columns:2,rows:2});
  assert.deepEqual(previewLayout(4,1200,600,[.625,.625,.625,.625]),{columns:4,rows:1});
  assert.deepEqual(previewLayout(8,1200,600,.625),{columns:4,rows:2});
});
