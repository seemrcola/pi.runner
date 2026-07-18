# Idle Runner Retention Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Pi runner 增加前后台差异化 idle 超时和最多 3 个 idle 进程的容量回收，同时保证工作中的进程永不被自动关闭。

**Architecture:** Renderer 把当前前台会话身份同步给 backend，backend 按 WebSocket client 聚合前台身份并在断线时清理；`PiRunnerManager` 作为唯一进程生命周期事实源，记录每个 runner 的 `idleSince` 并调度最近到期的回收检查。容量策略只观察 `idle` runner，超限时按 `idleSince` 从早到晚关闭；自动关闭仅释放进程和 lease，保留会话历史以便下次 prompt 透明重启。

**Tech Stack:** TypeScript、Electron、WebSocket、Vue 3、Vitest

---

### Task 1: 定义进程保留策略

**Files:**
- Modify: `shared/protocol.ts`
- Modify: `backend/pi/runnerManager.ts`
- Test: `tests/backend/pi/runnerManager.test.ts`

**Steps:**
1. 为前台身份、idle 超时、容量回收写失败测试。
2. 运行 runner manager 测试，确认因缺少 API 和行为而失败。
3. 在 manager 中记录 `idleSince`、前台会话和单一调度 timer。
4. 只在 `idle` 状态参与超时与容量回收，自动关闭时删除 runner 并释放 lease。
5. 运行 runner manager 测试并确认通过。

### Task 2: 同步前台会话身份

**Files:**
- Modify: `shared/protocol.ts`
- Modify: `backend/client/clientMessageDispatcher.ts`
- Modify: `src/composables/useAppSessionShell.ts`
- Test: `tests/backend/clientMessageHandlers.test.ts`
- Test: `tests/src/shared/protocol.test.ts`

**Steps:**
1. 为 `set_active_conversation` 协议解析和 dispatcher 转发写失败测试。
2. 运行针对性测试并确认预期失败。
3. 增加严格协议、dispatcher handler，并在 activeId 变化和连接恢复时同步。
4. 运行协议、dispatcher 和 renderer 相关测试。

### Task 3: 文档与完整验证

**Files:**
- Modify: `DESIGN.md`
- Modify: `PRODUCT.md`
- Modify: `README.md`

**Steps:**
1. 记录 runner 自动回收规则以及“关闭进程不隐藏会话”的边界。
2. 运行 `npm test`。
3. 运行 `npm run build` 和 `npm run check:build-output`。
4. 检查 git diff，确认没有无关改动。
