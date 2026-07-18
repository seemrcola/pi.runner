# Pi Process Management Boundary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 Pi 进程管理收口成 `backend/pi` 的清晰模块边界，外部只依赖公开 facade 和 manager API。

**Architecture:** `backend/pi/index.ts` 作为唯一公开入口，`PiRunnerManager` 继续拥有 live process facts。底层 `PiProcessRunner` 只留在模块内部和局部单元测试中，外部 backend 服务通过 manager 的 `start / prompt / abort / getState / snapshot / list / shutdown*` 使用进程能力。

**Tech Stack:** TypeScript, Node child_process, Vitest, 现有 backend event bus/session service。

---

### Task 1: 锁定公开边界

**Files:**
- Modify: `tests/architectureBoundaries.test.ts`
- Modify: `tests/backend/pi/runnerManager.test.ts`

**Steps:**
1. 添加架构测试：`backendRuntime`、`backendEventSubscribers`、`sessionSyncAfterAgentEnd` 只能从 `./pi/index.js` 引用公开进程类型或工厂。
2. 添加架构测试：`clientMessageHandlers` 和 `conversationLifecycleService` 不能声明或使用底层 runner API，例如 `writePrompt`、`getExisting`、`deps.piRunners.get(`。
3. 添加 runner manager 行为测试：`PiRunnerManager.getState(conversationId)` 通过 manager 返回底层 runner state。
4. 运行相关测试，确认新增测试失败。

### Task 2: 增加 Pi 模块 facade

**Files:**
- Create: `backend/pi/index.ts`
- Modify: `backend/pi/runnerManager.ts`

**Steps:**
1. 新增 `createPiProcessManager()` 工厂和 `PiProcessManagementApi` 类型。
2. 给 `PiRunnerManager` 增加 `getState(conversationId)`，隐藏底层 runner state 查询。
3. 移除外部不该使用的 `getExisting`；保留内部需要的最小方法。
4. 通过 `backend/pi/index.ts` 重新导出公开 API。

### Task 3: 收口调用方

**Files:**
- Modify: `backend/backendRuntime.ts`
- Modify: `backend/clientMessageHandlers.ts`
- Modify: `backend/conversationLifecycleService.ts`
- Modify: `backend/backendEventSubscribers.ts`
- Modify: `backend/sessionSyncAfterAgentEnd.ts`
- Modify: `tests/backend/clientMessageHandlers.test.ts`
- Modify: `tests/backend/serverExtensions.test.ts`

**Steps:**
1. `backendRuntime` 使用 `createPiProcessManager()`。
2. `conversationLifecycleService` 通过 `deps.piRunners.getState(conversationId)` 查询 state。
3. client handler deps 只声明 manager 级 API。
4. 更新测试替身，移除底层 runner 形状。

### Task 4: 文档同步和验证

**Files:**
- Modify: `DESIGN.md`
- Modify: `README.md`
- Check: `PRODUCT.md`

**Steps:**
1. 更新架构图和目录说明，明确 `backend/pi/index.ts` 是进程管理公开入口。
2. 运行相关测试和完整构建。
3. 如果 `PRODUCT.md` 不涉及代码边界细节，最终说明无需更新原因。
