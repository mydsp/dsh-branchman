# 安装、升级与恢复

已验证宿主 `@deepseek-ai/dsh-desktop@0.2.0-rc.2`。请先确认桌面实际使用的 `DSH_HOME` 与 `profiles/desktop`，然后退出桌面及其宿主进程。升级前备份 profile 配置和 branchman 状态。

## 从 GitHub 发行包安装

1. 下载本仓库 Releases 的 `dsh-branchman-0.3.1.tgz`。
2. 在桌面实际 profile 目录，用该 profile 现有的包管理器安装。以下以 pnpm 为例（可使用桌面自带的 pnpm）：

```powershell
# 把此路径替换为本机实际的 profile 目录
$profileDir = "<DSH_HOME>/profiles/desktop"
Set-Location -LiteralPath $profileDir
pnpm add --save-exact --ignore-scripts "<下载路径>/dsh-branchman-0.3.1.tgz"
```

3. 确认 profile 的 package.json 中，`dsh.profile.bundles` 数组包含 `dsh-branchman`，保留其他已有 bundle。可以在 profile 目录执行以下 Node 命令：

```powershell
node -e 'const fs=require("node:fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));p.dsh??={};p.dsh.profile??={};const b=p.dsh.profile.bundles??=[];if(!Array.isArray(b))throw Error("bundles must be an array");if(!b.includes("dsh-branchman"))b.push("dsh-branchman");p.dsh.profile.bundles=b;fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n");'
```

4. 重启桌面，确认侧栏底部出现「走向总览」，检查已有会话及列表/关系图。

仅安装 tar 不会完成 bundle 登记。不要运行中的手工覆盖部分入口文件。安装或启动失败时退出桌面，以备份恢复 profile 配置、lockfile 与完整依赖目录。

## npm 安装

npm 版本可用后，第二步可改为 `pnpm add --save-exact --ignore-scripts dsh-branchman@0.3.1`，仍需登记 bundle。

## v1 到 v2

首次启动从原 `branchman/tree.json` 迁移到独立 `branchman/tree-v2.json`，原文件保留。旧数据无法证明历史基点时显示恢复状态。恢复旧代码前必须确认能读取当前状态；不能删除新状态并重新迁移来假装回滚。

## 维护者本机发行工具

`scripts/deploy-local.ps1` 是维护者环境的事务部署入口，依赖另行提供的 `dsh-tools/release.py`；不属于上述普通使用者安装要求。它校验 tar、登记依赖/bundle、运行 pnpm，再整组替换并保留实际旧字节。`rollback/recover` 先检查备份完整性与数据兼容性。未完成桌面验收保持 pending-validation；长期测试若由本机用户明确取消，必须记录 waived-by-user 与授权，不记为 pass。

## CLI

`scripts/branchman.ps1 -Action tree -BaseUrl <本机宿主URL>`。写操作通过 `-BodyFile` 提供 JSON；认证链接只用于建立 cookie，不写入公开日志。CLI 验证协议版本并使用同一个宿主 API，不直接更改 Git 或 JSON 状态。
