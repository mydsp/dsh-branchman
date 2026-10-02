# 本机安装、验证与恢复

当前验证宿主：`@deepseek-ai/dsh-desktop@0.2.0-rc.2`。不能用 Electron 版本作为 DSH 版本。其他宿主版本需重新验证以下服务契约。

## 校验包（不替换 profile）

```powershell
pwsh -File E:\dsh-branchman\scripts\deploy-local.ps1 -ValidateOnly
```

该脚本会构建真实入口、从仓库根打包、读取 npm 返回的真实文件名并校验，然后删除本次临时 tar。可从任意 cwd 执行。

## 候选配置安装

先退出 DSH，包括由它启动的宿主进程。通过 `E:\tools\dsh-tools\release.py deploy` 指定候选 `--profile-dir` 与一个或多个 `--artifact`，两插件应一起发布。工具保留校验过的不可变 tar，为候选运行真实 pnpm install，然后替换包与注册信息。不要手动覆盖 node_modules 中的四个文件。

独立 `DSH_HOME`、Electron user-data 与测试仓库应位于 `E:\tools`；不得复制真实凭据到候选环境。使用本地测试模型验证 UI 和会话流，随后再验证实际模型行为。

正式路径目前是 `E:\tools\dsh-home\profiles\desktop`；本次验收路径是 `E:\tools\dsh-candidate-v2\profiles\desktop`。不能把候选通过当成正式已切换。

## 回滚与中断恢复

```powershell
python E:\tools\dsh-tools\release.py rollback --profile-dir <profile目录> --release-id <32位ID>
python E:\tools\dsh-tools\release.py recover --profile-dir <profile目录> --release-id <32位ID>
```

rollback 用于 pending-validation/committed 发布；recover 用于 prepared/switching/packages-replaced/recovery-required 中断记录。所有备份 manifest 与实际包字节在触碰当前配置前校验。配置被用户修改、备份损坏或不兼容旧 schema 遇到新状态写入时会拒绝自动回滚。

`.dsh-release/<ID>/record.json` 是发布记录，backup 是真实恢复来源。不得仅保留哈希而删除需要回滚的包。当前操作 journals 与 v2 数据不随代码回滚删除。

## 静态诊断与最终验收

`dsh-doctor.py --profile-dir <目录> --doctor-json` 只报告包注册、导出与字节一致性，宿主装配和交互保持独立状态。

`finalize` 要求同一个 releaseId 的验收报告对 coldStart、clientLoaded、coreSessionFlow、installPrune、rollback、performance、stability 全部为 pass。未完成项目不能以数量多的单测替代。

## CLI

`scripts/branchman.ps1 -Action tree -BaseUrl <本机宿主URL>`；写操作通过 `-BodyFile` 提供 JSON。认证链接只用于建立 cookie，不应写入公开日志。脚本验证 protocolVersion/schemaVersion，操作非 succeeded 时退出码为 1。CLI 不直接更改 Git 或 JSON 状态。
