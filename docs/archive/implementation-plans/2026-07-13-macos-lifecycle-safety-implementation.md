# macOS Lifecycle Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent active-task removal and keep Pi RUNNER resident after its macOS window closes.

**Architecture:** Renderer projects backend runner snapshots into removal availability and sends only a narrow task-count summary to Electron main. Backend independently rejects active removals. Electron main owns window, Tray, and explicit-quit behavior through testable lifecycle policy helpers.

**Tech Stack:** Electron, Vue 3, TypeScript, Vitest, Reka UI.

---

### Task 1: Renderer removal guard

**Files:** `src/components/chat/ConversationListItem.vue`, `src/components/chat/Sidebar.vue`, `src/composables/conversationLifecycle/visibilityActions.ts`, `tests/src/layoutOverflow.test.ts`, `tests/src/lib/conversationLifecycle.test.ts`

- [ ] Add failing tests proving active conversation and workspace removal controls are disabled.
- [ ] Add failing lifecycle tests proving direct active removal sends no backend message and preserves projection state.
- [ ] Run the focused tests and confirm failures are caused by missing guards.
- [ ] Implement status-derived disabled labels and entry-point guards without adding a new state store.
- [ ] Run focused tests and confirm they pass.

### Task 2: Backend removal guard

**Files:** `backend/client/conversationLifecycle.ts`, `tests/backend/clientMessageHandlers.test.ts`

- [ ] Add failing tests for `starting`, `running`, and `stopping` conversation/workspace removal requests.
- [ ] Assert rejection returns `pi:error` with the original `requestId` and performs no hide or shutdown call.
- [ ] Implement snapshot/list based backend guards before any lifecycle mutation.
- [ ] Verify active rejection and idle removal paths together.

### Task 3: macOS resident lifecycle

**Files:** `electron/appLifecycle.ts`, `electron/main.ts`, `electron/preload.ts`, `src/types/piDesktop.d.ts`, `src/composables/useAppSessionShell.ts`, `tests/electron/appLifecycle.test.ts`, `tests/electron/mainLifecycle.test.ts`

- [ ] Add failing policy tests for task summaries and quit confirmation content.
- [ ] Add failing source contract tests for close-to-hide, Tray creation, show action, explicit quit, and runtime-status IPC.
- [ ] Implement pure menu/quit policy helpers in `appLifecycle.ts`.
- [ ] Keep the main window alive when closed, restore it from Dock/Tray, and stop backend only during explicit application quit.
- [ ] Sync `{ known, activeTaskCount }` from backend-derived renderer state through preload IPC.
- [ ] Guard repeated quit requests and allow system shutdown to proceed.
- [ ] Run Electron and renderer focused tests.

### Task 4: Product boundary and release verification

**Files:** `PRODUCT.md`, `DESIGN.md`, `README.md`, `docs/E2E_ACCEPTANCE.md`

- [ ] State macOS-only and Apple Silicon delivery boundaries consistently.
- [ ] Document removal guards, menu-bar residency, task-state ownership, and quit confirmation behavior.
- [ ] Extend E2E checks for active removal, close-to-hide, restore, Tray summary, and explicit quit.
- [ ] Run `npm run verify`, `npm run build`, `npm run check:build-output`, and `npm run package:dir`.
- [ ] Run `git diff --check` and inspect the final diff for unrelated changes.
