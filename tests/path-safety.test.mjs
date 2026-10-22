import test from 'node:test';
import assert from 'node:assert/strict';
import { win32, posix } from 'node:path';
import { isWithinDirectory } from '../server/path-safety.mjs';

test('Windows containment distinguishes drives, parents, sibling prefixes and case', () => {
  const root = 'I:\\project\\public';
  for (const target of ['C:\\temp\\data', 'I:\\project', 'I:\\project\\public-backup', 'I:\\project\\public\\..\\data', '\\\\host\\share\\data']) {
    assert.equal(isWithinDirectory(root, target, win32), false, target);
  }
  for (const target of [root, 'i:\\PROJECT\\PUBLIC\\data', 'I:\\project\\public\\nested\\data']) {
    assert.equal(isWithinDirectory(root, target, win32), true, target);
  }
});

test('POSIX containment preserves public-directory protection', () => {
  for (const target of ['/app/public', '/app/public/data']) assert.equal(isWithinDirectory('/app/public', target, posix), true);
  for (const target of ['/app', '/app/data', '/app/public-backup']) assert.equal(isWithinDirectory('/app/public', target, posix), false);
});
