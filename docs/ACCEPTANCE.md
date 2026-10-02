# 接手验收记录

更新：2026-10-02。正式配置 E:\tools\dsh-home\profiles\desktop 已切换并完成启动验收；发布 cb6b085d1f354146b632905af5684333 为 committed，stability=waived-by-user。用户明确要求「两小时测试我接受不了 尽快」，两小时测试未完成，不记为 pass。

## 已通过的验证

| 项目 | 结果与范围 | 证据 |
|---|---|---|
| 实际入口接入、官方客户端加载 | pass，真实正式 Electron | production-smoke.json |
| 普通会话可见、列表/关系图/刷新/Escape/焦点 | pass，正式配置 37 条记录 | production-smoke.json、production-overview.png |
| v1 历史迁移 | pass，3 条变为 3 个唯一走向，原文件 SHA256 不变 | production-smoke.json、migration-dry-run.json |
| 消息边界、中文/二进制/未跟踪文件携带 | pass，真实候选桌面及文件散列 | 会话与工作树证据、入口测试 |
| 故障恢复、幂等/并发、外部身份改变与冲突保护 | pass，真实 Git / 实际 runtime / 故障注入；部分宿主创建失败在桌面恢复 | 110 项入口及契约测试、操作日志 |
| branch_tree、branch_fork 模型工具入口 | pass，官方候选宿主接本地确定性模型 | tool-flow.json |
| 用户手动标题保护、主题、语言、键盘与相机 | pass，实际桌面和标题模块测试 | 桌面截图、37 项标题测试 |
| install/prune 与不同代码字节回滚 | pass，真实 bundled pnpm / 隔离配置，保留 v2 数据 | release-exercise.json |
| 20 次冷启动 | pass，同一最终发行包、官方候选 Electron | cold-starts.json |
| 1000 会话 / 100 走向 | pass，合成目录 runtime p95 32.85ms；官方 Electron 合成数据拖动帧 p95 6.2ms | runtime-performance.json、final-renderer-performance.json |
| 正式真实模型 | pass，新会话 DeepSeek-V41-Flash 完成并回复 OK，无工具调用 | production-smoke.json |
| 两小时稳定性 | waived-by-user，仅短时交互通过，不能代表长时稳定 | stability.json、production-acceptance.json |

110 项 branchman、37 项标题、16 项发布测试通过。旧 232 项桩测试已被实际入口测试替代，不与新测试重复计数。详细证据目录：E:\codexproject\docs\superpowers\plans\dsh-takeover-evidence。

## 发布与恢复边界

branchman 0.3.0 / title-smart 0.2.0；实现提交 961df94 / 55b5cfb。原有依赖、凭据和其他 bundle 保留。旧记录 text 缺少可信历史基点，保留 recovery-required；不伪造 Git 历史。两条旧 removed 走向仍保留历史。

旧代码实际字节及配置备份位于正式 profile 的 .dsh-release/cb6b085d1f354146b632905af5684333。正式旧包 schema 未知且已迁移生成 v2；不能盲目自动降级，需保留新状态并进行数据感知回滚。隔离回滚演练通过不等于正式降级已执行。

## 0.3.1 层级与清理补充

112 项完整测试通过；交错输入的独立主树区域与连线归属、跨仓库父引用、搜索祖先及折叠行为有新增验证。真实桌面验证了四层列表、搜索祖先和收起/展开；最终发行验收与清理清单见证据目录 tree-layout-acceptance.json / tree-cleanup-manifest.json。此前 0.3.0 的 20 次冷启动和规模数据是历史验证，不标成 0.3.1 重新执行。两小时测试仍按用户要求取消。
