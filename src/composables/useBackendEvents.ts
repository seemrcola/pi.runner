import type { Ref } from 'vue'
import {
  isPiStartedForRequest,
  type BackendMessage,
  type PiRunnerSnapshot,
  type PiSettingsSnapshot,
  type WorkspaceViewState,
} from '@shared/protocol'
import type { Conversation, ImageContent } from '@shared/chat'
import {
  clearConversationRuntimeRequests,
  type ConversationRuntime,
} from '@/lib/conversationRuntime'
import type { ChatMessageMeta, MessageRole, ToolMeta } from '@shared/chat'
import { handleRunnerStateMessage } from '@/composables/backendEvents/runnerEvents'
import { handleWorkspaceViewStateMessage } from '@/composables/backendEvents/workspaceViewEvents'

type BackendEventsOptions = {
  activeId: Ref<string | null>
  conversations: Ref<Conversation[]>
  expandedWorkspaces: Ref<Set<string>>
  runtimes: Ref<Map<string, ConversationRuntime>>
  runnerSnapshots: Ref<Map<string, PiRunnerSnapshot>>
  workspaceViewStates: Ref<Map<string, WorkspaceViewState>>
  runtimeFor(conversationId: string): ConversationRuntime
  restoreConversations(conversations: Conversation[]): void
  requestConversationHistory(): void
  confirmOptimisticDelete(requestId?: string): boolean
  confirmOptimisticRestore(requestId?: string): boolean
  rejectOptimisticRestore(requestId?: string, reason?: string): boolean
  rollbackOptimisticDelete(requestId?: string, reason?: string): boolean
  sendPendingStartPrompt(conversationId: string): void
  sendPendingSteersAsFollowUp(conversationId: string, runtime: ConversationRuntime): void
  appendAssistantDelta(conversationId: string, delta: string): void
  appendThinkingDelta(conversationId: string, delta: string): void
  endThinking(conversationId: string, content?: string): void
  finalizeAssistantTurn(conversationId: string, status?: 'done' | 'error'): void
  flushNow(conversationId: string): void
  pushMessage(
    conversationId: string,
    role: MessageRole,
    text: string,
    meta?: ChatMessageMeta,
    id?: string,
    images?: ImageContent[],
  ): void
  upsertAssistantTool(
    conversationId: string,
    toolCallId: string,
    patch: Partial<ToolMeta> & { toolName?: string; status?: ToolMeta['status'] },
  ): void
  applySettingsSnapshot(snapshot: PiSettingsSnapshot): void
  handleSettingsError(message: string): void
  onRunnerList?(): void
}

export function useBackendEvents(options: BackendEventsOptions) {
  function markRuntimesDisconnected() {
    for (const runtime of options.runtimes.value.values()) {
      clearConversationRuntimeRequests(runtime)
    }
    options.runnerSnapshots.value = new Map()
  }

  function onBackendMessage(message: BackendMessage) {
    if (message.type === 'runner:list') {
      reconcileActiveTurns(message.runners)
      options.onRunnerList?.()
    }
    if (
      message.type === 'runner:snapshot'
      && (message.snapshot.phase === 'error' || message.snapshot.phase === 'exited')
    ) {
      finalizeInterruptedTurn(message.snapshot.conversationId)
    }
    if (handleWorkspaceViewStateMessage(options, message)) return
    if (handleRunnerStateMessage(options, message)) return

    switch (message.type) {
      case 'backend:ready':
        return

      case 'conversations:list':
        options.restoreConversations(message.conversations)
        return

      case 'settings:snapshot':
        options.applySettingsSnapshot(message.snapshot)
        return

      case 'settings:error':
        options.handleSettingsError(message.message)
        return

      case 'source_sessions:synced':
        return

      case 'conversation:deleted':
        options.confirmOptimisticDelete(message.requestId)
        return

      case 'workspace:deleted':
        options.confirmOptimisticDelete(message.requestId)
        options.requestConversationHistory()
        return

      case 'conversation:restored':
      case 'workspace:restored':
        options.confirmOptimisticRestore(message.requestId)
        return

      case 'pi:started':
        handlePiStarted(message)
        return

      case 'pi:agent_start':
        return

      case 'pi:text_delta':
        options.appendAssistantDelta(message.conversationId, message.delta)
        return

      case 'pi:thinking_delta':
        options.appendThinkingDelta(message.conversationId, message.delta)
        return

      case 'pi:thinking_end':
        options.endThinking(message.conversationId, message.content)
        return

      case 'pi:tool_start':
        options.upsertAssistantTool(message.conversationId, message.toolCallId, {
          toolName: message.toolName,
          status: 'running',
          args: message.args,
        })
        options.runtimeFor(message.conversationId).activeTurn?.toolStartedAt.set(message.toolCallId, Date.now())
        return

      case 'pi:tool_update':
        options.upsertAssistantTool(message.conversationId, message.toolCallId, { output: message.output })
        return

      case 'pi:tool_end':
        handleToolEnd(message)
        return

      case 'pi:message_end':
        options.flushNow(message.conversationId)
        return

      case 'pi:agent_end':
        handleAgentEnd(message)
        return

      case 'pi:response':
        handlePromptResponse(message)
        return

      case 'pi:turn_end':
        options.flushNow(message.conversationId)
        return

      case 'pi:status':
        return

      case 'pi:stderr':
        options.pushMessage(message.conversationId, 'system', message.data)
        return

      case 'pi:error':
        handlePiError(message)
        return

      case 'backend:pong':
        return
    }
  }

  function reconcileActiveTurns(runners: PiRunnerSnapshot[]) {
    const activeRunnerIds = new Set(
      runners
        .filter((snapshot) => (
          snapshot.phase === 'starting'
          || snapshot.phase === 'running'
          || snapshot.phase === 'stopping'
          || snapshot.phase === 'terminating'
          || snapshot.phase === 'termination_failed'
        ))
        .map((snapshot) => snapshot.conversationId),
    )

    for (const [conversationId, runtime] of options.runtimes.value) {
      if (!runtime.activeTurn || activeRunnerIds.has(conversationId)) continue
      finalizeInterruptedTurn(conversationId)
    }
  }

  function finalizeInterruptedTurn(conversationId: string) {
    const runtime = options.runtimes.value.get(conversationId)
    if (!runtime?.activeTurn) return
    // 断线本身不能判定任务失败；权威列表或明确失败的 terminal snapshot 才能收口本地流式状态。
    clearConversationRuntimeRequests(runtime)
    options.finalizeAssistantTurn(conversationId, 'error')
  }

  function handlePiStarted(message: Extract<BackendMessage, { type: 'pi:started' }>) {
    const runtime = options.runtimeFor(message.conversationId)
    if (!isPiStartedForRequest(message, runtime.activeStartRequest)) return
    runtime.activeStartRequest = null

    const conversation = options.conversations.value.find((item) => item.id === message.conversationId)
    if (conversation && !conversation.sessionPath) {
      conversation.sessionPath = message.sessionPath
    }
    if (conversation && message.sessionName) {
      conversation.title = message.sessionName
    }
    options.sendPendingStartPrompt(message.conversationId)
  }

  function handleToolEnd(message: Extract<BackendMessage, { type: 'pi:tool_end' }>) {
    const runtime = options.runtimeFor(message.conversationId)
    const startedAt = runtime.activeTurn?.toolStartedAt.get(message.toolCallId)
    runtime.activeTurn?.toolStartedAt.delete(message.toolCallId)
    options.upsertAssistantTool(message.conversationId, message.toolCallId, {
      status: message.isError ? 'error' : 'done',
      result: message.result,
      diff: message.diff,
      durationMs: startedAt ? Math.max(0, Date.now() - startedAt) : undefined,
    })
  }

  function handleAgentEnd(message: Extract<BackendMessage, { type: 'pi:agent_end' }>) {
    const runtime = options.runtimeFor(message.conversationId)
    if (!message.willRetry) {
      options.finalizeAssistantTurn(message.conversationId, message.error ? 'error' : 'done')
      options.sendPendingSteersAsFollowUp(message.conversationId, runtime)
    }
    if (message.error && !message.willRetry) {
      options.pushMessage(message.conversationId, 'error', message.error)
    } else if (message.willRetry) {
      options.pushMessage(message.conversationId, 'system', `正在重试：${message.error ?? '发生错误'}`)
    }
  }

  function handlePromptResponse(message: Extract<BackendMessage, { type: 'pi:response' }>) {
    const runtime = options.runtimeFor(message.conversationId)
    if (!message.success && message.id === runtime.pendingPromptId) {
      runtime.pendingPromptId = null
      options.pushMessage(message.conversationId, 'error', message.error ?? 'Pi 拒绝了本次任务')
    } else if (message.id === runtime.pendingPromptId) {
      runtime.pendingPromptId = null
    }
  }

  function handlePiError(message: Extract<BackendMessage, { type: 'pi:error' }>) {
    if (message.requestId && options.rejectOptimisticRestore(message.requestId, message.message)) return
    if (message.requestId && options.rollbackOptimisticDelete(message.requestId, safeRemovalReason(message.message))) return
    if (message.conversationId) {
      const runtime = options.runtimeFor(message.conversationId)
      runtime.pendingPromptId = null
      if (runtime.pendingStartPrompt) {
        runtime.draft = runtime.pendingStartPrompt.text
        runtime.draftImages = [...(runtime.pendingStartPrompt.images ?? [])]
        runtime.pendingStartPrompt = null
      }
      if (runtime.activeStartRequest) {
        runtime.activeStartRequest = null
      }
      options.pushMessage(message.conversationId, 'error', message.message)
    } else if (options.activeId.value) {
      options.pushMessage(options.activeId.value, 'error', message.message)
    } else {
      options.handleSettingsError(message.message)
    }
  }

  return {
    markRuntimesDisconnected,
    onBackendMessage,
  }
}

function safeRemovalReason(message: string): string | undefined {
  return message.includes('任务进行中') ? message : undefined
}
