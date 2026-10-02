// Path normalisation and directory-boundary containment.
//
// Inputs are canonical absolute paths produced by the host/git adapter
// (resolved / realpath'd). These helpers never touch the filesystem and never
// guess a repo from a bare string prefix — the B06 class of bug.
//
// Normalisation policy (matching audit §6):
//   - separator: `/` and `\` are equivalent, normalised to `/`
//   - case: Windows identities are lower-cased; POSIX identities retain case
//   - trailing separators dropped (except a bare drive root, which stays `X:`)

const SEP = /[\\/]+/g;

/** Lower-case, single-separator canonical form of an absolute Windows path. */
export function normalizeWindowsPath(input: string): string {
  const s = String(input ?? '');
  // Drive root `E:\` → `E:`, everything else loses trailing slashes.
  const trimmed = s.replace(SEP, '/').replace(/\/+$/, '');
  return trimmed.toLowerCase();
}

/** Windows identities fold case; POSIX identities retain filesystem case. */
export function normalizePath(input: string): string {
  const s = String(input ?? '');
  if (/^(?:[a-z]:|\\\\|\/\/)/i.test(s)) return normalizeWindowsPath(s);
  const trimmed = s.replace(/\/+/g, '/').replace(/\/+$/, '');
  return trimmed || (s.startsWith('/') ? '/' : '');
}

/**
 * True when `candidate` is `root` itself or lives inside `root`'s directory
 * tree. The boundary is a real path separator, so `E:/repo-other` is NOT
 * inside `E:/repo` (B06), and `E:/repo` IS inside itself.
 */
export function isInside(root: string, candidate: string): boolean {
  const r = normalizePath(root);
  const c = normalizePath(candidate);
  if (r === '' || c === '') return false;
  if (c === r) return true;
  return c.startsWith(r === '/' ? '/' : `${r}/`);
}

/**
 * True when the two paths identify the same directory. Equality is on the
 * canonical form, not on string identity — `E:\repo` equals `e:/repo/`.
 */
export function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}
