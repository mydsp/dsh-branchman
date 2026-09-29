# dsh-branchman

> Tree-branching engineering directions for **DeepSeek Harness**: one action = an isolated git worktree + a child conversation that inherits the one it forked from + an edge in a tree you can see.

![Directions overview](docs/overview.png)

*The in-app overview: the main line is the dark root node, every direction is a box (green = merged, dashed grey = dropped). Drag to pan, wheel to zoom, click a box for details and to switch to that session.*

*(中文文档见 [README.md](README.md))*

---

## The problem

The honest workflow of an unclear project is: the conversation reaches some point → you want to try a
different direction → that direction needs to edit files.

Then you either let both directions write into the same directory and fight over it, or you clone the
whole thing and lose sync with the main line forever.

DSH and git each already have half of the answer; what was missing is the middle step:

| Already there | Missing |
|---|---|
| The GUI branch button forks the **conversation** | the child's cwd does not change — both directions still write the same files |
| `git worktree` forks the **workspace** | it has nothing to do with the conversation, you drive both by hand, and nothing records who forked from whom |

**dsh-branchman welds them together**: forking the conversation drags the workspace along, and the tree
records and draws itself.

## What using it looks like

Click **`⎇ branch to a new direction`** in the action row of any assistant reply, name the direction, add a
one-line handoff, and then:

```
1. a git worktree at .branches/<name> on a fresh branch
2. a child session whose cwd is that worktree, with the parent conversation's history inherited
   (not an empty session)
3. the handoff line becomes the child's first context
4. the app switches to the new session
```

From then on that direction is an **isolated workspace plus an isolated conversation**: the main line keeps
moving, and `branch_status` shows the drift, `branch_merge` brings the work back, `branch_drop` tears it down.

## Capabilities

**Five agent tools** (you can also just say "open a direction to try X"):

| Tool | What it does |
|---|---|
| `branch_fork` | worktree + child session + tree edge, atomically |
| `branch_tree` | the direction tree as JSON (parent, status, inherited event count) |
| `branch_status` | per-direction ahead / behind / uncommitted files vs the main line |
| `branch_merge` | merge a finished direction back (main line must be clean; `--no-ff` keeps the record) |
| `branch_drop` | tear down: worktree + branch + tree node |

**UI**: a branch button and an overview entry in every assistant action row, plus a persistent overview
button next to the composer. The overview is an SVG branch map — click a box for details and to jump to
that direction's session.

**Passive projection**: sessions whose cwd sits under `.branches/` are picked up automatically, so
directions opened outside the button still appear. Metadata only — **message bodies never enter the tree**.

**Zero-restart fallback**: `scripts/branchman.ps1` is a plain git CLI (status/save/fork/list/sync/merge/drop)
for when the plugin is not loaded.

## Install

```powershell
cd $env:DSH_HOME\profiles\desktop
pnpm add dsh-branchman
```

Add `"dsh-branchman"` to `dsh.profile.bundles` in that profile's `package.json`, then **fully quit DSH
(including the tray icon) and start it again** — plugin code is loaded at host start and is not hot-reloaded.

> Installing from source also works: `pnpm add github:mydsp/dsh-branchman` (append `#v0.1.0` to pin a tag).
> The npm tarball and the repository are the same content — 0.1.0's checksum matches `npm pack` locally.

> Manual install, local development, configuration and full troubleshooting: **[docs/INSTALL.md](docs/INSTALL.md)** (Chinese).

## Design notes

- **One atomic action.** Forking the conversation and forking the workspace have to happen together, or
  "go back to that point and try something else" does not actually hold.
- **History comes from the host's own fork path**: `observeSession` → take the **latest completed turn
  prefix** as the boundary → `buildForkSeed` → `agents.create`. Using the last event as the boundary
  inherits a half-finished turn.
- **The tree stores metadata only.** Nodes are keyed by direction name + cwd; the session id is a
  best-effort link that may go stale without breaking anything.
- **Serialized writes with a unique temp name per save.** An earlier revision lost a fork to that race.
- **Failures have to say something actionable** — what was created, what was not, and where to click next.

Architecture, data shape and code invariants: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (Chinese).

## For DSH plugin authors

**[docs/PLUGIN-NOTES.md](docs/PLUGIN-NOTES.md)** collects 28 host-behaviour contracts paid for with real
errors: cordis services throwing on undeclared access, why `defineTool` is mandatory, why
`exports["./client"]` must be a string, why the client session catalogue needs `refresh()` before opening a
session, the concurrent-write ENOENT, and the fact that the GUI is closed to external browsers. If you are
writing a DSH plugin, this saves most of the detours. (Chinese.)

## Tests

```powershell
npm test
```

**140 assertions in four suites — no host restart, no touching your own repositories**: host tool
integration and write-race invariants, the seeded-fork path (inherited history, agent preset, boundary
algorithm), the browser half driven through a stubbed DOM with real button clicks plus the overview graph,
and a manifest pre-flight that runs the host's own validation rules so a bad manifest cannot get the whole
plugin rolled back.

Zero dependencies — no `npm install` needed. CI runs the same suites on ubuntu with node 22 and 24 (the one
assertion that needs a local DSH install reports `SKIP` there instead of `FAIL`).

## Conformance

Checked clause by clause against the host's own plugin specification
(`dsh-agent-preset/skills/cordis-plugin-development`); the table lives in
**[docs/CONFORMANCE.md](docs/CONFORMANCE.md)**. What 0.1.1 fixed: the Host export form,
`ctx.effect` ownership of every registration, overlays moved into the host's `shell.overlay`
slot (nothing is appended to `document.body`), theme tokens instead of literal colours,
UI copy routed through the Client locale service, and plugin-card metadata.

**Verification boundary, stated plainly**: there is no browser control on the agent side
(the GUI rejects every external browser with 403), so the interface has **not** been visually
verified by the agent. `npm test` covers syntax, the manifest, the tool pipeline, the seeded
fork path, the pure layout maths and statically checkable conformance clauses.

## Compatibility

- Tested against DSH Desktop 2.0.14 / Harness 0.1.7-rc.1
- Degrades to an empty child (and says so) when the host does not expose `sessionQuery` / `agents`
- Requires git ≥ 2.28

## Limitations

- The direction name is also the directory and branch name (≤ 60 characters)
- `fork` / `merge` require a clean main worktree — the guard is deliberate
- History is inherited only when the source conversation has a completed turn; otherwise the child starts
  empty (the host's own fork refuses outright in that case)
- The overview graph is read-only for now: merge / drop go through the tools or the script

## License

[MIT](LICENSE) © 2026 mydsp
