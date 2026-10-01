import assert from 'node:assert/strict';
import test from 'node:test';
import { isInside, normalizeWindowsPath, samePath } from '../../src/domain/paths.js';

// B06 regression: prefix collision must not claim a sibling directory.
test('Windows directory boundaries', () => {
  assert.equal(isInside('E:/repo', 'e:\\repo\\src'), true);
  assert.equal(isInside('E:/repo', 'E:/repo-other'), false);
  assert.equal(isInside('E:/repo', 'E:/repo'), true);
});

test('root equality in both separator styles', () => {
  assert.equal(isInside('E:\\repo', 'E:/repo/'), true);
  assert.equal(isInside('E:/repo/', 'e:\\repo'), true);
});

test('subdirectory by a real separator, not a name prefix', () => {
  assert.equal(isInside('E:/repo', 'E:/repo/sub/dir'), true);
  assert.equal(isInside('E:/repo', 'E:/repo2'), false);
  assert.equal(isInside('E:/repo', 'E:/repo-sub'), false);
});

test('sibling and unrelated drives are outside', () => {
  assert.equal(isInside('E:/repo', 'F:/repo'), false);
  assert.equal(isInside('E:/repo/a', 'E:/repo/b'), false);
});

test('empty inputs never contain', () => {
  assert.equal(isInside('', 'E:/repo'), false);
  assert.equal(isInside('E:/repo', ''), false);
});

test('normalise unifies separators, case and trailing slash', () => {
  assert.equal(normalizeWindowsPath('E:\\Repo\\src\\'), 'e:/repo/src');
  assert.equal(normalizeWindowsPath('E:/REPO'), 'e:/repo');
  assert.equal(normalizeWindowsPath('E:\\'), 'e:');
});

test('samePath treats equivalent Windows paths as one directory', () => {
  assert.equal(samePath('E:\\repo', 'e:/repo/'), true);
  assert.equal(samePath('E:/repo', 'E:/repo-other'), false);
});
