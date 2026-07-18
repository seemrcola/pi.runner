# Architecture Product Review Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolve the architecture and product review findings until the project passes a follow-up architecture/product audit.

**Architecture:** Keep the current MVP model: Pi owns JSONL history, SQLite owns desktop projection, `PiRunnerManager` owns live process facts, and Vue owns interaction state. The changes tighten those boundaries by reducing renderer orchestration surface area, making backend runtime wiring explicit, isolating session leases, and simplifying first-run/new-conversation interactions.

**Tech Stack:** Electron, Vue 3, TypeScript, Vite, Vitest, Node SQLite, WebSocket, Tailwind CSS.

---

## Review/Fix Loop

Each round follows:

1. Review current risk against the previous findings.
2. Write or adjust failing tests before production code.
3. Implement the smallest structural change that closes the finding.
4. Run targeted tests.
5. Run full verification after all tasks in the round.
6. Re-review architecture, code style, product clarity, and removable code.

## Task 1: Backend Runtime Wiring

**Files:**
- Modify: `backend/server.ts`
- Create if useful: `backend/backendRuntime.ts`
- Test: `tests/backend/serverExtensions.test.ts` or new focused backend runtime test

**Step 1: Write the failing test**

Add a test that proves backend runtime construction does not rely on a subscriber closure reading an uninitialized `PiRunnerManager`. The desired shape is a factory that receives constructed dependencies in explicit order.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/backend/serverExtensions.test.ts`

Expected: FAIL because the runtime factory/module does not exist yet or `server.ts` still owns the temporal coupling.

**Step 3: Implement minimal runtime wiring**

Extract backend dependency construction so `PiRunnerManager` is initialized before event subscribers are created. Keep `server.ts` as the transport entry and avoid changing protocol behavior.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/backend/serverExtensions.test.ts`

Expected: PASS.

## Task 2: Session Lease Registry

**Files:**
- Modify: `backend/pi/runnerManager.ts`
- Create: `backend/pi/sessionLeaseRegistry.ts`
- Test: `tests/backend/pi/runnerManager.test.ts`

**Step 1: Write the failing test**

Add a test or source-boundary assertion showing session ownership is delegated to a named lease registry instead of being embedded as a raw `Map` in `PiRunnerManager`.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/backend/pi/runnerManager.test.ts`

Expected: FAIL until the registry exists and manager uses it.

**Step 3: Implement minimal lease registry**

Create `SessionLeaseRegistry` with `ownerOf()`, `claim()`, `release()`, and `clear()`. Keep path normalization behavior unchanged.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/backend/pi/runnerManager.test.ts`

Expected: PASS.

## Task 3: Renderer Workspace View State Boundary

**Files:**
- Modify: `src/composables/useAppSessionShell.ts`
- Create: `src/composables/useWorkspaceViewState.ts`
- Test: `tests/src/lib/conversationLifecycle.test.ts` or new `tests/src/workspaceViewState.test.ts`

**Step 1: Write the failing test**

Add a test that exercises optimistic workspace view state updates through a dedicated composable API and verifies normalized path, pinned timestamp, collapsed state, and backend message payload.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/src/workspaceViewState.test.ts`

Expected: FAIL because the composable does not exist yet.

**Step 3: Implement minimal composable**

Move `workspaceViewStates` and `updateWorkspaceViewState()` logic out of `useAppSessionShell.ts`. Keep the shell as dependency composition only.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/src/workspaceViewState.test.ts`

Expected: PASS.

## Task 4: Renderer Backend Event Split

**Files:**
- Modify: `src/composables/useBackendEvents.ts`
- Create if useful: `src/composables/backendEvents/workspaceViewEvents.ts`, `src/composables/backendEvents/messageStreamEvents.ts`
- Test: `tests/src/lib/conversationMessages.test.ts`, `tests/src/sidebarWorkspaceExpansion.test.ts`, `tests/src/lib/backendSocket.test.ts`

**Step 1: Write the failing boundary test**

Extend `tests/architectureBoundaries.test.ts` to assert backend event reducer delegates workspace view state handling to a named helper instead of keeping that logic inline.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/architectureBoundaries.test.ts`

Expected: FAIL until the helper is extracted.

**Step 3: Implement minimal split**

Extract workspace view state event handling first. Only split more if the follow-up review still flags `useBackendEvents.ts` as too broad.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/architectureBoundaries.test.ts`

Expected: PASS.

## Task 5: Product Entry Clarity

**Files:**
- Modify: `src/App.vue`
- Modify: `src/components/chat/Sidebar.vue`
- Test: `tests/src/sessionOnlyWorkspace.test.ts`, `tests/src/layoutOverflow.test.ts`, `tests/src/noSlashCommands.test.ts`

**Step 1: Write failing tests**

Update tests to require:
- Empty state exposes direct "普通会话" and "选择工作区" actions.
- New conversation dialog uses action language: "在工作区开始" and "开始普通会话".
- Sidebar uses "会话" consistently instead of mixing "对话".

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/src/sessionOnlyWorkspace.test.ts tests/src/layoutOverflow.test.ts`

Expected: FAIL until labels/actions change.

**Step 3: Implement product copy and empty-state actions**

Keep the UI compact. Do not add onboarding prose or marketing sections.

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/src/sessionOnlyWorkspace.test.ts tests/src/layoutOverflow.test.ts`

Expected: PASS.

## Task 6: Removable Code and Dependency Cleanup

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Delete confirmed unused public assets
- Test: `npm run build`, `npm test`

**Step 1: Confirm references**

Run a repository search for the suspected unused assets and script helpers, excluding `node_modules`, `dist`, and lockfiles.

Expected: Only package metadata or no production references.

**Step 2: Remove confirmed unused items**

Remove unused dev dependencies and static assets only if no source/test/doc references need them.

**Step 3: Verify lockfile**

Run: `npm install --package-lock-only`

Expected: lockfile updates without changing source behavior.

## Task 7: Documentation Sync

**Files:**
- Modify: `DESIGN.md`
- Modify: `PRODUCT.md` if product behavior wording changes
- Modify: `README.md` if runtime structure or commands change

**Step 1: Review docs after code changes**

Check whether new composable/backend runtime boundaries are reflected in `DESIGN.md` and `README.md`.

**Step 2: Update docs**

Write concise Chinese documentation for changed architecture boundaries and product entry behavior.

## Final Verification

Run:

```bash
npm test
npm run build
node /Users/zhukai/.agents/skills/impeccable/scripts/detect.mjs --json src
rg -n "TODO|FIXME|HACK|deprecated|legacy|兼容|临时|@ts-ignore|@ts-expect-error" backend src shared electron tests README.md DESIGN.md PRODUCT.md package.json
rg -n "icons\\.svg|app-icon-256|concurrently|cross-env|wait-on" backend src shared electron tests README.md DESIGN.md PRODUCT.md package.json
```

Expected:
- Tests pass.
- Build passes.
- Detector either reports clean findings or the known local missing bundled detector error is recorded.
- No new temporary architecture notes remain.
- No confirmed unused references remain.
