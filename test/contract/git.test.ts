import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitAdapter, execGitRunner, GitError } from '../../src/host/git-adapter.js';
import { samePath } from '../../src/domain/paths.js';

const GIT = 'git';

async function freshRepo() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-git-adapter-'));
  const git = (args: string[]) => execFileSync(GIT, args, { cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'adapter@local.invalid']);
  git(['config', 'user.name', 'Adapter Test']);
  await writeFile(join(root, 'tracked.txt'), 'baseline\n');
  git(['add', 'tracked.txt']);
  git(['commit', '-m', 'baseline']);
  return { root, git };
}

test('identify a main-branch worktree', async () => {
  const { root, git } = await freshRepo();
  try {
    const adapter = new GitAdapter(execGitRunner(GIT), root);
    const id = await adapter.identify();
    assert.equal(samePath(id.worktreePath, root), true);
    assert.equal(id.branchRef, 'main');
    assert.ok(id.commonDir.endsWith('/.git'), `commonDir=${id.commonDir}`);
    assert.match(id.headOid, /^[0-9a-f]{40}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('identify a feature branch', async () => {
  const { root, git } = await freshRepo();
  try {
    git(['checkout', '-b', 'feature/x']);
    const id = await new GitAdapter(execGitRunner(GIT), root).identify();
    assert.equal(id.branchRef, 'feature/x');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('identify a detached HEAD (branchRef is null)', async () => {
  const { root, git } = await freshRepo();
  try {
    git(['checkout', '--detach', 'HEAD']);
    const id = await new GitAdapter(execGitRunner(GIT), root).identify();
    assert.equal(id.branchRef, null);
    assert.match(id.headOid, /^[0-9a-f]{40}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('identify inside a linked worktree: commonDir is shared, .git is a file', async () => {
  const { root, git } = await freshRepo();
  const wt = join(root, '..', `${root.split(/[\\/]/).at(-1)}-linked`);
  try {
    git(['worktree', 'add', '-b', 'linked', wt]);
    // Identify from a subdirectory of the linked worktree to prove the adapter
    // resolves the worktree top level rather than assuming cwd == top.
    await mkdir(join(wt, 'src'), { recursive: true });
    // Inside a linked worktree, `.git` is a FILE pointing at the common dir.
    const gitMarker = join(wt, '.git');
    const isFile = await import('node:fs').then(fs => fs.statSync(gitMarker).isFile());
    assert.equal(isFile, true, 'linked worktree .git must be a file (S03)');

    const adapter = new GitAdapter(execGitRunner(GIT), join(wt, 'src'));
    const id = await adapter.identify();
    // worktreePath resolves to the linked worktree top, not the primary repo
    assert.equal(samePath(id.worktreePath, wt), true);
    assert.equal(id.branchRef, 'linked');
    // common dir is the PRIMARY repo's .git, never the linked file path
    assert.ok(id.commonDir.endsWith('/.git'), `commonDir=${id.commonDir}`);
    assert.ok(!id.commonDir.includes('.git/worktrees'), 'commonDir must be the shared .git, not a worktrees subdir');
  } finally {
    execFileSync(GIT, ['worktree', 'remove', '--force', wt], { cwd: root, windowsHide: true, stdio: 'ignore' });
    await rm(root, { recursive: true, force: true });
  }
});

test('identify a nested repo resolves to the inner repo', async () => {
  const { root, git } = await freshRepo();
  const nested = join(root, 'vendor', 'inner');
  try {
    await mkdir(nested, { recursive: true });
    const innerGit = (args: string[]) => execFileSync(GIT, args, { cwd: nested, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    innerGit(['init', '-b', 'main']);
    innerGit(['config', 'user.email', 'inner@local.invalid']);
    innerGit(['config', 'user.name', 'Inner']);
    await writeFile(join(nested, 'f.txt'), 'inner\n');
    innerGit(['add', 'f.txt']);
    innerGit(['commit', '-m', 'inner']);
    const id = await new GitAdapter(execGitRunner(GIT), nested).identify();
    assert.equal(samePath(id.worktreePath, nested), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('identify outside any repo throws a not-repo error', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'dsh-git-noop-'));
  try {
    await assert.rejects(() => new GitAdapter(execGitRunner(GIT), empty).identify(), (err: unknown) => {
      assert.ok(err instanceof GitError, 'expected GitError');
      return true;
    });
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test('runner cancels via signal and maps the error kind', async () => {
  const { root } = await freshRepo();
  try {
    const controller = new AbortController();
    controller.abort();
    const runner = execGitRunner(GIT);
    await assert.rejects(
      () => runner.run(['rev-parse', 'HEAD'], { cwd: root, signal: controller.signal }),
      (err: unknown) => err instanceof GitError && err.kind === 'cancelled',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
