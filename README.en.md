# Branchman 0.3.0

Independent Git worktrees and conversation directions for DeepSeek Harness.

The actual host and client entries are built from `src/host/runtime.ts` and `src/client/entry.ts`. The overview includes ordinary conversations even before any direction exists. Direction names are display labels; UUIDs identify repositories, worktrees and directions.

Create a direction from the composer or a completed assistant message. Inherited history ends at the selected completed turn. Blank history is also supported. Handoff notes are saved in direction details and are not automatically submitted to the model.

Uncommitted regular files, including CJK names and binary contents, can be carried with byte verification. Symlinks, submodules and `.branches` contents are excluded. Merge, sync and removal verify actual worktree ownership. Dirty files, unmerged commits and conflicts block unsafe cleanup.

Durable journals make interrupted forks recoverable without creating duplicate children. The UI exposes recovery states, supports list/graph views, pagination, search, keyboard interaction and host theme/locale changes.

Verified locally with official `@deepseek-ai/dsh-desktop@0.2.0-rc.2` and Electron 44 in an isolated profile. Production has not been switched. The acceptance model is a local deterministic service; this validates integration rather than model quality.

See [acceptance](docs/ACCEPTANCE.md), [installation](docs/INSTALL.md), [architecture](docs/ARCHITECTURE.md) and [host contracts](docs/CONFORMANCE.md).

Development: `npm ci`, `npm test`, `npm run build`, then `npm pack --ignore-scripts`. The build uses esbuild from `E:\tools\dsh-build-tools` or `DSH_BUILD_TOOLS`. Runtime React and host services are provided by DSH.
