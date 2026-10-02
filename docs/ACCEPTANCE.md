# 接手验收记录

日期：2026-10-02。最终构建与详细证据位于 `E:\codexproject\docs\superpowers\plans\dsh-takeover-evidence`。pass、fail、unverified 是不同状态；候选验证不等于正式部署。

| 项目 | 当前状态 | 证据层级 |
|---|---|---|
| 实际 index.js/client.js 已接新模块 | pass | 构建入口与官方 Electron 加载 |
| 无走向会话可见、可首次分叉 | pass | 真实桌面候选 |
| 同名跨仓库、嵌套仓库、linked worktree、detached HEAD | pass（契约层） | 真实临时 Git 与迁移测试 |
| 指定消息继承，排除之后轮次 | pass | 真实桌面，第一轮分叉排除第二轮 |
| 中文、二进制、未跟踪文件携带 | pass | 桌面产生的工作树与源文件 SHA256 相等 |
| 部分宿主创建失败后继续恢复 | pass | 真实故障保留工作树，冷启动恢复唯一子会话 |
| 同请求重试 / 并发只创建一次 | pass（实际入口层） | 操作日志、真实临时 Git、fixture 宿主 |
| 外部分支切换、未合入提交阻止错误操作 | pass（实际入口层） | 真实 Git 负向测试 |
| 冲突保留现场、处理后检查 | pass（实际入口层） | 真实 Git 冲突与 abort 后重新检查 |
| 观察租约释放、服务替换、失败退避 | pass（契约与入口层） | 计数、卸载与并发测试 |
| 列表/图形、拖动/缩放/刷新保留相机 | pass | 官方 Electron |
| 中文/英文、深浅主题 | pass | 官方 Electron 与截图 |
| Escape、焦点恢复 | pass（前一候选） | 最终构建需重新检查 |
| 用户手动标题保护 | pass（插件测试） | 真实手动标题跨冷启动继续验证 |
| v1 迁移完整保留历史、旧文件不覆盖 | pass（迁移层） | 生产数据只读 dry-run；正式运行待验证 |
| 实际 pnpm install/prune、真实代码回滚 | unverified | 最终包待运行 |
| 1000 会话 / 100 走向性能 | pass（Runtime，合成目录） | p95 报告；浏览器规模与帧时待检查 |
| 20 次冷启动 | unverified | 待最终包连续检查 |
| 最终包 2 小时交互稳定性 | unverified | 待独立记录 |
| 正式 profile 切换与实际模型验收 | unverified | 正式配置仍保留旧版本 |

发布应保持 pending-validation，直至最终包所有必需门槛通过。不得以早期候选截图、fixture 性能或通过的纯模块数量填补未验证项。
