// Git adapter — the only place the plugin talks to the git CLI.
//
// S03: the old code built `root/.git/info/exclude` and read `HEAD` assuming a
// single worktree. In a linked worktree `.git` is a FILE, not a directory, so
// any path joined under it is wrong; and `git diff HEAD` describes the current
// worktree's HEAD, not some other branch. This adapter derives identity from
// porcelain (`rev-parse` / `worktree list`) instead of guessing paths.
//
// Every call goes through a bounded, cancellable process wrapper: timeout,
// output caps, and a mapped error carrying the git exit code.

import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { normalizePath } from '../domain/paths.js';

export type GitIdentity = {
  /** Absolute git common dir (the real object store / shared .git). */
  commonDir: string;
  /** Absolute worktree top level (the checkout the caller is inside). */
  worktreePath: string;
  /** OID of the worktree's current HEAD. */
  headOid: string;
  /** Short branch name, or null when HEAD is detached. */
  branchRef: string | null;
};

export type GitErrorKind = 'not-repo' | 'timeout' | 'cancelled' | 'io' | 'unknown';

export class GitError extends Error {
  readonly kind: GitErrorKind;
  readonly code: number | null;
  readonly stderr: string;

  constructor(kind: GitErrorKind, message: string, code: number | null = null, stderr = '') {
    super(message);
    this.name = 'GitError';
    this.kind = kind;
    this.code = code;
    this.stderr = stderr;
  }
}

export type GitRunOptions = {
  /** Directory the git command runs in. */
  cwd: string;
  /** Output cap in bytes; exceeding it fails fast instead of buffering forever. */
  maxBuffer?: number;
  /** Hard timeout in milliseconds. */
  timeoutMs?: number;
  /** Cancellation signal. */
  signal?: AbortSignal;
};

export type GitRunner = {
  run(args: string[], options?: GitRunOptions): Promise<{ stdout: string; stderr: string }>;
};

/** Default runner: the real git binary via execFile, fully bounded. */
export function execGitRunner(gitPath: string): GitRunner {
  return {
    run(args, options) {
      const opts = options ?? { cwd: process.cwd() };
      return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile(
          gitPath,
          args,
          {
            cwd: opts.cwd,
            windowsHide: true,
            maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024,
            timeout: opts.timeoutMs ?? 15_000,
            signal: opts.signal,
          },
          (error, stdout, stderr) => {
            if (error === null) {
              resolve({ stdout: String(stdout), stderr: String(stderr) });
              return;
            }
            const code = typeof (error as { code?: number | string }).code === 'number'
              ? ((error as { code: number }).code)
              : null;
            const rawStderr = String(stderr ?? '');
            const rawMessage = String((error as { message?: string }).message ?? '');
            let kind: GitErrorKind = 'io';
            if ((error as { killed?: boolean }).killed === true) kind = 'timeout';
            else if (opts.signal?.aborted === true) kind = 'cancelled';
            else if (code === 128) kind = 'not-repo';
            else kind = 'io';
            reject(new GitError(kind, rawMessage.slice(0, 300), code, rawStderr.slice(0, 2000)));
          },
        );
      });
    },
  };
}

export class GitAdapter {
  readonly #runner: GitRunner;
  readonly #cwd: string;

  constructor(runner: GitRunner, cwd: string) {
    this.#runner = runner;
    this.#cwd = cwd;
  }

  /**
   * Resolve the git identity of the repository containing `cwd`.
   *
   * - worktree top level comes from `rev-parse --show-toplevel`;
   * - common dir comes from `rev-parse --path-format=absolute --git-common-dir`
   *   (absolute even inside a linked worktree, where `.git` is a file);
   * - HEAD oid from `rev-parse HEAD`;
   * - branch ref from `symbolic-ref --quiet --short HEAD`, null when detached.
   */
  async identify(): Promise<GitIdentity> {
    const worktreePath = await this.#text(['rev-parse', '--show-toplevel']);
    const commonDir = await this.#text(['rev-parse', '--path-format=absolute', '--git-common-dir']);
    const headOid = await this.#text(['rev-parse', 'HEAD']);
    const branchRef = await this.#optionalText(['symbolic-ref', '--quiet', '--short', 'HEAD']);
    return {
      commonDir: normalizePath(await realpath(commonDir)),
      worktreePath: normalizePath(await realpath(worktreePath)),
      headOid,
      branchRef,
    };
  }

  async #text(args: string[]): Promise<string> {
    const { stdout } = await this.#runner.run(args, { cwd: this.#cwd });
    const value = stdout.trim();
    if (value === '') throw new GitError('unknown', `git ${args[0]} produced no output`, null, '');
    return value;
  }

  async #optionalText(args: string[]): Promise<string | null> {
    try {
      const { stdout } = await this.#runner.run(args, { cwd: this.#cwd });
      const value = stdout.trim();
      return value === '' ? null : value;
    } catch (error) {
      // Detached HEAD makes `symbolic-ref` exit non-zero — that is a valid
      // answer (null), not a failure. Only surface genuinely unexpected errors.
      if (error instanceof GitError && error.code === 1) return null;
      throw error;
    }
  }
}
