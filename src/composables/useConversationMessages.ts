import type { AgentTurn, ChatMessage, ChatMessageMeta, ChatMessageSegment, Conversation, ImageContent, MessageRole, ToolMeta } from '@shared/chat'
import type { ConversationRuntime } from '@/lib/conversationRuntime'

type UseConversationMessagesOptions = {
  conversationById(conversationId: string): Conversation | null
  runtimeFor(conversationId: string): ConversationRuntime
  isActive(conversationId: string): boolean
  nextMessageId(): string
  scrollToBottom(): void
}

type ToolPatch = Partial<ToolMeta> & { toolName?: string; status?: ToolMeta['status'] }

export function useConversationMessages(options: UseConversationMessagesOptions) {
  function ensureAssistantTurn(conversationId: string) {
    const conv = options.conversationById(conversationId)
    if (!conv) return null
    const runtime = options.runtimeFor(conversationId)

    if (runtime.activeTurn) {
      const existing = conv.messages.find((message) => message.id === runtime.activeTurn?.messageId)
      if (existing?.role === 'assistant') return existing
    }

    const message: ChatMessage = {
      id: options.nextMessageId(),
      role: 'assistant' as const,
      text: '',
      thinking: '',
      thinkingActive: false,
      tools: [],
      segments: [],
      status: 'streaming' as const,
      timestamp: Date.now(),
    }
    conv.messages.push(message)
    const agentTurn = ensureCurrentAgentTurn(conv, message.id)
    agentTurn.messageIds.push(message.id)
    runtime.activeTurn = {
      agentTurnId: agentTurn.id,
      messageId: message.id,
      textBuffer: '',
      thinkingActive: false,
      toolStartedAt: new Map(),
      startedAt: Date.now(),
    }
    return message
  }

  function appendAssistantDelta(conversationId: string, delta: string) {
    const runtime = options.runtimeFor(conversationId)
    if (!ensureAssistantTurn(conversationId)) return
    runtime.activeTurn!.textBuffer += delta
    scheduleFlush(conversationId)
  }

  function appendThinkingDelta(conversationId: string, delta: string) {
    drainBuffer(conversationId)
    const message = ensureAssistantTurn(conversationId)
    if (!message) return
    const runtime = options.runtimeFor(conversationId)
    message.thinking = `${message.thinking ?? ''}${delta}`
    appendSegmentText(message, 'thinking', delta)
    message.thinkingActive = true
    runtime.activeTurn!.thinkingActive = true
    if (options.isActive(conversationId)) options.scrollToBottom()
  }

  function endThinking(conversationId: string, content?: string) {
    drainBuffer(conversationId)
    const message = ensureAssistantTurn(conversationId)
    if (!message) return
    const runtime = options.runtimeFor(conversationId)
    if (content) {
      message.thinking = content
      replaceLatestThinkingSegment(message, content)
    }
    message.thinkingActive = false
    runtime.activeTurn!.thinkingActive = false
    if (options.isActive(conversationId)) options.scrollToBottom()
  }

  function scheduleFlush(conversationId: string) {
    const runtime = options.runtimeFor(conversationId)
    if (runtime.rafId != null) return
    runtime.rafId = scheduleFrame(() => flushOnFrame(conversationId))
  }

  function flushOnFrame(conversationId: string) {
    options.runtimeFor(conversationId).rafId = null
    drainBuffer(conversationId)
  }

  function drainBuffer(conversationId: string) {
    const runtime = options.runtimeFor(conversationId)
    const activeTurn = runtime.activeTurn
    if (!activeTurn) {
      if (options.isActive(conversationId)) options.scrollToBottom()
      return
    }
    const msg = options.conversationById(conversationId)?.messages.find((m) => m.id === activeTurn.messageId)
    if (msg?.role === 'assistant' && activeTurn.textBuffer) {
      msg.text += activeTurn.textBuffer
      appendSegmentText(msg, 'text', activeTurn.textBuffer)
      activeTurn.textBuffer = ''
    } else {
      activeTurn.textBuffer = ''
    }
    if (options.isActive(conversationId)) options.scrollToBottom()
  }

  function flushNow(conversationId: string) {
    const runtime = options.runtimeFor(conversationId)
    if (runtime.rafId != null) {
      cancelFrame(runtime.rafId)
      runtime.rafId = null
    }
    drainBuffer(conversationId)
  }

  function upsertAssistantTool(conversationId: string, toolCallId: string, patch: ToolPatch) {
    drainBuffer(conversationId)
    const message = ensureAssistantTurn(conversationId)
    if (!message) return
    const tools = message.tools ?? (message.tools = [])
    const existing = tools.find((tool) => tool.toolCallId === toolCallId)

    if (existing) {
      Object.assign(existing, definedToolPatch(patch))
      syncToolSegment(message, existing)
      if (options.isActive(conversationId)) options.scrollToBottom()
      return
    }

    const tool = {
      toolName: patch.toolName ?? 'tool',
      toolCallId,
      status: patch.status ?? 'running',
      ...(patch.args != null ? { args: patch.args } : {}),
      ...(patch.result != null ? { result: patch.result } : {}),
      ...(patch.output != null ? { output: patch.output } : {}),
      ...(patch.diff != null ? { diff: patch.diff } : {}),
      ...(patch.durationMs != null ? { durationMs: patch.durationMs } : {}),
    } satisfies ToolMeta
    tools.push(tool)
    message.segments ??= []
    message.segments.push({ type: 'tool', toolCallId, tool })
    if (options.isActive(conversationId)) options.scrollToBottom()
  }

  function finalizeAssistantTurn(conversationId: string, status: 'done' | 'error' = 'done') {
    flushNow(conversationId)
    const runtime = options.runtimeFor(conversationId)
    const activeTurn = runtime.activeTurn
    const message = activeTurn
      ? options.conversationById(conversationId)?.messages.find((item) => item.id === activeTurn.messageId)
      : null
    if (message?.role === 'assistant') {
      message.status = status
      message.thinkingActive = false
      if (status === 'error') {
        for (const tool of message.tools ?? []) {
          if (tool.status !== 'running') continue
          tool.status = 'error'
          syncToolSegment(message, tool)
        }
      }
    }
    runtime.activeTurn = null
  }

  function pushMessage(
    conversationId: string,
    role: MessageRole,
    text: string,
    meta?: ChatMessageMeta,
    id = options.nextMessageId(),
    images?: ImageContent[],
  ) {
    const conv = options.conversationById(conversationId)
    if (!conv) return
    conv.messages.push({
      id,
      role,
      text,
      ...(images?.length ? { images } : {}),
      timestamp: Date.now(),
      ...(meta ? { meta } : {}),
    })
    if (role === 'user') {
      conv.turns.push({ id, messageIds: [id] })
    } else {
      ensureCurrentAgentTurn(conv, id).messageIds.push(id)
    }
    if (options.isActive(conversationId)) options.scrollToBottom()
  }

  return {
    appendAssistantDelta,
    appendThinkingDelta,
    endThinking,
    finalizeAssistantTurn,
    flushNow,
    scheduleFlush,
    upsertAssistantTool,
    pushMessage,
  }
}

function appendSegmentText(message: ChatMessage, type: Extract<ChatMessageSegment['type'], 'thinking' | 'text'>, delta: string): void {
  if (!delta) return
  const segments = message.segments ?? (message.segments = [])
  const latest = segments[segments.length - 1]
  // 连续同类 delta 属于同一个可折叠/可解析片段；一旦中间出现工具或另一类文本，就新建片段保留时间线。
  if (latest?.type === type) {
    latest.content += delta
    return
  }
  segments.push({ type, content: delta })
}

function replaceLatestThinkingSegment(message: ChatMessage, content: string): void {
  const segments = message.segments ?? (message.segments = [])
  const thinkingSegments = segments.filter((segment) => segment.type === 'thinking')
  if (thinkingSegments.length > 1) return
  const latestThinking = thinkingSegments[0]
  if (latestThinking?.type === 'thinking') {
    latestThinking.content = content
    return
  }
  segments.push({ type: 'thinking', content })
}

function syncToolSegment(message: ChatMessage, tool: ToolMeta): void {
  const segment = message.segments?.find((item) => item.type === 'tool' && item.toolCallId === tool.toolCallId)
  if (segment?.type === 'tool') segment.tool = tool
}

function ensureCurrentAgentTurn(conv: Conversation, fallbackId: string): AgentTurn {
  const lastTurn = conv.turns[conv.turns.length - 1]
  if (lastTurn) return lastTurn
  const turn: AgentTurn = { id: fallbackId, messageIds: [] }
  conv.turns.push(turn)
  return turn
}


function definedToolPatch(patch: ToolPatch): ToolPatch {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as ToolPatch
}

function scheduleFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback)
  return setTimeout(callback, 0) as unknown as number
}

function cancelFrame(id: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(id)
    return
  }
  clearTimeout(id)
}
