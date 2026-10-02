import { mkdir, readFile, writeFile, copyFile, lstat, realpath, stat, rm } from 'node:fs/promises';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import type { GitRunner } from './git-adapter.js';
import type { OperationRecord } from './operations.js';

const paths = ['--', '.', ':(exclude).branches'];
const sha = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
type Capture = { baseOid: string; files: Array<{ path: string; hash: string; tracked: boolean }>; patchHash: string };
type Carried = { version: 1; baseOid: string; diffHash: string; status: string; files: Array<{ path: string; hash: string | null }> };
export class ChangeSnapshots {
  constructor(private git: GitRunner, private directory: string) {}
  folder(op: OperationRecord): string { return join(this.directory, op.id); }
  async capture(op: OperationRecord): Promise<void> {
    const p = op.plan!, root = p.sourcePath, folder = this.folder(op);
    await mkdir(folder, { recursive: true });
    const head = (await this.git.run(['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    if (head !== p.headOid) throw new Error('source HEAD changed after planning; submit a new request');
    const status = () => this.git.run(['status', '--porcelain=v1', '-z', '--untracked-files=all', ...paths], { cwd: root });
    const before = (await status()).stdout;
    const patch = join(folder, 'changes.patch');
    await this.git.run(['diff', '--binary', '--no-ext-diff', `--output=${patch}`, p.headOid, ...paths], { cwd: root, timeoutMs: 60_000 });
    const untracked = (await this.git.run(['ls-files', '--others', '--exclude-standard', '-z', ...paths], { cwd: root })).stdout.split('\0').filter(Boolean);
    const tracked = (await this.git.run(['diff', '--name-only', '-z', p.headOid, ...paths], { cwd: root })).stdout.split('\0').filter(Boolean);
    const names = [...new Set([...untracked, ...tracked])];
    const files: Capture['files'] = [];
    for (const name of names) {
      if (isAbsolute(name) || name.split(/[\\/]/).includes('..')) throw new Error('unsafe untracked path');
      const source = resolve(root, name), canonicalRoot = await realpath(root);
      try { await lstat(source); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT' && tracked.includes(name)) continue; throw e; }
      const canonicalSource = await realpath(source);
      const rel = relative(canonicalRoot, canonicalSource);
      if (rel.startsWith('..') || isAbsolute(rel) || !(await lstat(source)).isFile()) throw new Error(`unsupported external/symlink file: ${name}`);
      let ancestor = source;
      while (ancestor !== resolve(root)) { if ((await lstat(ancestor)).isSymbolicLink()) throw new Error(`symlink requires manual carry: ${name}`); ancestor = dirname(ancestor); }
      const dest = join(folder, 'untracked', name); await mkdir(dirname(dest), { recursive: true });
      await copyFile(source, dest); files.push({ path: name, hash: sha(await readFile(dest)), tracked: tracked.includes(name) });
    }
    if ((await status()).stdout !== before || (await this.git.run(['rev-parse', 'HEAD'], { cwd: root })).stdout.trim() !== head) throw new Error('source changed during capture; retry with a new request');
    for (const item of files) if (sha(await readFile(join(root, item.path))) !== item.hash) throw new Error('source bytes changed during capture');
    const verificationPatch = join(folder, 'verify.patch');
    try {
      await this.git.run(['diff', '--binary', '--no-ext-diff', `--output=${verificationPatch}`, p.headOid, ...paths], { cwd: root, timeoutMs: 60_000 });
      if (sha(await readFile(verificationPatch)) !== sha(await readFile(patch))) throw new Error('source diff changed during capture');
    } finally { await rm(verificationPatch, { force: true }); }
    await writeFile(join(folder, 'capture.json'), JSON.stringify({ baseOid: head, files, patchHash: sha(await readFile(patch)) } satisfies Capture));
  }
  async carry(op: OperationRecord): Promise<{ carried: string[]; failed: string[] }> {
    const folder = this.folder(op), target = op.plan!.worktreePath;
    const capture = JSON.parse(await readFile(join(folder, 'capture.json'), 'utf8')) as Capture;
    const patch = join(folder, 'changes.patch'), raw = await readFile(patch);
    if (capture.patchHash !== sha(raw)) throw new Error('capture checksum mismatch');
    // A persisted completion marker makes re-entry safe. Unknown partial apply
    // is retained for manual inspection instead of applying the patch twice.
    const marker = join(folder, 'carried.json');
    const targetDiff = async () => {
      const path=join(folder,'target-verify.patch');
      try { await this.git.run(['diff','--binary','--no-ext-diff',`--output=${path}`,capture.baseOid,...paths],{cwd:target});return sha(await readFile(path)); }
      finally {await rm(path,{force:true});}
    };
    const targetStatus = async () => (await this.git.run(['status','--porcelain=v1','-z','--untracked-files=all',...paths],{cwd:target})).stdout;
    try {
      const finished = JSON.parse(await readFile(marker, 'utf8')) as Carried;
      if (finished.version !== 1 || finished.baseOid !== capture.baseOid || (await this.git.run(['rev-parse','HEAD'],{cwd:target})).stdout.trim() !== capture.baseOid || finished.status !== await targetStatus() || finished.diffHash !== await targetDiff()) throw new Error('carried worktree changed; manual recovery required');
      for (const item of finished.files) {
        let hash: string | null;try {hash=sha(await readFile(join(target,item.path)));}catch(e){if((e as NodeJS.ErrnoException).code !== 'ENOENT')throw e;hash=null;}
        if (hash !== item.hash) throw new Error('carried worktree changed; manual recovery required');
      }
      return { carried: finished.files.map(f => f.path), failed: [] };
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const dirty = (await this.git.run(['status', '--porcelain=v1', ...paths], { cwd: target })).stdout.trim();
    if (dirty) throw new Error('partial carry detected; manual recovery required');
    if (raw.length) await this.git.run(['apply', '--check', '--binary', patch], { cwd: target });
    for (const item of capture.files) {
      const source = join(folder, 'untracked', item.path);
      if (sha(await readFile(source)) !== item.hash) throw new Error('untracked capture checksum mismatch');
      if (item.tracked) continue;
      try { await stat(join(target, item.path)); throw new Error(`untracked target already exists: ${item.path}`); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    if (raw.length) await this.git.run(['apply', '--binary', patch], { cwd: target });
    for (const item of capture.files) { const dest = join(target, item.path); await mkdir(dirname(dest), { recursive: true }); await copyFile(join(folder, 'untracked', item.path), dest); }
    const changed = (await this.git.run(['diff', '--name-only', '-z', capture.baseOid, ...paths], { cwd: target })).stdout.split('\0').filter(Boolean);
    const finished = [];
    for (const name of new Set([...changed, ...capture.files.map(f => f.path)])) {
      try { finished.push({ path: name, hash: sha(await readFile(join(target, name))) }); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; finished.push({path:name,hash:null}); }
    }
    await writeFile(marker, JSON.stringify({version:1,baseOid:capture.baseOid,diffHash:await targetDiff(),status:await targetStatus(),files:finished} satisfies Carried));
    return { carried: [...changed, ...capture.files.map(f => f.path)], failed: [] };
  }
}
