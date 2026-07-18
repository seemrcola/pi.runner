import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useConversationLifecycle } from '../../../src/composables/useConversationLifecycle'
import { createConversationRuntime, type ConversationRuntime } from '../../../src/lib/conversationRuntime'
import type { ClientMessage, PiRunnerSnapshot } from '../../../shared/protocol'
import type { Conversation } from '../../../shared/chat'

function setupLifecycle(
  initialConversations: Conversation[] = [],
  options: { sendResult?: boolean; isConnected?: boolean } = {},
) {
  const conversations = ref<Conversation[]>(initialConversations)
  const activeId = ref<string | null>(initialConversations[0]?.id ?? null)
  const expandedWorkspaces = ref(new Set<string>())
  const runtimes = ref(new Map<string, ConversationRuntime>())
  const showAddDialog = ref(false)
  const defaultWorkspacePath = ref('/tmp/default-workspace')
  const homePath = ref('/Users/example')
  const isConnected = ref(options.isConnected ?? true)
  const runnerSnapshots = ref(new Map<string, PiRunnerSnapshot>())
  const sent: ClientMessage[] = []
  const notifications: Array<{
    type: 'success' | 'error'
    message: string
    action?: { label: string; onClick(): void }
    duration?: number
  }> = []
  const pushed: Array<{
    conversationId: string
    role: string
    text: string
    images?: Array<{ type: 'image'; data: string; mimeType: string }>
  }> = []
  const forceScrollToBottom = vi.fn()
  const inputFocus = vi.fn()

  function runtimeFor(conversationId: string): ConversationRuntime {
    const existing = runtimes.value.get(conversationId)
    if (existing) return existing
    const runtime = createConversationRuntime()
    runtimes.value.set(conversationId, runtime)
    return runtime
  }

  const finalizeAssistantTurn = vi.fn((conversationId: string, status: 'done' | 'error' = 'done') => {
    const runtime = runtimeFor(conversationId)
    const message = runtime.activeTurn
      ? conversations.value
          .find((conversation) => conversation.id === conversationId)
          ?.messages.find((item) => item.id === runtime.activeTurn?.messageId)
      : undefined
    if (message?.role === 'assistant') message.status = status
    runtime.activeTurn = null
  })

  const lifecycle = useConversationLifecycle({
    conversations,
    activeId,
    expandedWorkspaces,
    runtimes,
    showAddDialog,
    defaultWorkspacePath,
    homePath,
    isConnected,
    inputRef: ref({ focus: inputFocus }),
    runtimeFor,
    runnerSnapshotFor: (conversationId) => runnerSnapshots.value.get(conversationId),
    conversationById: (conversationId) => conversations.value.find((item) => item.id === conversationId) ?? null,
    flushNow: vi.fn(),
    finalizeAssistantTurn,
    pushMessage: (conversationId, role, text, _meta, id = `pushed-${pushed.length + 1}`, images) => {
      pushed.push({ conversationId, role, text, ...(images?.length ? { images } : {}) })
      const conversation = conversations.value.find((item) => item.id === conversationId)
      if (conversation) {
        conversation.messages.push({
          id,
          role,
          text,
          ...(images?.length ? { images } : {}),
          timestamp: Date.now(),
        })
        if (role === 'user') conversation.turns.push({ id, messageIds: [id] })
        else conversation.turns[conversation.turns.length - 1]?.messageIds.push(id)
      }
    },
    forceScrollToBottom,
    notify: {
      success: (message, options) => notifications.push({ type: 'success', message, ...options }),
      error: (message) => notifications.push({ type: 'error', message }),
    },
    sendClientMessage: (message) => {
      sent.push(message)
      return options.sendResult ?? true
    },
  })

  return {
    activeId,
    conversations,
    expandedWorkspaces,
    finalizeAssistantTurn,
    forceScrollToBottom,
    inputFocus,
    lifecycle,
    notifications,
    pushed,
    runtimes,
    runnerSnapshots,
    runtimeFor,
    sent,
    showAddDialog,
  }
}

describe('conversation lifecycle behavior', () => {
  it('does not create a local draft conversation while the backend is disconnected', () => {
    const { activeId, conversations, lifecycle, showAddDialog } = setupLifecycle([], { isConnected: false })
    showAddDialog.value = true

    lifecycle.startSessionOnly()

    expect(showAddDialog.value).toBe(true)
    expect(conversations.value).toEqual([])
    expect(activeId.value).toBeNull()
  })

  it('creates local draft conversations without starting pi', () => {
    const { activeId, conversations, lifecycle, sent, showAddDialog } = setupLifecycle()
    showAddDialog.value = true

    lifecycle.startSessionOnly()

    expect(showAddDialog.value).toBe(false)
    expect(conversations.value).toHaveLength(1)
    expect(activeId.value).toBe(conversations.value[0].id)
    expect(conversations.value[0]).toMatchObject({
      title: '新会话',
      sessionPath: null,
      kind: 'session',
    })
    expect(sent).toEqual([])
  })

  it('restores and switches history without starting pi', () => {
    const first = conversation('c1', 'First')
    const second = conversation('c2', 'Second', '/tmp/project')
    const { activeId, lifecycle, sent } = setupLifecycle([first])

    lifecycle.restoreConversations([first, second])
    lifecycle.switchConversation('c2')

    expect(activeId.value).toBe('c2')
    expect(sent).toEqual([])
  })

  it('starts pi before sending the first prompt for an unstarted conversation', () => {
    const { conversations, lifecycle, runtimeFor, sent } = setupLifecycle()
    lifecycle.startSessionOnly()
    const conversationId = conversations.value[0].id
    runtimeFor(conversationId).draft = 'hello pi'

    lifecycle.sendMessage()

    expect(sent).toEqual([
      expect.objectContaining({
        type: 'start',
        conversationId,
        mode: 'session',
        cwd: '/Users/example',
      }),
    ])
    expect(runtimeFor(conversationId).pendingStartPrompt).toMatchObject({
      text: 'hello pi',
    })
    expect(runtimeFor(conversationId).draft).toBe('')
  })

  it('sends a pending start prompt after pi has started', () => {
    const { conversations, lifecycle, pushed, runnerSnapshots, runtimeFor, sent } = setupLifecycle()
    lifecycle.startSessionOnly()
    const conversationId = conversations.value[0].id
    const runtime = runtimeFor(conversationId)
    runtime.pendingStartPrompt = { id: 'prompt-1', text: 'after start' }
    runnerSnapshots.value.set(conversationId, runnerSnapshot(conversationId, 'idle'))

    lifecycle.sendPendingStartPrompt(conversationId)

    expect(sent).toEqual([
      {
        type: 'prompt',
        conversationId,
        id: 'prompt-1',
        prompt: 'after start',
      },
    ])
    expect(runtime.pendingStartPrompt).toBeNull()
    expect(runtime.pendingPromptId).toBe('prompt-1')
    expect(pushed).toEqual([{ conversationId, role: 'user', text: 'after start' }])
  })

  it('restores pending start prompt images when sending after start fails', () => {
    const { conversations, lifecycle, pushed, runtimeFor, sent } = setupLifecycle([], { sendResult: false })
    lifecycle.startSessionOnly()
    const conversationId = conversations.value[0].id
    const runtime = runtimeFor(conversationId)
    runtime.pendingStartPrompt = {
      id: 'prompt-1',
      text: 'after start',
      images: [{ type: 'image', data: 'abc123', mimeType: 'image/png' }],
    }

    lifecycle.sendPendingStartPrompt(conversationId)

    expect(sent).toEqual([
      {
        type: 'prompt',
        conversationId,
        id: 'prompt-1',
        prompt: 'after start',
        images: [{ type: 'image', data: 'abc123', mimeType: 'image/png' }],
      },
    ])
    expect(runtime.pendingStartPrompt).toBeNull()
    expect(runtime.draft).toBe('after start')
    expect(runtime.draftImages).toEqual([{ type: 'image', data: 'abc123', mimeType: 'image/png' }])
    expect(pushed).toEqual([{ conversationId, role: 'error', text: '后端连接已断开' }])
  })

  it('clears the draft after sending a prompt to a ready conversation', () => {
    const { conversations, lifecycle, pushed, runnerSnapshots, runtimeFor, sent } = setupLifecycle()
    lifecycle.startSessionOnly()
    const conversationId = conversations.value[0].id
    const runtime = runtimeFor(conversationId)
    runnerSnapshots.value.set(conversationId, runnerSnapshot(conversationId, 'idle'))
    runtime.draft = 'second prompt'

    lifecycle.sendMessage()

    expect(sent).toEqual([
      expect.objectContaining({
        type: 'prompt',
        conversationId,
        prompt: 'second prompt',
      }),
    ])
    expect(runtime.draft).toBe('')
    expect(pushed).toEqual([{ conversationId, role: 'user', text: 'second prompt' }])
  })

  it('sends attached images with a ready conversation prompt', () => {
    const { conversations, lifecycle, pushed, runnerSnapshots, runtimeFor, sent } = setupLifecycle()
    lifecycle.startSessionOnly()
    const conversationId = conversations.value[0].id
    const runtime = runtimeFor(conversationId)
    runnerSnapshots.value.set(conversationId, runnerSnapshot(conversationId, 'idle'))
    runtime.draft = 'describe this'
    runtime.draftImages = [{ type: 'image', data: 'abc123', mimeType: 'image/png' }]

    lifecycle.sendMessage()

    expect(sent).toEqual([
      expect.objectContaining({
        type: 'prompt',
        conversationId,
        prompt: 'describe this',
        images: [{ type: 'image', data: 'abc123', mimeType: 'image/png' }],
      }),
    ])
    expect(runtime.draft).toBe('')
    expect(runtime.draftImages).toEqual([])
    expect(pushed).toEqual([{
      conversationId,
      role: 'user',
      text: 'describe this',
      images: [{ type: 'image', data: 'abc123', mimeType: 'image/png' }],
    }])
  })

  it('queues running-time input as pending steer instead of sending immediately', () => {
    const { conversations, lifecycle, runnerSnapshots, runtimeFor, sent } = setupLifecycle()
    lifecycle.startSessionOnly()
    const conversationId = conversations.value[0].id
    const runtime = runtimeFor(conversationId)
    runnerSnapshots.value.set(conversationId, runnerSnapshot(conversationId, 'running'))
    runtime.draft = 'change direction'

    lifecycle.sendMessage()

    expect(sent).toEqual([])
    expect(runtime.pendingSteers).toEqual([
      expect.objectContaining({ text: 'change direction' }),
    ])
    expect(runtime.draft).toBe('')
  })

  it('sends queued image follow-ups in protocol-sized batches', () => {
    const { conversations, lifecycle, runtimeFor, sent } = setupLifecycle()
    lifecycle.startSessionOnly()
    const conversationId = conversations.value[0].id
    const runtime = runtimeFor(conversationId)
    runtime.pendingSteers = [
      {
        id: 'steer-1',
        text: 'first',
        images: Array.from({ length: 4 }, (_, index) => ({ type: 'image', data: `a${index}`, mimeType: 'image/png' })),
      },
      {
        id: 'steer-2',
        text: 'second',
        images: Array.from({ length: 2 }, (_, index) => ({ type: 'image', data: `b${index}`, mimeType: 'image/png' })),
      },
      {
        id: 'steer-3',
        text: 'third',
        images: [{ type: 'image', data: 'c0', mimeType: 'image/png' }],
      },
    ]

    lifecycle.sendPendingSteersAsFollowUp(conversationId, runtime)

    expect(sent).toEqual([
      expect.objectContaining({
        type: 'prompt',
        conversationId,
        id: expect.stringMatching(/^follow-up-/),
        prompt: 'first\n\nsecond',
        images: [
          { type: 'image', data: 'a0', mimeType: 'image/png' },
          { type: 'image', data: 'a1', mimeType: 'image/png' },
          { type: 'image', data: 'a2', mimeType: 'image/png' },
          { type: 'image', data: 'a3', mimeType: 'image/png' },
          { type: 'image', data: 'b0', mimeType: 'image/png' },
          { type: 'image', data: 'b1', mimeType: 'image/png' },
        ],
      }),
    ])
    expect(runtime.pendingSteers).toEqual([
      {
        id: 'steer-3',
        text: 'third',
        images: [{ type: 'image', data: 'c0', mimeType: 'image/png' }],
      },
    ])
  })

  it('finalizes the streaming assistant turn when abort is sent', () => {
    const current = conversation('c1', 'Running')
    current.messages.push({
      id: 'assistant-1',
      role: 'assistant',
      text: 'partial output',
      status: 'streaming',
      timestamp: 1,
    })
    current.turns.push({ id: 'turn-1', messageIds: ['assistant-1'] })
    const { finalizeAssistantTurn, lifecycle, runtimeFor, sent } = setupLifecycle([current])
    const runtime = runtimeFor('c1')
    runtime.pendingPromptId = 'prompt-1'
    runtime.pendingSteers = [{ id: 'steer-1', text: 'next task' }]
    runtime.activeTurn = {
      agentTurnId: 'turn-1',
      messageId: 'assistant-1',
      textBuffer: '',
      thinkingActive: false,
      toolStartedAt: new Map(),
      startedAt: 1,
    }

    lifecycle.cancelPi()

    expect(sent).toEqual([{ type: 'abort', conversationId: 'c1' }])
    expect(finalizeAssistantTurn).toHaveBeenCalledWith('c1', 'error')
    expect(runtime.activeTurn).toBeNull()
    expect(runtime.pendingPromptId).toBeNull()
    expect(runtime.pendingSteers).toEqual([])
    expect(current.messages[0]).toMatchObject({ status: 'error' })
  })

  it('keeps the active turn when abort cannot be sent during a disconnect', () => {
    const current = conversation('c1', 'Running')
    const { finalizeAssistantTurn, lifecycle, pushed, runtimeFor } = setupLifecycle(
      [current],
      { sendResult: false },
    )
    const runtime = runtimeFor('c1')
    runtime.activeTurn = {
      agentTurnId: 'turn-1',
      messageId: 'assistant-1',
      textBuffer: 'partial output',
      thinkingActive: false,
      toolStartedAt: new Map(),
      startedAt: 1,
    }

    lifecycle.cancelPi()

    expect(finalizeAssistantTurn).not.toHaveBeenCalled()
    expect(runtime.activeTurn).not.toBeNull()
    expect(pushed).toContainEqual({
      conversationId: 'c1',
      role: 'error',
      text: '后端连接已断开',
    })
  })

  it('rolls back an optimistic conversation delete when sending fails', () => {
    const first = conversation('c1', 'First')
    const second = conversation('c2', 'Second')
    const { activeId, conversations, lifecycle, notifications, sent } = setupLifecycle([first, second], {
      sendResult: false,
    })

    lifecycle.deleteConversation('c1')

    expect(conversations.value).toEqual([first, second])
    expect(activeId.value).toBe('c1')
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'delete_conversation',
      conversationId: 'c1',
      requestId: expect.stringMatching(/^delete-conversation-/),
    }))
    expect(notifications).toEqual([{ type: 'error', message: '移除失败，已恢复' }])
  })

  it('confirms an optimistic conversation delete after the backend acknowledges it', () => {
    const first = conversation('c1', 'First')
    const second = conversation('c2', 'Second')
    const { conversations, lifecycle, notifications, sent } = setupLifecycle([first, second])

    lifecycle.deleteConversation('c1')
    const deleteMessage = sent.find((message): message is Extract<ClientMessage, { type: 'delete_conversation' }> =>
      message.type === 'delete_conversation',
    )!
    const requestId = deleteMessage.requestId!
    lifecycle.confirmOptimisticDelete(requestId)

    expect(conversations.value).toEqual([second])
    expect(notifications).toEqual([{
      type: 'success',
      message: '已移除会话',
      duration: 8000,
      action: expect.objectContaining({ label: '撤销' }),
    }])
  })

  it('restores only the removed local conversation after backend confirmation', () => {
    const removed = conversation('local', 'Local draft')
    removed.sessionPath = null
    const existing = conversation('existing', 'Existing')
    const concurrent = conversation('concurrent', 'Arrived later')
    const { conversations, lifecycle, notifications, sent } = setupLifecycle([removed, existing])

    lifecycle.deleteConversation('local')
    const deleteRequest = sent.find((message) => message.type === 'delete_conversation')!
    lifecycle.confirmOptimisticDelete(deleteRequest.requestId)
    conversations.value.unshift(concurrent)
    notifications[0].action?.onClick()

    const restoreRequest = sent.find((message) => message.type === 'restore_conversation')
    expect(restoreRequest).toMatchObject({
      type: 'restore_conversation',
      conversationId: 'local',
      sessionPath: null,
    })
    expect(conversations.value.map((item) => item.id)).toEqual(['concurrent', 'existing'])

    lifecycle.confirmOptimisticRestore(restoreRequest?.requestId)

    expect(conversations.value.map((item) => item.id)).toEqual(['concurrent', 'existing', 'local'])
  })

  it('restores the removed conversation runtime and unsent draft', () => {
    const removed = conversation('local', 'Local draft')
    removed.sessionPath = null
    const { lifecycle, notifications, runtimeFor, runtimes, sent } = setupLifecycle([removed])
    const originalRuntime = runtimeFor('local')
    originalRuntime.draft = 'unsent text'
    originalRuntime.draftImages = [{ type: 'image', data: 'image-data', mimeType: 'image/png' }]

    lifecycle.deleteConversation('local')
    const deleteRequest = sent.find((message) => message.type === 'delete_conversation')!
    lifecycle.confirmOptimisticDelete(deleteRequest.requestId)
    notifications[0].action?.onClick()
    const restoreRequest = sent.find((message) => message.type === 'restore_conversation')!
    lifecycle.confirmOptimisticRestore(restoreRequest.requestId)

    expect(runtimes.value.get('local')?.draft).toBe('unsent text')
    expect(runtimes.value.get('local')?.draftImages).toHaveLength(1)
  })

  it('only restores the failed object when concurrent deletes resolve differently', () => {
    const first = conversation('c1', 'First')
    const second = conversation('c2', 'Second')
    const { activeId, conversations, lifecycle, sent } = setupLifecycle([first, second])

    lifecycle.deleteConversation('c1')
    lifecycle.deleteConversation('c2')
    const requests = sent.filter((message) => message.type === 'delete_conversation')
    lifecycle.confirmOptimisticDelete(requests[1].requestId)
    lifecycle.rollbackOptimisticDelete(requests[0].requestId)

    expect(conversations.value.map((item) => item.id)).toEqual(['c1'])
    expect(activeId.value).toBe('c1')
  })

  it('reports a failed undo once and clears its pending request', () => {
    const removed = conversation('c1', 'First')
    const { lifecycle, notifications, sent } = setupLifecycle([removed])
    lifecycle.deleteConversation('c1')
    const deleteRequest = sent.find((message) => message.type === 'delete_conversation')!
    lifecycle.confirmOptimisticDelete(deleteRequest.requestId)
    notifications[0].action?.onClick()
    const restoreRequest = sent.find((message) => message.type === 'restore_conversation')!

    expect(lifecycle.rejectOptimisticRestore(restoreRequest.requestId, 'database busy')).toBe(true)
    expect(lifecycle.rejectOptimisticRestore(restoreRequest.requestId, 'again')).toBe(false)
    expect(notifications.at(-1)).toEqual({ type: 'error', message: 'database busy' })
  })

  it('restores all removed workspace conversations without replacing concurrent state', () => {
    const first = conversation('w1', 'Workspace one', '/tmp/project')
    const second = conversation('w2', 'Workspace two', '/tmp/project')
    const other = conversation('other', 'Other')
    const concurrent = conversation('concurrent', 'Concurrent')
    const { conversations, lifecycle, notifications, sent } = setupLifecycle([first, second, other])

    lifecycle.deleteWorkspace('/tmp/project')
    const deleteRequest = sent.find((message) => message.type === 'delete_workspace')!
    lifecycle.confirmOptimisticDelete(deleteRequest.requestId)
    conversations.value.unshift(concurrent)
    notifications[0].action?.onClick()
    const restoreRequest = sent.find((message) => message.type === 'restore_workspace')

    lifecycle.confirmOptimisticRestore(restoreRequest?.requestId)

    expect(conversations.value.map((item) => item.id)).toEqual(['concurrent', 'other', 'w1', 'w2'])
  })

  it.each(['starting', 'running', 'stopping'] as const)(
    'does not remove a %s conversation',
    (phase) => {
      const first = conversation('c1', 'First')
      const { conversations, lifecycle, notifications, runnerSnapshots, sent } = setupLifecycle([first])
      runnerSnapshots.value.set('c1', runnerSnapshot('c1', phase))

      lifecycle.deleteConversation('c1')

      expect(conversations.value).toEqual([first])
      expect(sent).toEqual([])
      expect(notifications).toEqual([{ type: 'error', message: '任务进行中，停止后才能移除' }])
    },
  )

  it('does not remove a workspace while any of its conversations is active', () => {
    const first = conversation('c1', 'First', '/tmp/project')
    const second = conversation('c2', 'Second', '/tmp/project')
    const { conversations, lifecycle, notifications, runnerSnapshots, sent } = setupLifecycle([first, second])
    runnerSnapshots.value.set('c2', runnerSnapshot('c2', 'running'))

    lifecycle.deleteWorkspace('/tmp/project')

    expect(conversations.value).toEqual([first, second])
    expect(sent).toEqual([])
    expect(notifications).toEqual([{ type: 'error', message: '工作区有 1 个任务进行中，停止后才能移除' }])
  })

  it('rolls back an optimistic workspace delete when the backend reports failure', () => {
    const workspaceOne = conversation('c1', 'First', '/tmp/project')
    const workspaceTwo = conversation('c2', 'Second', '/tmp/project')
    const other = conversation('c3', 'Other')
    const { activeId, conversations, lifecycle, notifications, sent } = setupLifecycle([
      workspaceOne,
      workspaceTwo,
      other,
    ])

    lifecycle.deleteWorkspace('/tmp/project')
    const deleteMessage = sent.find((message): message is Extract<ClientMessage, { type: 'delete_workspace' }> =>
      message.type === 'delete_workspace',
    )!
    const requestId = deleteMessage.requestId!
    lifecycle.rollbackOptimisticDelete(requestId)

    expect(conversations.value).toEqual([workspaceOne, workspaceTwo, other])
    expect(activeId.value).toBe('c1')
    expect(notifications).toEqual([{ type: 'error', message: '移除失败，已恢复' }])
  })

  it('preserves a safe backend rejection reason when rolling back removal', () => {
    const first = conversation('c1', 'First')
    const { lifecycle, notifications, sent } = setupLifecycle([first])

    lifecycle.deleteConversation('c1')
    const request = sent.find((message) => message.type === 'delete_conversation')!
    lifecycle.rollbackOptimisticDelete(request.requestId, '任务进行中，停止后才能移除')

    expect(notifications).toEqual([{ type: 'error', message: '任务进行中，停止后才能移除' }])
  })

  it('shows a notification when opening a workspace folder fails', async () => {
    const originalWindow = globalThis.window
    const openWorkspaceFolder = vi.fn(async () => 'Folder does not exist')
    vi.stubGlobal('window', {
      piDesktop: {
        openWorkspaceFolder,
      },
    })
    const { lifecycle, notifications } = setupLifecycle()

    await lifecycle.openWorkspaceFolder('/tmp/project/../project/')

    expect(openWorkspaceFolder).toHaveBeenCalledWith('/tmp/project')
    expect(notifications).toEqual([{ type: 'error', message: '无法打开工作区：Folder does not exist' }])
    vi.stubGlobal('window', originalWindow)
  })

  it('reports the downloaded filename after exporting a conversation', () => {
    const first = conversation('c1', 'Export me')
    const anchor = {
      click: vi.fn(),
      href: '',
      download: '',
    } as unknown as HTMLAnchorElement
    const createElement = vi.fn(() => anchor)
    const createObjectURL = vi.fn(() => 'blob:test')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('document', { createElement })
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const { lifecycle, notifications } = setupLifecycle([first])

    lifecycle.exportConversation('c1')

    expect(anchor.click).toHaveBeenCalledOnce()
    expect(anchor.download).toBe('pi-conversation-1970-01-01-export-me.md')
    expect(notifications).toEqual([{ type: 'success', message: '已导出：pi-conversation-1970-01-01-export-me.md' }])
    vi.unstubAllGlobals()
  })
})

function runnerSnapshot(conversationId: string, phase: PiRunnerSnapshot['phase']): PiRunnerSnapshot {
  return {
    conversationId,
    phase,
    cwd: '/tmp/project',
    sessionPath: `/tmp/${conversationId}.jsonl`,
    createdAt: 1,
    lastActiveAt: 2,
  }
}

function conversation(id: string, title: string, workspacePath?: string): Conversation {
  return {
    id,
    title,
    messages: [],
    turns: [],
    sessionPath: `/tmp/${id}.jsonl`,
    ...(workspacePath ? { kind: 'workspace' as const, workspacePath } : { kind: 'session' as const }),
    createdAt: 1,
  }
}
