# Request Architecture Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade Pi RUNNER from MVP request handling to a stable multi-conversation request architecture with scoped failures, per-conversation operation gates, stale response handling, and backend reconnect/restart recovery.

**Architecture:** Keep the current Vue/Electron/WebSocket shape, but introduce small focused coordination layers instead of rewriting the app. Renderer request state lives in composables/lib modules, backend process recovery lives in Electron main, and protocol validation remains in `src/shared/protocol.ts`.

**Tech Stack:** Vue 3, TypeScript, Electron, WebSocket, Vitest.

---

### Task 1: Renderer Request Coordinator

**Files:**
- Create: `src/lib/requestCoordinator.ts`
- Test: `tests/src/lib/requestCoordinator.test.ts`

**Steps:**
1. Write failing tests for per-conversation operation gates:
   - `start` cannot begin while `start` is pending.
   - `restart` cancels/replaces stale `start`.
   - `prompt` is rejected until the runtime is ready.
   - stale request ids are ignored.
2. Implement a small coordinator API:
   - `createRequestCoordinator()`
   - `beginOperation(conversationId, operation, requestId)`
   - `completeOperation(conversationId, operation, requestId)`
   - `failOperation(conversationId, operation, requestId, error)`
   - `isCurrent(conversationId, operation, requestId)`
   - `canSendPrompt(conversationId)`
3. Run: `npm test -- tests/src/lib/requestCoordinator.test.ts`

### Task 2: App Runtime Integration

**Files:**
- Modify: `src/lib/conversationRuntime.ts`
- Modify: `src/App.vue`
- Test: `tests/src/appMultitaskRuntime.test.ts`
- Test: `tests/src/lib/conversationRuntime.test.ts`

**Steps:**
1. Add failing tests for stale `pi:started` / `session:cloned` / `pi:response` events not mutating current state.
2. Extend runtime state only as needed for operation requests.
3. Route `startPi`, `routeSlashCommand`, and backend message handlers through the coordinator.
4. Preserve current UI behavior and conversation switching behavior.
5. Run targeted frontend runtime tests.

### Task 3: Backend Scoped Error Responses

**Files:**
- Modify: `src/shared/protocol.ts`
- Modify: `backend/clientMessageHandlers.ts`
- Test: `tests/backend/clientMessageHandlers.test.ts`
- Test: `tests/src/shared/protocol.test.ts`

**Steps:**
1. Add failing tests for scoped `clone_session`, `restart_pi`, and `start` failures.
2. Ensure runtime request failures return either `pi:response` or `pi:error` with `conversationId` and request id when the protocol shape has one.
3. Keep invalid client messages rejected before handlers run.
4. Run targeted backend protocol tests.

### Task 4: WebSocket Reconnect and Backend Process Recovery

**Files:**
- Create: `src/lib/backendSocket.ts`
- Modify: `src/App.vue`
- Modify: `electron/main.ts`
- Test: `tests/src/lib/backendSocket.test.ts`

**Steps:**
1. Add failing tests for reconnect delay/backoff decisions in a pure helper.
2. Move renderer WebSocket lifecycle into `backendSocket`.
3. On close, mark runtimes disconnected, schedule reconnect, and reload conversations after reconnect.
4. In Electron main, restart backend process after unexpected exit while the app is alive.
5. Keep intentional quit/window-close shutdown behavior unchanged.

### Task 5: App.vue Thin Slice Refactor

**Files:**
- Create: `src/composables/useConversationRuntimeStore.ts`
- Create: `src/composables/useBackendActions.ts`
- Modify: `src/App.vue`
- Test: existing frontend tests

**Steps:**
1. Extract runtime lookup/status helpers without changing behavior.
2. Extract socket send actions into a composable that accepts a typed `send` function.
3. Keep template props/events stable.
4. Run full tests after each extraction.

### Task 6: Final Verification

**Commands:**
- `npm test`
- `npm run build`
- `git diff --check`

**Acceptance:**
- Full test suite passes.
- Production build passes.
- No unrelated user changes reverted.
- `App.vue` no longer owns raw WebSocket lifecycle and request gating directly.
- Request failures are conversation-scoped.
- Stale lifecycle responses do not overwrite current runtime state.
