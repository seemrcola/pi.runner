import { describe, expect, it } from 'vitest'
import {
  buildConversationExport,
  getConversationExportFilename,
  mergeConversationHistory,
  removeConversationById,
} from '../../../src/lib/conversations'
import type { Conversation } from '@shared/chat'

const baseConversation: Conversation = {
  id: 'conv-1',
  title: 'Plan / MVP: first chat',
  sessionPath: '/tmp/pi-session.jsonl',
  createdAt: Date.UTC(2026, 5, 30, 8, 12, 30),
  messages: [
    {
      id: 'msg-1',
      role: 'user',
      text: 'hello',
      timestamp: Date.UTC(2026, 5, 30, 8, 13, 0),
    },
    {
      id: 'msg-2',
      role: 'assistant',
      text: 'hi',
      thinking: 'checking',
      tools: [
        {
          toolName: 'shell',
          toolCallId: 'tool-1',
          status: 'done',
          output: 'internal command output',
        },
      ],
      timestamp: Date.UTC(2026, 5, 30, 8, 13, 5),
    },
    {
      id: 'msg-3',
      role: 'error',
      text: 'internal error',
      timestamp: Date.UTC(2026, 5, 30, 8, 13, 10),
    },
  ],
  turns: [{ id: 'msg-1', messageIds: ['msg-1', 'msg-2'] }],
}

describe('conversation helpers', () => {
  it('builds a readable Markdown export with only normal conversation text', () => {
    const exported = buildConversationExport(baseConversation)

    expect(exported).toBe(`# Plan / MVP: first chat

## 用户

hello

## 助手

hi
`)
  })

  it('creates a filesystem-safe export filename from the title and created date', () => {
    expect(getConversationExportFilename(baseConversation)).toBe(
      'pi-conversation-2026-06-30-plan-mvp-first-chat.md',
    )
  })

  it('removes a conversation and keeps the nearest remaining conversation active', () => {
    const second = { ...baseConversation, id: 'conv-2', title: 'Second' }
    const third = { ...baseConversation, id: 'conv-3', title: 'Third' }

    expect(removeConversationById([baseConversation, second, third], 'conv-2', 'conv-2')).toEqual({
      conversations: [baseConversation, third],
      activeId: 'conv-3',
    })
  })

  it('creates a new active id when the last conversation is removed', () => {
    expect(removeConversationById([baseConversation], 'conv-1', 'conv-1')).toEqual({
      conversations: [],
      activeId: null,
    })
  })

  it('refreshes existing history instead of ignoring backend conversations after local state exists', () => {
    const localDraft: Conversation = {
      ...baseConversation,
      id: 'draft',
      title: 'Draft',
      sessionPath: null,
    }
    const staleLocal: Conversation = {
      ...baseConversation,
      id: 'stale',
      title: 'Stale local',
      sessionPath: '/tmp/stale.jsonl',
    }
    const backendUpdated: Conversation = {
      ...baseConversation,
      id: 'server',
      title: 'Server history',
      sessionPath: '/tmp/server.jsonl',
    }

    expect(mergeConversationHistory([localDraft, staleLocal], [backendUpdated])).toEqual([
      localDraft,
      backendUpdated,
    ])
  })

  it('merges refreshed backend history into a local running conversation with the same session path', () => {
    const localRunning: Conversation = {
      ...baseConversation,
      id: 'local-conversation',
      title: 'Local running',
      sessionPath: '/tmp/shared-session.jsonl',
      messages: [
        {
          id: 'prompt-1',
          role: 'user',
          text: 'change files',
          timestamp: 1,
        },
      ],
      turns: [{ id: 'prompt-1', messageIds: ['prompt-1'] }],
    }
    const backendRefreshed: Conversation = {
      ...baseConversation,
      id: 'jsonl-session-id',
      title: 'Backend refreshed',
      sessionPath: '/tmp/shared-session.jsonl',
      messages: [
        {
          id: 'jsonl-user-1',
          role: 'user',
          text: 'change files',
          timestamp: 1,
        },
        {
          id: 'jsonl-assistant-1',
          role: 'assistant',
          text: 'done',
          timestamp: 2,
        },
      ],
      turns: [{ id: 'jsonl-user-1', messageIds: ['jsonl-user-1', 'jsonl-assistant-1'] }],
    }

    expect(mergeConversationHistory([localRunning], [backendRefreshed])).toEqual([
      expect.objectContaining({
        id: 'local-conversation',
        title: 'Backend refreshed',
        sessionPath: '/tmp/shared-session.jsonl',
        messages: backendRefreshed.messages,
      }),
    ])
  })

  it('does not keep managed workspace placeholders as local-only conversations', () => {
    const placeholder: Conversation = {
      ...baseConversation,
      id: 'workspace-dir:--abc--',
      title: 'Workspace',
      sessionPath: null,
      kind: 'workspace',
      workspaceDirName: '--abc--',
    }

    expect(mergeConversationHistory([placeholder], [placeholder])).toEqual([placeholder])
  })
})
