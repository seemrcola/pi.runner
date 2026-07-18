# Multitask Conversations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build true multitask conversation mode so each conversation owns its draft, PI runtime, streaming state, and commands independently.

**Architecture:** Replace current global active-conversation runtime with per-conversation runtime state on the renderer and per-conversation `PiProcessRunner` instances on the backend. Every PI command and every PI event must carry `conversationId`, so switching the visible conversation never changes where a running task writes output.

**Tech Stack:** Vue 3 refs/computed state in `src/App.vue`, TypeScript shared protocol in `src/shared/protocol.ts`, Node WebSocket backend in `backend/server.ts`, Vitest tests.

---

## Product And UX Contract

Each sidebar conversation is a task instance, not just a message list. A task instance owns:

- Draft text.
- Managed `sessionPath`.
- Workspace/cwd.
- PI process lifecycle: `idle`, `starting`, `running`, `error`.
- Assistant streaming buffer and thinking state.
- Tool call state.
- Pending prompt and RPC request ids.

Expected UX:

- Typing in conversation A, switching to B, and returning to A preserves A's draft.
- Conversation B never inherits A's draft.
- If A is running and the user switches to B, A keeps running in the background.
- Stream/tool/error events from A continue writing to A, even while B is active.
- B can start and send independently while A is running.
- The input send button is disabled only when the active conversation is starting/running, not when some other conversation is running.
- Stop/reload/clone acts on the active conversation only.
- Sidebar should indicate which conversations are running or starting.

## Data Model

Introduce a renderer-only runtime model:

```ts
type ConversationRuntimeStatus = 'idle' | 'starting' | 'running' | 'error'

type ConversationRuntime = {
  draft: string
  status: ConversationRuntimeStatus
  error?: string
  activeAssistantId: string | null
  streamingThinking: string
  pendingPromptId: string | null
  activeStartRequest: StartRequestRef | null
  activeCloneRequest: CloneRequestRef | null
  pendingBuffer: string
  rafId: number | null
  toolStartedAt: Map<string, number>
  thinkingActive: boolean
}
```

Store as:

```ts
const runtimes = ref(new Map<string, ConversationRuntime>())
```

Access through:

```ts
function runtimeFor(conversationId: string): ConversationRuntime
function activeRuntime(): ConversationRuntime | null
```

Do not add this runtime object to persisted `Conversation`; it is UI/process state.

## Protocol Contract

Modify `src/shared/protocol.ts` so every PI runtime command targets a conversation:

```ts
| { type: 'prompt'; conversationId: string; id?: string; prompt?: string }
| { type: 'rpc_command'; conversationId: string; id?: string; command?: Record<string, unknown> }
| { type: 'restart_pi'; conversationId: string }
| { type: 'abort'; conversationId: string; id?: string }
```

Modify backend PI event types to include `conversationId`:

```ts
| { type: 'pi:text_delta'; conversationId: string; delta: string }
| { type: 'pi:thinking_delta'; conversationId: string; delta: string }
| { type: 'pi:tool_start'; conversationId: string; toolName: string; toolCallId: string; args?: unknown }
```

Apply the same field to all runtime-specific `pi:*` events: `started`, `restarted`, `message_end`, `agent_end`, `response`, `stderr`, `error`, `turn_end`, `status`.

Global events remain without `conversationId`: `backend:ready`, `conversations:list`, `commands:list`, extension management, source session scans.

## Backend Architecture

Create `backend/pi/runnerManager.ts`.

Responsibilities:

- Maintain `Map<string, PiProcessRunner>`.
- Create one runner per `conversationId`.
- Wrap each runner broadcast so emitted payloads include `conversationId`.
- Route `start`, `prompt`, `rpc_command`, `clone_session`, `restart_pi`, `abort`.
- Shut down all runners on process exit.
- Optionally remove idle runners when conversations are deleted.

Sketch:

```ts
export class PiRunnerManager {
  private runners = new Map<string, PiProcessRunner>()

  constructor(private readonly broadcast: Broadcast) {}

  get(conversationId: string): PiProcessRunner {
    let runner = this.runners.get(conversationId)
    if (!runner) {
      runner = new PiProcessRunner((payload) => this.broadcast({ ...payload, conversationId }))
      this.runners.set(conversationId, runner)
    }
    return runner
  }

  hasRunning(conversationId: string): boolean {
    return this.runners.get(conversationId)?.isRunning() ?? false
  }

  shutdownConversation(conversationId: string): void {
    this.runners.get(conversationId)?.shutdown()
    this.runners.delete(conversationId)
  }

  shutdownAll(): void {
    for (const runner of this.runners.values()) runner.shutdown()
    this.runners.clear()
  }
}
```

Replace global `piRunner` in `backend/server.ts` with `piRunners`.

## Implementation Tasks

### Task 1: Add Protocol Tests For Conversation Routing

**Files:**

- Modify: `src/shared/protocol.test.ts`
- Modify: `src/shared/protocol.ts`

**Step 1: Write failing protocol tests**

Add tests that assert:

- `prompt` requires `conversationId`.
- `rpc_command` requires `conversationId`.
- `restart_pi` requires `conversationId`.
- `abort` requires `conversationId`.
- runtime `pi:*` event types include `conversationId`.

Use type-level tests by assigning valid message objects with `conversationId`. This repo currently uses source-inspection tests, so also add source checks that `protocol.ts` contains the new fields.

**Step 2: Run tests**

Run:

```bash
npm test -- src/shared/protocol.test.ts
```

Expected: FAIL until protocol is updated.

**Step 3: Update protocol**

Modify `src/shared/protocol.ts` with the fields listed in "Protocol Contract".

**Step 4: Verify**

Run:

```bash
npm test -- src/shared/protocol.test.ts
```

Expected: PASS.

### Task 2: Add Backend Runner Manager

**Files:**

- Create: `backend/pi/runnerManager.ts`
- Create: `backend/pi/runnerManager.test.ts`
- Modify: `backend/pi/processRunner.ts` only if needed for testability.

**Step 1: Write failing tests**

Test:

- `get('a')` and `get('b')` return different runner objects.
- repeated `get('a')` returns the same object.
- broadcasts from runner A are wrapped with `conversationId: 'a'`.
- `shutdownConversation('a')` shuts down only A.
- `shutdownAll()` shuts down all.

If direct `PiProcessRunner` construction is hard to observe, inject a runner factory:

```ts
type RunnerFactory = (broadcast: Broadcast) => Pick<PiProcessRunner, 'isRunning' | 'shutdown'>
```

Keep production default as `new PiProcessRunner(broadcast)`.

**Step 2: Run tests**

```bash
npm test -- backend/pi/runnerManager.test.ts
```

Expected: FAIL because file does not exist.

**Step 3: Implement manager**

Implement the class described in "Backend Architecture".

**Step 4: Verify**

```bash
npm test -- backend/pi/runnerManager.test.ts
```

Expected: PASS.

### Task 3: Route Backend Commands By Conversation

**Files:**

- Modify: `backend/server.ts`
- Modify: `backend/serverExtensions.test.ts`

**Step 1: Write failing source tests**

Update backend source tests to assert:

- server imports `PiRunnerManager`.
- server does not instantiate `new PiProcessRunner(broadcast)` directly.
- `prompt`, `rpc_command`, `restart_pi`, `abort`, and `clone_session` read `message.conversationId`.
- command handlers use `piRunners.get(conversationId)`.

**Step 2: Run tests**

```bash
npm test -- backend/serverExtensions.test.ts
```

Expected: FAIL.

**Step 3: Modify server**

- Replace `const piRunner = new PiProcessRunner(broadcast)` with `const piRunners = new PiRunnerManager(broadcast)`.
- In `handleStartMessage`, call `piRunners.get(conversationId).start(...)`.
- In `prompt`, validate `conversationId`, get that runner, check `runner.isRunning()`, write prompt.
- In `rpc_command`, validate `conversationId`, get that runner, run command.
- In `clone_session`, validate `conversationId`, get that runner, clone.
- In `restart_pi`, validate `conversationId`, get that runner, restart.
- In `abort`, validate `conversationId`, get that runner, abort.
- In `delete_conversation`, if a conversation id is available later, shut down its runner. If only `sessionPath` is available now, defer runner cleanup to a later task.
- In `shutdown()`, call `piRunners.shutdownAll()`.

**Step 4: Verify**

```bash
npm test -- backend/serverExtensions.test.ts backend/pi/runnerManager.test.ts
```

Expected: PASS.

### Task 4: Add Frontend Runtime State Helpers

**Files:**

- Modify: `src/App.vue`
- Create: `src/appMultitaskRuntime.test.ts`

**Step 1: Write failing source tests**

Assert `App.vue` contains:

- `runtimes = ref(new Map<string, ConversationRuntime>())`.
- `runtimeFor(conversationId`.
- no global `const input = ref('')`.
- no global `const isRunning = ref(false)`.
- no global `const isStarting = ref(false)`.
- `MessageInput` binds to active runtime draft.

**Step 2: Run tests**

```bash
npm test -- src/appMultitaskRuntime.test.ts
```

Expected: FAIL.

**Step 3: Implement runtime helpers**

In `src/App.vue`:

- Replace global `input`, `isRunning`, `isStarting`, `activeAssistantId`, `streamingThinking`, `pendingPromptId`, `activeStartRequest`, `activeCloneRequest`, `toolStartedAt`, `thinkingActive`, `pendingBuffer`, `rafId` with per-conversation runtime.
- Add computed:

```ts
const activeRuntimeState = computed(() =>
  activeId.value ? runtimeFor(activeId.value) : null,
)
const activeDraft = computed({
  get: () => activeRuntimeState.value?.draft ?? '',
  set: (value) => {
    if (activeRuntimeState.value) activeRuntimeState.value.draft = value
  },
})
const activeIsRunning = computed(() => activeRuntimeState.value?.status === 'running')
const activeIsStarting = computed(() => activeRuntimeState.value?.status === 'starting')
```

- Bind `MessageInput` to `activeDraft`, `activeIsRunning`, `activeIsStarting`.
- When creating/restoring/switching conversations, call `runtimeFor(id)` but do not reset other conversations' runtimes.

**Step 4: Verify**

```bash
npm test -- src/appMultitaskRuntime.test.ts
```

Expected: PASS.

### Task 5: Route Frontend Sends And Commands By Conversation

**Files:**

- Modify: `src/App.vue`
- Modify: `src/appCommands.test.ts`

**Step 1: Write failing tests**

Assert:

- `sendMessage()` captures `const conversationId = activeConversation.value?.id`.
- prompt payload includes `conversationId`.
- `rpc_command`, `clone_session`, `restart_pi`, and `abort` payloads include `conversationId`.
- send clears only `runtime.draft`.
- send sets only that runtime's `status = 'running'`.

**Step 2: Run tests**

```bash
npm test -- src/appCommands.test.ts src/appMultitaskRuntime.test.ts
```

Expected: FAIL.

**Step 3: Modify send/command functions**

- `sendMessage()` must capture `conversationId` before any async/event work.
- `routeSlashCommand(text, conversationId)` should receive an explicit target id.
- `cancelPi()` should send `{ type: 'abort', conversationId }`.
- `startPi(conversationId)` should start the requested conversation, not always `activeConversation`.
- `/reload` sends `{ type: 'restart_pi', conversationId }`.

**Step 4: Verify**

```bash
npm test -- src/appCommands.test.ts src/appMultitaskRuntime.test.ts
```

Expected: PASS.

### Task 6: Route Frontend Runtime Events By Conversation

**Files:**

- Modify: `src/App.vue`
- Create: `src/appEventRouting.test.ts`

**Step 1: Write failing tests**

Source-test that:

- `handleBackendMessage` checks `message.conversationId` for all runtime `pi:*` cases.
- `appendAssistantDelta` accepts `conversationId`.
- `pushMessage` accepts `conversationId`.
- `upsertToolMessage` accepts `conversationId`.
- event handlers do not call these helpers without a target conversation id.

**Step 2: Run tests**

```bash
npm test -- src/appEventRouting.test.ts
```

Expected: FAIL.

**Step 3: Modify event handlers**

Change helpers:

```ts
function conversationById(conversationId: string): Conversation | null
function pushMessage(conversationId: string, role: MessageRole, text: string): void
function appendAssistantDelta(conversationId: string, delta: string): void
function upsertToolMessage(conversationId: string, toolCallId: string, patch: ...): void
function flushNow(conversationId: string): void
function scheduleFlush(conversationId: string): void
```

For scroll behavior:

- Only call `scrollToBottom()` if `conversationId === activeId.value`.
- Background conversations update silently.

For request matching:

- `pi:started` matches `runtime.activeStartRequest`.
- `session:cloned` matches `runtime.activeCloneRequest`.
- `pi:response` compares `runtime.pendingPromptId`.

**Step 4: Verify**

```bash
npm test -- src/appEventRouting.test.ts src/appMultitaskRuntime.test.ts
```

Expected: PASS.

### Task 7: Make Conversation Switching Non-Destructive

**Files:**

- Modify: `src/App.vue`
- Modify: `src/components/chat/Sidebar.vue` if adding running indicators.
- Create: `src/appConversationSwitching.test.ts`

**Step 1: Write failing tests**

Assert:

- `switchConversation` does not call `resetStreamingState()`.
- `switchConversation` does not restart PI for every switch if that conversation already has a running or starting runner.
- `switchConversation` calls `runtimeFor(id)`.
- `restoreConversations` creates runtimes without wiping existing runtime drafts.

**Step 2: Run tests**

```bash
npm test -- src/appConversationSwitching.test.ts
```

Expected: FAIL.

**Step 3: Modify switching**

- Remove global reset on switch.
- Flush only the previous active conversation before switching.
- Start a runner for a conversation only when needed:
  - conversation has no `sessionPath`, or
  - runtime status is `idle`/`error` and user explicitly sends/starts.
- Prefer lazy start on first send rather than starting every conversation on selection, if PI supports start-before-prompt reliably. If not, keep start-on-create but never restart an already running conversation.

**Step 4: Verify**

```bash
npm test -- src/appConversationSwitching.test.ts src/appEventRouting.test.ts
```

Expected: PASS.

### Task 8: Add Sidebar Runtime Indicators

**Files:**

- Modify: `src/App.vue`
- Modify: `src/components/chat/Sidebar.vue`
- Modify: `src/layoutOverflow.test.ts` or create `src/sidebarRuntimeStatus.test.ts`

**Step 1: Write failing tests**

Assert Sidebar accepts a runtime-status map or helper prop, and renders status markers for `starting`, `running`, and `error`.

**Step 2: Run tests**

```bash
npm test -- src/sidebarRuntimeStatus.test.ts
```

Expected: FAIL.

**Step 3: Implement UI**

- Pass a compact status map from App:

```ts
const conversationStatuses = computed(() =>
  Object.fromEntries([...runtimes.value].map(([id, runtime]) => [id, runtime.status])),
)
```

- In Sidebar, show a subtle status dot or spinner beside each conversation title.
- Do not add explanatory in-app text. Use `title` attributes for hover labels.

**Step 4: Verify**

```bash
npm test -- src/sidebarRuntimeStatus.test.ts src/layoutOverflow.test.ts
```

Expected: PASS.

### Task 9: Full Verification

**Files:**

- No new files unless fixing discovered issues.

**Step 1: Run unit/source tests**

```bash
npm test
```

Expected: all tests pass.

**Step 2: Run type/build verification**

```bash
npm run build
```

Expected: build completes.

**Step 3: Manual scenario**

Run the app, then verify:

1. Open conversation A.
2. Type `你好` but do not send.
3. Open conversation B.
4. Confirm B input is empty.
5. Type/send `你好` in B.
6. Confirm B receives a response.
7. While B is responding, switch to A.
8. Confirm A draft still says `你好`.
9. Send A.
10. Confirm A receives its own response.
11. Confirm B's response did not append to A, and A's response did not append to B.

**Step 4: Check process behavior**

Confirm backend can run two PI tasks concurrently or at least keeps independent runners. If PI itself rejects concurrent sessions due external constraints, surface a per-conversation error instead of silently hanging.

## Migration Notes

- Existing managed session files remain valid; runtime state is ephemeral and not persisted.
- Existing conversation ids from imported history are still the routing key.
- New local conversations using `conv-${seq}` are acceptable short term, but a future improvement should use UUIDs to avoid collisions after history reloads.
- `commands:list` is currently runtime-dependent because backend queries the active PI runner. In multitask mode, prefer one of:
  - keep fallback command list global, or
  - request commands for the active conversation with `conversationId`.
  Start with fallback/global to avoid expanding scope.

## Risks

- Running many PI processes may consume resources. Add a later policy for max concurrent runners, idle shutdown, and visible queued state.
- Broadcast events must be carefully wrapped; one missing `conversationId` can reintroduce cross-talk.
- Source-inspection tests are brittle but match current repo style. Add behavioral tests when the app has testable composables extracted from `App.vue`.

