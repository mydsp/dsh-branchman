# Branchman 0.3.1

DeepSeek Harness 的会话走向与 Git 工作树管理插件。把真实父子会话、独立工作树和可恢复操作放到同一个总览。

![独立主树与分支关系图](docs/overview.png)

[English](README.en.md) · [安装与升级](docs/INSTALL.md) · [验收范围](docs/ACCEPTANCE.md)

## 本次更新

- 各棵主树独立分区，子树布局按真实父子关系排列。
- 列表按层级缩进，支持展开、收起；可按仓库或主树筛选。
- 搜索与分页保留祖先；刷新保持相机，支持拖动、缩放和选中定位。
- 图形默认保持可读缩放，详情面板可以开关。

## 使用

- 侧栏底部「走向总览」始终可用，尚未创建分支的会话也会显示。
- 输入框旁创建走向会继承最新已完成轮次；从某条助手消息创建，则继承该完成轮次及之前的历史。也可从空对话开始。
- 每个走向使用 UUID、独立 `branchman/<UUID>` 分支和 `.branches/<UUID>` 工作树。名称用于显示。
- 交接说明保存在详情中，不会自动发送给模型。
- 普通未提交文件可以携带，包括中文路径和二进制；符号链接、子模块与 `.branches` 内容不携带。
- 合入、同步、移除会检查实际工作树身份。未提交改动、未合入提交或冲突会阻止对应操作。
- 中断操作保留工作树与日志，使用「继续恢复」对账；冲突处理后使用「检查工作树」。

## 安装与兼容性

已验证宿主 `@deepseek-ai/dsh-desktop@0.2.0-rc.2`；Electron 44 是运行时版本。运行依赖由宿主提供。

从本仓库 GitHub Releases 下载 `dsh-branchman-0.3.1.tgz`，在已退出桌面的实际 profile 中安装并登记 bundle，详见 [安装说明](docs/INSTALL.md)。npm 发布完成后也可使用 `dsh-branchman@0.3.1`。

v1 数据迁移为独立 `tree-v2.json`，保留原 `tree.json`。旧记录缺少可信基点时会标记需要恢复；降级需同时考虑状态版本。

## 开发

```sh
npm ci
npm test
npm run build
npm pack --ignore-scripts
```

TypeScript 和 esbuild 随开发依赖安装；可通过 `DSH_BUILD_TOOLS` 使用已有共享工具目录。发布包包含已构建的宿主和客户端入口，不需要使用者构建。

CLI `scripts/branchman.ps1` 通过宿主 API 工作，要求显式提供 `-BaseUrl`，写操作通过 `-BodyFile` 提交；不会绕过操作日志。实现说明见 [架构](docs/ARCHITECTURE.md) 与 [宿主合同](docs/CONFORMANCE.md)。
