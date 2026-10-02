# Branchman 0.3.1

DeepSeek Harness 的工作树与会话走向管理插件。当前入口由 `src/host/runtime.ts` 和 `src/client/entry.ts` 构建；新模块已连接真实宿主和客户端。

## 使用

- 侧栏底部的「走向总览」始终可用，未创建走向的会话也会显示。
- 在输入框旁创建走向，继承源会话最新已完成轮次；从某条助手消息创建，则只继承该消息所在已完成轮次及此前事件。
- 可以选择空对话；未完成轮次或找不到的消息边界会报错。
- 每个走向使用独立 UUID、`branchman/<UUID>` 分支和 `.branches/<UUID>` 工作树。名称仅用于显示。
- 交接说明保存在走向详情中，不自动提交给模型。
- 未提交的普通文件可携带，包括中文路径和二进制文件；符号链接、子模块与 `.branches` 内容不携带。
- 总览按真实父子关系分组：列表缩进并可折叠；关系图为每棵主树分配独立区域，可按仓库或主树筛选。搜索/分页保留祖先，默认图形保持可读缩放；可展开详情或定位选中。手动标题优先显示。
- 合入、同步、移除需要确认。工作树身份改变、未提交改动、未合入提交或冲突会阻止危险操作。
- 部分完成的分叉保留工作树与日志，使用「继续恢复」对账。Git 冲突需在工作树处理后「检查工作树」。

## 本机验证范围

已在官方 `@deepseek-ai/dsh-desktop@0.2.0-rc.2`、Electron 44 的隔离配置中运行真实桌面会话流。正式配置已于 2026-10-02 切换并通过真实模型简短回复验收。复杂工具流使用本地确定性模型验收；两小时稳定性测试按用户明确要求取消，记录为 waived-by-user。

完整状态见 [验收记录](docs/ACCEPTANCE.md)，安装与回滚见 [INSTALL](docs/INSTALL.md)，实现边界见 [ARCHITECTURE](docs/ARCHITECTURE.md)。

## 开发

```powershell
npm ci
npm test
npm run build
npm pack --ignore-scripts
```

构建使用 TypeScript 和 `E:\tools\dsh-build-tools` 中的 esbuild；可通过 `DSH_BUILD_TOOLS` 指定已有构建工具目录。运行依赖由宿主提供，不内置 React 或复制宿主核心服务。

`npm test` 会重新构建实际入口，覆盖领域、契约、持久化、恢复、真实临时 Git 仓库和浏览器加载协议；测试数量与真实桌面验收分别记录。

PowerShell CLI 通过同一个版本化宿主 API 操作，要求显式提供本机 `-BaseUrl`；不直接修改插件状态或绕过操作日志。
