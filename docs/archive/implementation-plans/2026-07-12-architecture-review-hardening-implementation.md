# Architecture Review Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收口 Pi RUNNER backend 事件、跨进程校验和架构守卫中的已证实风险，不改变现有四层所有权模型。

**Architecture:** Pi RPC 事件在 `backend/pi` 内部保持独立 union；只有 `PiRunnerManager` 补齐 `conversationId` 后才进入统一的 `BackendMessage` 事件总线。会话 domain schema 放在顶层 `shared`，供协议和后端共同使用；投影同步失败作为可恢复副作用被隔离。

**Tech Stack:** TypeScript 6, Vue 3, Zod 4, Vitest 4, Node SQLite。

---

### Task 1: 隔离 agent-end 投影同步异常

**Files:**
- Modify: `backend/events/agentEndSessionSync.ts`
- Test: `tests/backend/sessionSyncAfterAgentEnd.test.ts`

- [ ] **Step 1: Write the failing test**

增加异常同步用例：`syncSession` 抛出 `Error('session file disappeared')` 时，函数不抛异常，并发送带 `conversationId` 的 `pi:error`。

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run tests/backend/sessionSyncAfterAgentEnd.test.ts`

Expected: FAIL，因为当前异常会直接冒泡。

- [ ] **Step 3: Implement the minimal isolation**

把同步和刷新列表包在 `try/catch` 中；成功路径保持两个现有事件，失败路径发送错误：

```ts
try {
  const result = deps.sessions.syncSession(snapshot.sessionPath)
  deps.broadcast({ type: 'source_sessions:synced', result })
  deps.broadcast({ type: 'conversations:list', conversations: deps.sessions.listConversations() })
} catch (error) {
  deps.broadcast({
    type: 'pi:error',
    conversationId: payload.conversationId,
    message: error instanceof Error ? error.message : String(error),
  })
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/backend/sessionSyncAfterAgentEnd.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/events/agentEndSessionSync.ts tests/backend/sessionSyncAfterAgentEnd.test.ts
git commit -m "fix(events): 隔离会话投影同步失败"
```

### Task 2: 收紧 backend 公开事件类型

**Files:**
- Modify: `backend/events/bus.ts`, `backend/events/agentEndSessionSync.ts`, `backend/events/subscribers.ts`
- Modify: `backend/client/clientMessageDispatcher.ts`, `backend/client/conversationLifecycle.ts`
- Modify: `backend/pi/processRunner.ts`, `backend/pi/rpcEvents.ts`, `backend/pi/runnerManager.ts`
- Modify: `backend/settings/settingsService.ts`
- Modify: `backend/runtime/createBackendRuntime.ts`, `backend/server.ts`, `shared/protocol.ts`
- Test: `tests/architectureBoundaries.test.ts`, `tests/backend/clientMessageHandlers.test.ts`, `tests/backend/pi/runnerManager.test.ts`, `tests/backend/sessionSyncAfterAgentEnd.test.ts`

- [ ] **Step 1: Write the failing boundary assertions**

断言事件总线、dispatcher、lifecycle 和 server 使用 `BackendMessage`；事件总线不再定义 `Record<string, unknown>`；`rpcEvents.ts` 导出 `PiRpcEvent`。

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run tests/architectureBoundaries.test.ts`

Expected: FAIL，因为当前公开 callback 仍是宽泛 Record。

- [ ] **Step 3: Implement the typed event pipeline**

公开出口统一使用 `BackendMessage`，Pi RPC 解析结果改名为内部 `PiRpcEvent`。manager callback 接收 `PiRpcEvent`，通过带 `switch` 的 `attachConversationId` 返回 `BackendMessage`，禁止使用 `as BackendMessage` 绕过检查。dispatcher 的 Send 改为 `(payload: BackendMessage) => void`，settings snapshot 改为精确 `PiSettingsSnapshot`。

```ts
// backend/events/bus.ts
import type { BackendMessage } from '../../shared/protocol.js'
export type BackendEvent = BackendMessage
export type BackendEventSubscriber = (payload: BackendMessage, emit: (payload: BackendMessage) => void) => void
```

```ts
// backend/pi/runnerManager.ts
type Broadcast = (payload: BackendMessage) => void
type RunnerFactory = (broadcast: (payload: PiRpcEvent) => void, lifecycle: RunnerLifecycle) => ManagedRunner
```

- [ ] **Step 4: Verify type boundary and behavior**

Run: `npm run typecheck && npx vitest run tests/architectureBoundaries.test.ts tests/backend/clientMessageHandlers.test.ts tests/backend/pi/runnerManager.test.ts tests/backend/sessionSyncAfterAgentEnd.test.ts`

Expected: typecheck 和 focused tests PASS。

- [ ] **Step 5: Commit**

```bash
git add backend shared tests
git commit -m "refactor(protocol): 收紧 backend 事件类型边界"
```

### Task 3: 共享完整 Conversation schema

**Files:**
- Modify: `shared/chat.ts`, `shared/protocol.ts`
- Test: `tests/src/shared/protocol.test.ts`

- [ ] **Step 1: Write the failing schema tests**

覆盖合法 conversation 通过、缺少 `messages` 拒绝、消息缺少 `timestamp` 拒绝、segment 含未知字段拒绝：

```ts
const valid = { id: 'c1', title: '会话', messages: [], turns: [], sessionPath: null, createdAt: 1 }
expect(parseBackendMessage(JSON.stringify({ type: 'conversations:list', conversations: [valid] }))).toEqual({
  type: 'conversations:list', conversations: [valid],
})
expect(parseBackendMessage(JSON.stringify({ type: 'conversations:list', conversations: [{ ...valid, messages: undefined }] }))).toBeNull()
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run tests/src/shared/protocol.test.ts`

Expected: FAIL，因为当前 schema 只检查对象。

- [ ] **Step 3: Define schemas once in `shared/chat.ts`**

用 Zod strict schema 定义 `toolMetaSchema`、`chatMessageSegmentSchema`、`chatMessageSchema`、`agentTurnSchema`、`conversationSchema`，再导出 `z.infer` 类型；保留图片 MIME 限制。协议直接使用 `conversationSchema`，删除浅层 `z.custom`。

- [ ] **Step 4: Verify protocol and persistence consumers**

Run: `npm run typecheck && npx vitest run tests/src/shared/protocol.test.ts tests/backend/sessions/sessionJsonlParser.test.ts tests/backend/sessions/sessionIndexStore.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add shared tests
git commit -m "fix(protocol): 完整校验会话 domain"
```

### Task 4: 统一回合逻辑并强化架构守卫

**Files:**
- Move: `src/shared/workspaceNames.ts` -> `src/lib/workspaceNames.ts`
- Modify: `src/lib/sidebarGroups.ts`, `backend/sessions/sessionJsonlParser.ts`
- Modify/Test: `tests/architectureBoundaries.test.ts`

- [ ] **Step 1: Write the failing structural assertions**

断言 parser 从 `turnGrouping.ts` 导入 `buildAgentTurns`，sidebar 从 `@/lib/workspaceNames` 导入；架构扫描覆盖全部 backend 文件并检测本地 import 环。

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npx vitest run tests/architectureBoundaries.test.ts tests/backend/sessions/sessionJsonlParser.test.ts`

Expected: FAIL，因为 parser 重复实现且结构测试只检查硬编码文件。

- [ ] **Step 3: Remove duplication and make the guard recursive**

删除 parser 内部实现并添加 `import { buildAgentTurns } from './turnGrouping.js'`；移动 workspace helper 并更新唯一 import。架构测试递归收集 `.ts` 文件，检查所有 backend 文件不依赖 renderer，并用 DFS 检测本地 import 回环。

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/architectureBoundaries.test.ts tests/backend/sessions/sessionJsonlParser.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src backend tests
git commit -m "refactor(architecture): 统一回合逻辑并强化边界守卫"
```

### Task 5: 文档同步与全量验证

**Files:**
- Modify: `DESIGN.md`

- [ ] **Step 1: Update architecture documentation**

同步公开事件由 `BackendMessage` 约束、Pi 原始事件只存在于 `backend/pi`、Conversation 使用共享完整 schema、agent-end 同步失败只报告错误不破坏 backend。

- [ ] **Step 2: Run complete verification**

Run: `npm run verify && npm run build && npm run check:build-output`

Expected: 全部命令退出码 0。

- [ ] **Step 3: Review diff and commit documentation**

Run: `git diff --check && git status --short`；确认无 whitespace error 后执行：

```bash
git add DESIGN.md
git commit -m "docs(architecture): 同步事件与校验边界"
```
