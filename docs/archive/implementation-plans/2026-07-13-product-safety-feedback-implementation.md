# Product Safety and Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recoverable removal, correctly scoped history refresh, settings/install safeguards, and explicit connection recovery states.

**Architecture:** Shared protocol carries request-correlated product intents; Backend owns mutation and runner guards; focused Renderer composables own transient UI state. Electron main receives only a validated runtime summary for quit protection.

**Tech Stack:** Electron, Vue 3, TypeScript, Zod, Vitest, Vue Sonner, Reka UI.

---

### Task 1: Guarded Sidebar history refresh

**Files:** `shared/protocol.ts`, `backend/client/clientMessageDispatcher.ts`, `src/composables/useHistorySync.ts`, `src/composables/useBackendEvents.ts`, `src/components/chat/Sidebar.vue`, `src/components/chat/ChatHeader.vue`, `src/lib/commandPalette.ts`, `src/App.vue`, focused tests.

- [ ] Write failing tests for Sidebar placement, command disabling, request correlation, Backend active-runner rejection, loading and result feedback.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement the request-correlated manual sync flow and remove the Header action.
- [ ] Run focused tests and typecheck.

### Task 2: Undo logical removal

**Files:** `shared/protocol.ts`, `backend/sessions/sessionIndexStore.ts`, `backend/client/conversationLifecycle.ts`, `src/composables/conversationLifecycle/visibilityActions.ts`, `src/composables/useBackendEvents.ts`, focused tests.

- [ ] Write failing protocol, Backend restore and Renderer undo tests.
- [ ] Implement unhide store operations and restore messages without touching Pi history or starting runners.
- [ ] Add an 8-second Sonner action after confirmed removal and request-correlated restore handling.
- [ ] Verify local-only, conversation and workspace undo paths.

### Task 3: Settings and installation safeguards

**Files:** `shared/protocol.ts`, `backend/settings/settingsService.ts`, `backend/client/clientMessageDispatcher.ts`, `src/composables/usePiSettings.ts`, `src/components/settings/SettingsView.vue`, `electron/appLifecycle.ts`, `electron/preload.ts`, `electron/main.ts`, focused tests.

- [ ] Write failing tests for dirty-close confirmation, combined save, discard, install confirmation and app-quit dirty state.
- [ ] Implement `settings:save_all` with validate-before-write behavior.
- [ ] Implement the settings close dialog and install confirmation dialog.
- [ ] Extend the Electron runtime summary and quit copy for unsaved settings.
- [ ] Run focused tests and typecheck.

### Task 4: Connection recovery state

**Files:** `src/lib/backendSocket.ts`, `src/composables/useAppSessionShell.ts`, `src/components/chat/ChatHeader.vue`, focused tests.

- [ ] Write failing socket transition and Header copy tests.
- [ ] Emit connecting, connected, reconnecting and offline states from the existing reconnect loop.
- [ ] Render accurate Header status without changing Backend protocol.
- [ ] Run focused tests and typecheck.

### Task 5: Documentation and release verification

**Files:** `PRODUCT.md`, `DESIGN.md`, `README.md`, `docs/E2E_ACCEPTANCE.md`.

- [ ] Document refresh scope, undo window, settings/install safeguards and connection states.
- [ ] Run `npm run verify`, `npm run build`, `npm run check:build-output`, and `npm run package:dir`.
- [ ] Run `git diff --check` and review all changes against the approved scope.
