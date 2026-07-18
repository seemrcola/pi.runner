import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useBackendEvents } from '../../../src/composables/useBackendEvents'
import { createConversationRuntime } from '../../../src/lib/conversationRuntime'
import type { Conversation } from '../../../shared/chat'
import type { PiRunnerSnapshot, WorkspaceViewState } from '../../../shared/protocol'

describe('backend event handling', () => {
  it('reconciles stale active turns only after the authoritative runner list arrives', () => {
    const staleRuntime = createConversationRuntime()
    staleRuntime.pendingPromptId = 'stale-prompt'
    staleRuntime.activeTurn = {
      agentTurnId: 'stale-turn',
      messageId: 'stale-message',
      textBuffer: 'partial',
      thinkingActive: true,
      toolStartedAt: new Map(),
      startedAt: 1,
    }
    const liveRuntime = createConversationRuntime()
    liveRuntime.pendingPromptId = 'live-prompt'
    liveRuntime.activeTurn = {
      agentTurnId: 'live-turn',
      messageId: 'live-message',
      textBuffer: 'continuing',
      thinkingActive: false,
      toolStartedAt: new Map(),
      startedAt: 2,
    }
    const runtimes = ref(new Map([
      ['stale', staleRuntime],
      ['live', liveRuntime],
    ]))
    const finalizeAssistantTurn = vi.fn((conversationId: string) => {
      runtimes.value.get(conversationId)!.activeTurn = null
    })
    const runnerSnapshots = ref(new Map<string, PiRunnerSnapshot>([
      ['stale', {
        conversationId: 'stale',
        phase: 'running',
        createdAt: 1,
        lastActiveAt: 2,
      }],
    ]))
    const events = useBackendEvents({
      activeId: ref('stale'),
      conversations: ref<Conversation[]>([]),
      expandedWorkspaces: ref(new Set<string>()),
      runtimes,
      runnerSnapshots,
      workspaceViewStates: ref(new Map<string, WorkspaceViewState>()),
      runtimeFor: (conversationId) => runtimes.value.get(conversationId)!,
      restoreConversations: vi.fn(),
      requestConversationHistory: vi.fn(),
      confirmOptimisticDelete: () => false,
      confirmOptimisticRestore: () => false,
      rejectOptimisticRestore: () => false,
      rollbackOptimisticDelete: () => false,
      sendPendingStartPrompt: vi.fn(),
      sendPendingSteersAsFollowUp: vi.fn(),
      appendAssistantDelta: vi.fn(),
      appendThinkingDelta: vi.fn(),
      endThinking: vi.fn(),
      finalizeAssistantTurn,
      flushNow: vi.fn(),
      pushMessage: vi.fn(),
      upsertAssistantTool: vi.fn(),
      applySettingsSnapshot: vi.fn(),
      handleSettingsError: vi.fn(),
    })

    events.markRuntimesDisconnected()

    expect(finalizeAssistantTurn).not.toHaveBeenCalled()
    expect(staleRuntime.activeTurn).not.toBeNull()
    expect(liveRuntime.activeTurn).not.toBeNull()
    expect(runnerSnapshots.value).toEqual(new Map())

    events.onBackendMessage({
      type: 'runner:list',
      runners: [{
        conversationId: 'live',
        phase: 'running',
        createdAt: 1,
        lastActiveAt: 3,
      }],
    })

    expect(finalizeAssistantTurn).toHaveBeenCalledOnce()
    expect(finalizeAssistantTurn).toHaveBeenCalledWith('stale', 'error')
    expect(staleRuntime.activeTurn).toBeNull()
    expect(liveRuntime.activeTurn).not.toBeNull()

    events.onBackendMessage({
      type: 'runner:snapshot',
      snapshot: {
        conversationId: 'live',
        phase: 'idle',
        createdAt: 1,
        lastActiveAt: 4,
      },
    })
    expect(finalizeAssistantTurn).toHaveBeenCalledOnce()
    expect(liveRuntime.activeTurn).not.toBeNull()

    events.onBackendMessage({
      type: 'runner:snapshot',
      snapshot: {
        conversationId: 'live',
        phase: 'exited',
        createdAt: 1,
        lastActiveAt: 5,
      },
    })

    expect(finalizeAssistantTurn).toHaveBeenCalledTimes(2)
    expect(finalizeAssistantTurn).toHaveBeenLastCalledWith('live', 'error')
    expect(liveRuntime.activeTurn).toBeNull()
  })

  it('keeps an auto-sent follow-up after restoring the completed turn projection', () => {
    const conversationId = 'conv-1'
    const runtime = createConversationRuntime()
    const visibleMessages: string[] = ['streaming turn']
    const events = useBackendEvents({
      activeId: ref(conversationId),
      conversations: ref<Conversation[]>([]),
      expandedWorkspaces: ref(new Set<string>()),
      runtimes: ref(new Map([[conversationId, runtime]])),
      runnerSnapshots: ref(new Map<string, PiRunnerSnapshot>()),
      workspaceViewStates: ref(new Map<string, WorkspaceViewState>()),
      runtimeFor: () => runtime,
      restoreConversations: () => visibleMessages.splice(0, visibleMessages.length, 'persisted completed turn'),
      requestConversationHistory: vi.fn(),
      confirmOptimisticDelete: () => false,
      confirmOptimisticRestore: () => false,
      rejectOptimisticRestore: () => false,
      rollbackOptimisticDelete: () => false,
      sendPendingStartPrompt: vi.fn(),
      sendPendingSteersAsFollowUp: () => visibleMessages.push('queued follow-up'),
      appendAssistantDelta: vi.fn(),
      appendThinkingDelta: vi.fn(),
      endThinking: vi.fn(),
      finalizeAssistantTurn: vi.fn(),
      flushNow: vi.fn(),
      pushMessage: vi.fn(),
      upsertAssistantTool: vi.fn(),
      applySettingsSnapshot: vi.fn(),
      handleSettingsError: vi.fn(),
    })

    events.onBackendMessage({ type: 'conversations:list', conversations: [] })
    events.onBackendMessage({ type: 'pi:agent_end', conversationId })

    expect(visibleMessages).toEqual(['persisted completed turn', 'queued follow-up'])
  })

  it('restores pending start prompt images when pi startup fails', () => {
    const conversationId = 'conv-1'
    const runtime = createConversationRuntime()
    runtime.pendingStartPrompt = {
      id: 'prompt-1',
      text: 'describe this',
      images: [{ type: 'image', data: 'abc123', mimeType: 'image/png' }],
    }
    runtime.activeStartRequest = { requestId: 'start-1', conversationId }
    const runtimes = ref(new Map([[conversationId, runtime]]))
    const messages: Array<{ role: string; text: string }> = []

    const events = useBackendEvents({
      activeId: ref(conversationId),
      conversations: ref<Conversation[]>([]),
      expandedWorkspaces: ref(new Set<string>()),
      runtimes,
      runnerSnapshots: ref(new Map<string, PiRunnerSnapshot>()),
      workspaceViewStates: ref(new Map<string, WorkspaceViewState>()),
      runtimeFor: () => runtime,
      restoreConversations: vi.fn(),
      requestConversationHistory: vi.fn(),
      confirmOptimisticDelete: () => false,
      confirmOptimisticRestore: () => false,
      rejectOptimisticRestore: () => false,
      rollbackOptimisticDelete: () => false,
      sendPendingStartPrompt: vi.fn(),
      sendPendingSteersAsFollowUp: vi.fn(),
      appendAssistantDelta: vi.fn(),
      appendThinkingDelta: vi.fn(),
      endThinking: vi.fn(),
      finalizeAssistantTurn: vi.fn(),
      flushNow: vi.fn(),
      pushMessage: (_conversationId, role, text) => messages.push({ role, text }),
      upsertAssistantTool: vi.fn(),
      applySettingsSnapshot: vi.fn(),
      handleSettingsError: vi.fn(),
    })

    events.onBackendMessage({
      type: 'pi:error',
      conversationId,
      message: 'start failed',
    })

    expect(runtime.draft).toBe('describe this')
    expect(runtime.draftImages).toEqual([{ type: 'image', data: 'abc123', mimeType: 'image/png' }])
    expect(runtime.pendingStartPrompt).toBeNull()
    expect(runtime.activeStartRequest).toBeNull()
    expect(messages).toEqual([{ role: 'error', text: 'start failed' }])
  })

  it('passes active-task removal rejection copy into optimistic rollback', () => {
    const rollbackOptimisticDelete = vi.fn(() => true)
    const runtime = createConversationRuntime()
    const events = useBackendEvents({
      activeId: ref('conv-1'),
      conversations: ref<Conversation[]>([]),
      expandedWorkspaces: ref(new Set<string>()),
      runtimes: ref(new Map([['conv-1', runtime]])),
      runnerSnapshots: ref(new Map<string, PiRunnerSnapshot>()),
      workspaceViewStates: ref(new Map<string, WorkspaceViewState>()),
      runtimeFor: () => runtime,
      restoreConversations: vi.fn(),
      requestConversationHistory: vi.fn(),
      confirmOptimisticDelete: () => false,
      confirmOptimisticRestore: () => false,
      rejectOptimisticRestore: () => false,
      rollbackOptimisticDelete,
      sendPendingStartPrompt: vi.fn(),
      sendPendingSteersAsFollowUp: vi.fn(),
      appendAssistantDelta: vi.fn(),
      appendThinkingDelta: vi.fn(),
      endThinking: vi.fn(),
      finalizeAssistantTurn: vi.fn(),
      flushNow: vi.fn(),
      pushMessage: vi.fn(),
      upsertAssistantTool: vi.fn(),
      applySettingsSnapshot: vi.fn(),
      handleSettingsError: vi.fn(),
    })

    events.onBackendMessage({
      type: 'pi:error',
      requestId: 'delete-1',
      message: '任务进行中，停止后才能移除',
    })

    expect(rollbackOptimisticDelete).toHaveBeenCalledWith('delete-1', '任务进行中，停止后才能移除')
  })

  it('routes a failed undo back to the optimistic restore instead of chat', () => {
    const rejectOptimisticRestore = vi.fn(() => true)
    const pushMessage = vi.fn()
    const runtime = createConversationRuntime()
    const events = useBackendEvents({
      activeId: ref('conv-1'),
      conversations: ref<Conversation[]>([]),
      expandedWorkspaces: ref(new Set<string>()),
      runtimes: ref(new Map([['conv-1', runtime]])),
      runnerSnapshots: ref(new Map<string, PiRunnerSnapshot>()),
      workspaceViewStates: ref(new Map<string, WorkspaceViewState>()),
      runtimeFor: () => runtime,
      restoreConversations: vi.fn(),
      requestConversationHistory: vi.fn(),
      confirmOptimisticDelete: () => false,
      confirmOptimisticRestore: () => false,
      rejectOptimisticRestore,
      rollbackOptimisticDelete: () => false,
      sendPendingStartPrompt: vi.fn(),
      sendPendingSteersAsFollowUp: vi.fn(),
      appendAssistantDelta: vi.fn(),
      appendThinkingDelta: vi.fn(),
      endThinking: vi.fn(),
      finalizeAssistantTurn: vi.fn(),
      flushNow: vi.fn(),
      pushMessage,
      upsertAssistantTool: vi.fn(),
      applySettingsSnapshot: vi.fn(),
      handleSettingsError: vi.fn(),
    })

    events.onBackendMessage({ type: 'pi:error', requestId: 'restore-1', message: 'database busy' })

    expect(rejectOptimisticRestore).toHaveBeenCalledWith('restore-1', 'database busy')
    expect(pushMessage).not.toHaveBeenCalled()
  })
})
