# 桌面验收（ACCEPTANCE）

> 本文按重构计划 §10 的验收矩阵逐行记录状态。每行只有三种结果：
> `pass` / `fail` / `unverified`。**unverified 不是 pass** —— 它明确表示该项
> 尚未在真实 Electron 桌面上执行，任何「本版本已完全验证」的结论都不得以此为依据。

## 前置事实（2026-10-02）

- 官方宿主：`@deepseek-ai/dsh-desktop@0.2.0-rc.2`（`E:\DeepSeek Harness\resources\app.asar`）。
- 本轮进程快照**未发现 DeepSeek Harness 进程** → 无法做真实桌面会话流验收。
- 已完成的验证层级：
  - **package contract / 领域行为**：`npm run test:domain`（38）+ `test:contract`（35）
    + `test:operations`（14）—— 全部 pass，但只证明纯模块与契约，不证明桌面交互。
  - **既有回归**：`node test/run.mjs`（232）—— 全部 pass，仍是旧生产代码的桩级验证。
  - **标题插件**：37 pass（含 S09 用户标题保护），真实宿主 title 服务仿真，非真实模型输出。

## 验收矩阵

| 场景 | 状态 | 证据 / 说明 |
|---|---|---|
| 从未建分支的仓库：当前对话可见，可创建第一条走向 | unverified | B02 修复为纯模块 + 契约测试；需真实桌面确认树干可见 |
| E/F 两仓库同名走向：ID 不同，操作与标签始终在正确仓库 | pass（领域层） | B01/B06 有 `test/domain/identity` + `migration` 隔离验证；桌面层 unverified |
| main/master/feature/detached HEAD：按实际源 baseOid 创建 | pass（契约层） | `git-adapter` 真 Git 单测覆盖四态；桌面 fork 未跑 |
| linked worktree、cwd 子目录、嵌套仓库：解析 common-dir | pass（契约层） | `git.test.ts` 真 Git 验证；桌面端 unverified |
| dirty tracked/untracked/CJK/binary：携带规则明确 | unverified | 现有 doFork 有实现，但未在重构后的 operations 层接真实 git carry 验收 |
| 中途副作用/磁盘写失败、宿主退出：无虚假成功，可对账 | pass（契约层） | `operations` 补偿/recovery-required 有隔离测试；真实磁盘满未注入 |
| 同 requestId 重试/并发：只创建一次 | pass（契约层） | `fork.test.ts` 幂等/409 有隔离测试 |
| disposed/归档/真实缺失：状态可区分 | pass（契约层） | `host-adapter.sessionPresence` 四态测试 |
| 空摘要/读失败/服务重新注入：租约计数相等、不重试风暴 | pass（契约层） | `host.test.ts` + `projection.test.ts` |
| 总览 list→graph、切换会话：resize/wheel 正常 | unverified | 需真实浏览器挂载 React 组件 |
| 拖动/缩放/每轮刷新：无 NaN、相机不被抢回 | pass（纯逻辑） | `camera.test.ts`；真实画布交互 unverified |
| 深浅色、中英文、键盘/焦点 | unverified | 需真实桌面主题/locale/焦点验收 |
| 用户手动标题、模型超时、归档会话 | pass（标题插件） | title-smart 37 pass（S09 用户标题不被覆盖） |
| install/prune/冷启动/回滚：自制包保留、核心流存活 | unverified | `release.py` 事务化部署有单测；真实 pnpm install/prune 未在隔离 profile 跑 |

## 结论

**本轮未达到「本版本重构完成」的门槛**。P0/P1 的领域层与契约层修复已落地并通过
隔离测试，但以下项保持 `unverified` 并阻止生产切换：

1. 真实 Electron 桌面的会话流、客户端模块加载、主题/locale/焦点；
2. 1000 session / 100 direction 的性能门槛（p95 ≤ 200ms 等）；
3. 20 次冷启动 + 2 小时交互 + 故障注入的稳定性门槛；
4. 真实 pnpm install/prune 下两个自制包的存活验证。

只有在这些项于真实桌面通过后，才允许执行停机切换并标记 release 状态为 committed。
