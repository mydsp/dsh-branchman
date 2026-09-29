# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-09-29

First public release.

### Added

- **`branch_fork`** — one atomic action: `git worktree add .branches/<name>` on a
  new branch, plus a child session whose `cwd` is that worktree and which
  inherits the conversation it forked from. Records the tree edge.
- **`branch_tree`** — the direction tree as JSON (who forked from whom, worktree
  paths, branches, status, inherited event count).
- **`branch_status`** — per-direction `ahead` / `behind` / uncommitted files
  against the main line.
- **`branch_merge`** — merge a finished direction back (`--no-ff`, guarded by a
  clean-main-line check).
- **`branch_drop`** — tear a direction down (worktree + branch + tree node).
- **Per-message 「⎇ branch to a new direction」 control** in the assistant action
  row: name the direction, add a one-line handoff, and the worktree, the child
  session, the inherited history and the tree edge all happen in one click.
- **Graphical overview** (「🗺 directions overview」), reachable from the message
  actions and from a persistent button next to the composer: an SVG branch map
  with the main line as a dark root node, direction boxes, bezier edges, tidy-tree
  layout, drag-to-pan, wheel/button zoom and fit-to-window. Clicking a box shows
  its details and can switch to that session.
- **Passive tree projection** — sessions whose cwd sits under `.branches/` are
  added to the tree automatically, so directions opened outside the button still
  show up. Metadata only; message bodies never enter the tree file.
- **`/branchman/` host page** and `/branchman/api/{tree,status,fork,bind}` JSON
  endpoints.
- **140 offline assertions** across four suites (`npm test`), no host restart and
  no touching of your own repositories.
- **`scripts/branchman.ps1`** — a zero-restart CLI fallback for when the plugin
  is not loaded (status / save / fork / list / sync / merge / drop).
- **`scripts/preview-overview.mjs` + `shot-overview.py`** — render the overview
  offline from the plugin's own drawing code, for visual review without launching
  the app.

### Fixed

- **Root resolution on a fresh install.** The UI sends only the session's cwd
  (`sourceCwd`), never `root`, so with a portable default the fork used to fall
  back to the host process's cwd — i.e. not the user's repository at all. The
  repository is now located with `git rev-parse --show-toplevel`, which also
  accepts a subdirectory as the starting point.

### Distribution

- Published to npm as [`dsh-branchman`](https://www.npmjs.com/package/dsh-branchman) —
  `pnpm add dsh-branchman`. The tarball checksum matches a local `npm pack`.
  Future releases go through GitHub Actions with npm trusted publishing (OIDC).

### Notes

- Verified against DSH Desktop 2.0.14 / Harness 0.1.7-rc.1.
- Plugin code is loaded at host start: editing `index.js`, `client.js`,
  `package.json` or `cordis.patch.yml` requires a full restart of DSH.
