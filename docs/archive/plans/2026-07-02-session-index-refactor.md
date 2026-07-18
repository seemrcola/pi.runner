# Session Index Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace managed copied sessions with a SQLite-backed index built from Pi's real `~/.pi/agent/sessions` JSONL files.

**Architecture:** Pi session JSONL files are the only source of truth. The backend scans and parses that source tree into a local SQLite index under the project runtime data directory, and the frontend sidebar reads conversations from that index. New runtime sessions are created under the Pi sessions root so Pi remains the only writer of session JSONL.

**Tech Stack:** TypeScript, Node `fs`, Node `sqlite` `DatabaseSync`, Vitest.

---

### Task 1: Add Session Index Store

**Files:**
- Create: `backend/sessions/sessionIndexStore.ts`
- Test: `tests/backend/sessions/sessionIndexStore.test.ts`

**Steps:**
1. Write failing tests for indexing Pi source files into SQLite, listing newest-first conversations, skipping unchanged files, and removing indexed rows whose source files disappeared.
2. Run `npm test -- tests/backend/sessions/sessionIndexStore.test.ts` and verify the tests fail because the store does not exist.
3. Implement the minimal scanner/parser/index store.
4. Run the focused test and make it pass.

### Task 2: Replace Importer/Catalog Dispatcher Flow

**Files:**
- Modify: `backend/clientMessageHandlers.ts`
- Modify: `backend/server.ts`
- Modify: `backend/sessions/sessionStore.ts`
- Modify: `src/shared/protocol.ts`
- Test: `tests/backend/clientMessageHandlers.test.ts`
- Test: `tests/backend/serverExtensions.test.ts`
- Test: `tests/src/shared/protocol.test.ts`

**Steps:**
1. Write failing tests that `sync_source_sessions` indexes source sessions and refreshes `conversations:list`, while delete only shuts down runtime/UI state.
2. Run focused tests and verify protocol/handler failures.
3. Replace `piSessionImporter`/catalog dependencies with `sessionIndex`.
4. Make `SessionStore` create new Pi session paths under source sessions root without writing files.
5. Run focused tests.

### Task 3: Simplify Frontend Sync State

**Files:**
- Modify: `src/App.vue`
- Modify: `src/components/chat/ChatHeader.vue` if labels need adjustment
- Test: existing App/header tests

**Steps:**
1. Update frontend to send `sync_source_sessions` instead of scan/import split.
2. Remove source session import state from UI runtime.
3. Run relevant frontend tests.

### Task 4: Remove Obsolete Managed Import Code

**Files:**
- Delete: `backend/sessions/piSessionImporter.ts`
- Delete: `backend/sessions/sessionCatalogStore.ts`
- Delete obsolete tests for importer/catalog.
- Modify docs and `.gitignore`.

**Steps:**
1. Remove old managed copy/catalog files and update references.
2. Update `DESIGN.md` and `README.md`.
3. Run full `npm test` and `npm run build`.
