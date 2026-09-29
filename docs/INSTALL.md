# 安装与排障

## 前置

| 项 | 要求 |
|---|---|
| 宿主 | DSH Desktop（profile `desktop` 由 Electron 托管）或 DSH CLI |
| git | ≥ 2.28（需要 `worktree add -b`） |
| node | ≥ 22.19（宿主自带的即可） |
| 依赖 | **零**。插件只用 node 内置模块 + 宿主自己的裸 `@deepseek-ai/*` 导入 |

实测版本：DSH Desktop **2.0.14** / Harness **0.1.7-rc.1**。

---

## 安装路径怎么选

| 路径 | 前提 | 说明 |
|---|---|---|
| **A. 从 npm 装** | profile 目录可用 pnpm | 最标准；宿主按包名从 `node_modules` 解析 bundle |
| B. 从 GitHub 源码装 | 同上 + 有 git | 包内容与 npm 一致，可锁标签 |
| C. 手动放置 | 无网络 | 四个文件即插即用 |
| D. 本地开发 | 有仓库源码 | 同步脚本 + 重启 |

> 宿主规范建议通过 `plugin_manager install_bundle` 安装，而**不要**用 shell 复刻安装步骤。
> 本机 Desktop 版的 `desktop` profile 由 Electron 托管，CLI 的 `dsh plugin add` 会被
> `rejectElectronProfile` 拒绝，所以下面给出的是实测可用的等价路径；如果你的宿主暴露了
> `plugin_manager` 工具，优先用它安装。

## 方式 A：从 npm 安装（推荐）

```powershell
cd $env:DSH_HOME\profiles\desktop
pnpm add dsh-branchman
```

然后把包名加进该 profile 的 `package.json`：

```jsonc
{
  "dsh": {
    "profile": {
      "bundles": [
        // …已有的 bundle…
        "dsh-branchman"
      ]
    }
  }
}
```

最后**完全退出 DSH（含托盘图标）再启动**——注意：Desktop 版的 `desktop` profile 由 Electron 托管，
CLI 的 `dsh plugin add` 会被拒绝，必须走上面这条等价路径。

> **`ECONNREFUSED`（例如指向 `127.0.0.1:7897`）**：你本机的 npm 配了一个当前连不上的代理
> （代理软件 / VPN 没开）。两种绕过方式，**别去改全局 `.npmrc`**：
> `pnpm add dsh-branchman --config.proxy=null --config.https-proxy=null`，
> 或给单次命令指定一个不含代理的配置：`pnpm --userconfig=<无 proxy 的 .npmrc> add dsh-branchman`。

## 方式 B：从 GitHub 源码安装

包与仓库同源，直接从 git 装也行（`#v0.1.0` 可指定标签）：

```powershell
cd $env:DSH_HOME\profiles\desktop
pnpm add github:mydsp/dsh-branchman
```

同样把 `"dsh-branchman"` 加进 `dsh.profile.bundles`，然后完全重启。

## 方式 C：手动放置（无网络）

把这四个文件放进 `<profile>\node_modules\dsh-branchman\`：

```
index.js   client.js   package.json   cordis.patch.yml
```

同样把 `"dsh-branchman"` 加进 `dsh.profile.bundles`，然后完全重启。

## 方式 D：本地开发

在仓库里改代码后，用同步脚本推到你 profile 里再重启：

```powershell
pwsh -File scripts\deploy-local.ps1                          # 同步 desktop profile
pwsh -File scripts\deploy-local.ps1 -Profile other           # 指定 profile
pwsh -File scripts\deploy-local.ps1 -WithPatch               # 连 cordis.patch.yml 一起覆盖
```

脚本只同步 `index.js` / `client.js` / `package.json`（**不动你本机的 `cordis.patch.yml`**，
那是你的配置），同步前备份到 `$DSH_HOME\backups\dsh-branchman-<时间戳>\`，
同步后对两个源文件跑 `node --check` —— 坏文件不会被留在 profile 里。
同步完仍需**完全退出 DSH 再启动**（脚本不会替你重启应用）。

---

## 配置

`cordis.patch.yml` 默认只写一个键，其余都有可移植默认值：

| 键 | 默认 | 说明 |
|---|---|---|
| `dataFile` | `$DSH_HOME/branchman/tree.json` | 树数据（只含元数据） |
| `defaultRoot` | 进程 cwd | 工具调用未传 `root` 时的仓库根 |
| `gitPath` | `git`（走 PATH） | git 可执行文件；便携版 git 没进 PATH 时才需要写 |

想固定默认仓库根，就把它写回 profile 的 patch：

```yaml
- id: branchman
  config:
    dataFile: !!js dshHomePath('branchman/tree.json')
    defaultRoot: 'E:/your/repo'
```

---

## 装好之后的验收

1. 每条 assistant 回复尾部出现 **`⎇ 分支到新走向`** 与 **`🗺 走向总览`**；输入框旁也有 **`🗺 走向总览`**
2. 让 agent 调一次 `branch_tree` —— 能返回 `{ version, nodes, capabilities }` 即宿主半边就位
3. `capabilities` 里 `sessionQuery` / `agents` / `agentDefaultModel` 都为 `true`
   （任一为 `false` 时，子会话不会继承历史，会明确提示你）
4. 点 `⎇ 分支到新走向` → 填走向名 → 弹窗四步走完自动关闭并切到新会话

---

## 排障

| 现象 | 原因 / 处理 |
|---|---|
| 按钮完全没出现 | `dsh.profile.bundles` 里没加包名，或 `exports["./client"]` 不是字符串；**必须完全重启**，插件代码不热重载 |
| `client-modules: … exports no "./client" bundle` | 见上；宿主会把整个包回滚，`node test/manifest.mjs` 能离线预检出来 |
| `sessions.retain: unknown session <id>` | 0.1.0 已修（打开前会先 `sessions.refresh()`）；若出现说明装的还是旧版 |
| 子会话是空的（没有继承历史） | 宿主未提供 `sessionQuery`/`agents`；弹窗与 `branch_tree.capabilities` 都会说明 |
| fork 被拒：主线不干净 | 先提交或 stash。守卫故意的——否则 worktree/merge 会把无关改动卷进来 |
| `走向名已存在` | 换个名字，或先 `branch_drop` 掉旧走向 |
| `没有进行中的走向「X」` | 该走向已 merged/dropped，不能再拆 |
| 外部浏览器打开 `/branchman/` 是 403 | 预期行为：GUI 有 renderer 令牌栅栏，宿主网页只在 DSH 窗口内可开 |
| `pnpm add` 报代理错误 | 见方式 A 的绕过参数 |
| 想让 agent 直接开走向 | 直接说"开一条走向试 X"，它会调 `branch_fork` |

## 卸载

1. 从 `dsh.profile.bundles` 里删掉 `"dsh-branchman"`
2. 删掉 `<profile>\node_modules\dsh-branchman\`
3. 完全重启
4. 可选：删 `$DSH_HOME\branchman\tree.json`（树数据）；**已建的各条走向 worktree 与分支不会被自动清理**，
   需要的话手动 `git worktree remove` / `git branch -D`
