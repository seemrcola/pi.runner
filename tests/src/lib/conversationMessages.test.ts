import { describe, expect, it, vi } from 'vitest'
import { createConversationRuntime } from '../../../src/lib/conversationRuntime'
import { useConversationMessages } from '../../../src/composables/useConversationMessages'
import type { Conversation } from '../../../shared/chat'

function setupMessages() {
  const runtime = createConversationRuntime()
    const conversation: Conversation = {
    id: 'conv-1',
    title: 'Conversation',
    messages: [],
    turns: [],
    sessionPath: null,
    createdAt: 1,
  }
  let seq = 0
  const scrollToBottom = vi.fn()
  const messages = useConversationMessages({
    conversationById: (conversationId) => conversationId === conversation.id ? conversation : null,
    runtimeFor: () => runtime,
    isActive: () => true,
    nextMessageId: () => `msg-${++seq}`,
    scrollToBottom,
  })
  return { conversation, messages, runtime, scrollToBottom }
}

describe('conversation assistant turns', () => {
  it('creates an assistant turn when thinking arrives before text', () => {
    const { conversation, messages, runtime } = setupMessages()

    messages.appendThinkingDelta('conv-1', 'checking files')

    expect(runtime.activeTurn).toMatchObject({ messageId: 'msg-1', thinkingActive: true })
    expect(conversation.messages).toEqual([
      expect.objectContaining({
        id: 'msg-1',
        role: 'assistant',
        text: '',
        thinking: 'checking files',
        thinkingActive: true,
        tools: [],
        status: 'streaming',
      }),
    ])
  })

  it('keeps text and tool calls inside the same assistant turn', () => {
    const { conversation, messages, runtime } = setupMessages()

    messages.appendThinkingDelta('conv-1', 'plan')
    messages.appendAssistantDelta('conv-1', 'answer')
    messages.flushNow('conv-1')
    messages.upsertAssistantTool('conv-1', 'tool-1', {
      toolName: 'read_file',
      status: 'running',
      args: { path: 'src/App.vue' },
    })
    messages.upsertAssistantTool('conv-1', 'tool-1', {
      status: 'done',
      result: 'ok',
    })

    expect(conversation.messages).toHaveLength(1)
    expect(conversation.messages[0]).toMatchObject({
      id: runtime.activeTurn?.messageId,
      role: 'assistant',
      text: 'answer',
      thinking: 'plan',
      tools: [
        {
          toolName: 'read_file',
          toolCallId: 'tool-1',
          status: 'done',
          args: { path: 'src/App.vue' },
          result: 'ok',
        },
      ],
    })
  })

  it('preserves streaming event order across thinking, text, and tools', () => {
    const { conversation, messages } = setupMessages()

    messages.appendThinkingDelta('conv-1', 'plan')
    messages.appendAssistantDelta('conv-1', 'answer')
    messages.flushNow('conv-1')
    messages.upsertAssistantTool('conv-1', 'tool-1', {
      toolName: 'bash',
      status: 'running',
      args: { cmd: 'npm test' },
    })
    messages.appendThinkingDelta('conv-1', 'check result')
    messages.upsertAssistantTool('conv-1', 'tool-1', {
      status: 'done',
      output: 'ok',
    })
    messages.appendAssistantDelta('conv-1', 'done')
    messages.flushNow('conv-1')

    expect(conversation.messages[0].segments).toEqual([
      { type: 'thinking', content: 'plan' },
      { type: 'text', content: 'answer' },
      {
        type: 'tool',
        toolCallId: 'tool-1',
        tool: {
          toolName: 'bash',
          toolCallId: 'tool-1',
          status: 'done',
          args: { cmd: 'npm test' },
          output: 'ok',
        },
      },
      { type: 'thinking', content: 'check result' },
      { type: 'text', content: 'done' },
    ])
  })

  it('does not collapse separated thinking segments when final thinking content arrives', () => {
    const { conversation, messages } = setupMessages()

    messages.appendThinkingDelta('conv-1', 'plan')
    messages.upsertAssistantTool('conv-1', 'tool-1', {
      toolName: 'bash',
      status: 'done',
    })
    messages.appendThinkingDelta('conv-1', 'check result')
    messages.endThinking('conv-1', 'plan\ncheck result')

    expect(conversation.messages[0]).toMatchObject({
      thinking: 'plan\ncheck result',
      segments: [
        { type: 'thinking', content: 'plan' },
        {
          type: 'tool',
          toolCallId: 'tool-1',
          tool: {
            toolName: 'bash',
            toolCallId: 'tool-1',
            status: 'done',
          },
        },
        { type: 'thinking', content: 'check result' },
      ],
    })
  })

  it('does not erase existing tool details when a later patch omits them', () => {
    const { conversation, messages } = setupMessages()

    messages.upsertAssistantTool('conv-1', 'tool-1', {
      toolName: 'bash',
      status: 'running',
      output: 'partial output',
    })
    messages.upsertAssistantTool('conv-1', 'tool-1', {
      status: 'done',
      result: undefined,
      output: undefined,
    })

    expect(conversation.messages[0].tools?.[0]).toMatchObject({
      toolName: 'bash',
      status: 'done',
      output: 'partial output',
    })
  })

  it('finalizes an active assistant turn', () => {
    const { conversation, messages, runtime } = setupMessages()

    messages.appendThinkingDelta('conv-1', 'done thinking')
    messages.finalizeAssistantTurn('conv-1')

    expect(runtime.activeTurn).toBeNull()
    expect(conversation.messages[0]).toMatchObject({
      status: 'done',
      thinkingActive: false,
    })
  })

  it('marks unfinished tools as failed when an active turn is interrupted', () => {
    const { conversation, messages, runtime } = setupMessages()

    messages.upsertAssistantTool('conv-1', 'tool-1', {
      toolName: 'bash',
      status: 'running',
    })
    messages.finalizeAssistantTurn('conv-1', 'error')

    expect(runtime.activeTurn).toBeNull()
    expect(conversation.messages[0]).toMatchObject({
      status: 'error',
      thinkingActive: false,
      tools: [expect.objectContaining({ toolCallId: 'tool-1', status: 'error' })],
      segments: [expect.objectContaining({
        type: 'tool',
        tool: expect.objectContaining({ toolCallId: 'tool-1', status: 'error' }),
      })],
    })
  })

})
