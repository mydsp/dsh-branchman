# Branchman 0.3.2

Conversation directions and independent Git worktrees for DeepSeek Harness.

![Separate main trees](docs/overview.png)

[中文](README.md) · [Installation](docs/INSTALL.md) · [Acceptance scope](docs/ACCEPTANCE.md)

## What changed

Independent main trees occupy separate cards. The outline shows real ancestry with indentation and collapse controls. Repository and main-tree filters, ancestor-preserving search/pagination, readable default zoom, optional details and selected-node focus make larger forests easier to navigate. Refresh preserves the camera.

Create a direction from the composer or a completed assistant message. History stops at the selected completed turn; blank history is supported. UUIDs identify worktrees and directions; names are display labels. Handoff notes are saved rather than automatically sent to the model.

Regular uncommitted files, including CJK paths and binary contents, can be carried with byte verification. Symlinks, submodules and `.branches` are excluded. Merge, sync and removal check real worktree ownership; dirty files, unmerged commits and conflicts block the corresponding operation. Durable journals support interrupted-fork recovery without duplicate children.

## Installation

Verified with `@deepseek-ai/dsh-desktop@0.2.0-rc.2`; Electron 44 is the runtime version. Download `dsh-branchman-0.3.2.tgz` from GitHub Releases, close the desktop and install/register the bundle in its actual profile. See [installation](docs/INSTALL.md). Runtime React and host services are provided by DSH.

Migration writes a separate `tree-v2.json` and preserves v1 `tree.json`. Unknown historical bases remain recovery states. Downgrades must account for data compatibility.

## Development

```sh
npm ci
npm test
npm run build
npm pack --ignore-scripts
```

Build dependencies are included in the checkout. `DSH_BUILD_TOOLS` optionally selects an existing shared esbuild installation. Published packages contain built entries. See [architecture](docs/ARCHITECTURE.md) and [host contracts](docs/CONFORMANCE.md).
