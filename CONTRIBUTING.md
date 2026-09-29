# 贡献指南

## 开发循环

```powershell
node --check index.js            # 宿主半边
node --check client.js           # 浏览器半边
npm test                         # 全部 140 项断言
pwsh -File scripts\deploy-local.ps1   # 推到 profile
# → 完全退出 DSH（含托盘）再启动，插件改动不热重载
```

**没有热重载这件事是这里最大的坑**：改了代码没生效，先确认是不是没重启，再怀疑代码。

## 测试

```powershell
npm test
```

- 零依赖，不需要 `npm install`
- 四个套件各自独立进程；`test/.tmp/` 是它们的临时仓，跑完自动清理
- 环境变量：
  - `GIT_PATH` —— 指定 git 可执行文件（默认走 PATH）
  - `DSH_APP_MODULES` —— 指向 DSH 的 `resources/app/node_modules`，
    用于校验 `dsh.client.inject` 里声明的包真实存在。不设时该项报 `SKIP`（CI 上就是这样）

**写回归测试的规矩**：写完以后把修复**临时还原**一次，确认测试确实会红。
不会红的测试等于没有——本项目第一版并发写测试在旧代码下照样通过，毫无价值。

**桩要按真实 API 形状搭**：如果桩"贴心"地提供了宿主并不存在的方法，这个 bug 就永远不会被测出来
（真实案例：`agents` 服务上并没有 `presetForObservation`）。

## 三条铁律（破了会导致整个插件被回滚）

1. `exports["./client"]` 必须是字符串
2. `dsh.client` 的 id 必须等于包名
3. 改完必须完全重启才能验证

`node test/manifest.mjs` 会按宿主的校验规则离线预检这三条。

## 代码约定

- **零运行时依赖**：只用 node 内置 + 宿主裸 `@deepseek-ai/*` 导入
- **UI 文案用中文**（产品语言），**新增代码注释用英文**（历史注释中英混排，逐步收敛）
- **失败必须给一句可操作的话**：明确说"什么建好了、什么没成、你接下来点哪里"，
  禁止静默降级（本项目所有难查的 bug 都源自静默降级）
- 树数据只存元数据，**永不存消息正文**
- 可选宿主服务一律 `ctx.inject`，绝不直接读 `ctx.x`

## 提交 PR

- [ ] `npm test` 全绿
- [ ] 没引入密钥、本机绝对路径（`E:\`、`C:\Users\…`）、个人仓库地址
- [ ] `CHANGELOG.md` 的 `Unreleased` 段写清楚改了什么、为什么
- [ ] 涉及宿主 API 的新发现，补进 `docs/PLUGIN-NOTES.md`（那是本项目最值钱的部分）

## 发布到 npm（维护者）

包名 `dsh-branchman`（未占用）。发布前先自检：

```powershell
npm test                                  # 140 项
npm pack --dry-run                        # 核对白名单：应为 20 个文件、无临时产物
```

发布命令要多带一个 `--userconfig`：本机全局 `~/.npmrc` 把 proxy 指到一个**当前未监听的
本地端口**（VPN 未连接），npm 会一律 `ECONNREFUSED`。用一个不含代理的隔离配置即可，
不要去禁用全局那份：

```powershell
# 一次性：建隔离配置并登录（浏览器/OTP 由本人完成）
npm login --userconfig="$HOME\.npmrc-npmjs"

# 每次发布
npm publish --userconfig="$HOME\.npmrc-npmjs"

# 核验
npm view dsh-branchman version
```

> 若没有 npm 账号：`npm adduser --userconfig="$HOME\.npmrc-npmjs"`（或先在 npmjs.com 注册并验证邮箱）。
> 发布后记得同步更新 README 的安装方式与 `CHANGELOG.md`。

## 报 bug

请带上：插件版本、DSH 版本、`$DSH_HOME` 下对应的宿主日志片段（`branchman:` 开头的行）、
以及 `branch_tree` 输出的 `capabilities` 字段。
