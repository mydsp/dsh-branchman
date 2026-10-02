# 官方宿主契约与验证层级

参考对象是本机官方 ASAR 中的 `@deepseek-ai/dsh-desktop@0.2.0-rc.2`；声明跨版本兼容前应重新确认以下接口。

| 能力 | 使用的契约 | 关键约束 |
|---|---|---|
| 会话目录 | sessionQuery.listSessions().header | 保留没有方向的会话 |
| 观察 | observeSession + Symbol.dispose | 不能泄漏 prepared/live 租约 |
| 标题 | readTitleSnapshots().value.title.source | 用户标题不筛掉、不被模型覆盖 |
| 分叉 | dsh-session/fork 的 buildForkSeed | 包含选定完成边界及 end-seed |
| 创建 agent | agents.create + agentPresets.mount | setup 必须返回 void/transaction，不能返回 Cordis fiber |
| 模型选择 | agentDefaultModel.currentSelection | 有 provider/model 才创建可运行子会话 |
| 工作区 | workspaceRegistry.create + attachSession | 操作成功后客户端刷新目录再打开 |
| 工具 | defineTool output.schema + render | 真实宿主注册，而非只检查描述数组 |
| 客户端 | ModuleLoader + 宿主 React | 不自行打包 React 或执行字符串代码 |
| 当前会话 | catalogue.byId.retainedBy.mainView | 不假定有 snapshot.current |
| Locale | register({zh,en}) + subscribe | active 为 zh；只写 zh-CN 会回退英文 |
| UI | footer action / composer dock / assistant actions / overlay | 新会话首页也能进入总览 |

## 证据分层

- 领域与契约测试：状态、排序、图、焦点外的纯逻辑等；不是桌面结果。
- 实际入口测试：加载根 index.js/client.js，真实临时 Git 与磁盘，宿主服务仍有明确 fixture。
- 官方 Electron 验收：独立 DSH_HOME，官方宿主和真实 UI，本地模型代替外部模型服务。
- 规模性能：1000 session / 100 direction 的合成目录；不能宣称真实千会话磁盘读性能。
- 正式配置切换：独立于上述验证，必须有单独发布与真实配置验收记录。

旧 `PLUGIN-NOTES.md` 保留为早期调查参考，不作为当前实现或新版兼容结论。
