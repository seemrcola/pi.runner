import { describe, expect, it } from 'vitest'
import { createSessionServiceFacade } from '../../../backend/sessions/sessionService.js'
import type { SessionIndexStore } from '../../../backend/sessions/sessionIndexStore.js'
import type { SessionStore } from '../../../backend/sessions/sessionStore.js'

function createStore(): SessionStore {
  return {
    rootDir: '/tmp/pi-source-sessions',
    newSessionPath: () => '/tmp/pi-source-sessions/new.jsonl',
    isSourceSessionPath: () => true,
    resolveSessionPath: (sessionPath) => sessionPath?.trim() || '/tmp/pi-source-sessions/new.jsonl',
  }
}

function createIndex(events: unknown[]): SessionIndexStore {
  return {
    sync: () => ({ indexed: 0, removed: 0, skipped: 0, failed: 0 }),
    syncSession: () => ({ indexed: 0, removed: 0, skipped: 0, failed: 0 }),
    listConversations: () => [],
    recordViewOverride: (sessionPath, viewKind, workspacePath) => {
      events.push({ type: 'override', sessionPath, viewKind, workspacePath })
    },
    recordSessionPlaceholder: (input) => {
      events.push({ type: 'placeholder', input })
    },
    recordMessageImages: () => {},
    listWorkspaceViewStates: () => [],
    upsertWorkspaceViewState: (workspacePath) => ({
      workspacePath,
      isPinned: false,
      isCollapsed: false,
      pinnedAt: null,
      updatedAt: 1,
    }),
    hideSession: () => {},
    hideConversation: () => {},
    hideWorkspace: () => {},
  }
}

describe('session service facade', () => {
  it('prepares and records a new workspace conversation without exposing placeholder details', () => {
    const events: unknown[] = []
    const sessions = createSessionServiceFacade(createStore(), createIndex(events))

    const start = sessions.prepareConversationStart({
      conversationId: 'conv-1',
      cwd: '/tmp/project/',
      mode: 'workspace',
    })

    expect(start).toEqual({
      conversationId: 'conv-1',
      sessionPath: '/tmp/pi-source-sessions/new.jsonl',
      cwd: '/tmp/project',
      viewKind: 'workspace',
      workspacePath: '/tmp/project',
      isNewSession: true,
    })

    sessions.recordConversationStart(start, { title: 'New conversation', createdAt: 123 })

    expect(events).toEqual([
      {
        type: 'placeholder',
        input: {
          id: 'conv-1',
          sessionPath: '/tmp/pi-source-sessions/new.jsonl',
          title: 'New conversation',
          viewKind: 'workspace',
          workspacePath: '/tmp/project',
          createdAt: 123,
        },
      },
      {
        type: 'override',
        sessionPath: '/tmp/pi-source-sessions/new.jsonl',
        viewKind: 'workspace',
        workspacePath: '/tmp/project',
      },
    ])
  })

  it('records only view intent when continuing an existing session', () => {
    const events: unknown[] = []
    const sessions = createSessionServiceFacade(createStore(), createIndex(events))

    const start = sessions.prepareConversationStart({
      conversationId: 'conv-existing',
      sessionPath: '/tmp/pi-source-sessions/existing.jsonl',
      cwd: '/tmp/project',
      mode: 'workspace',
    })

    sessions.recordConversationStart(start)

    expect(events).toEqual([
      {
        type: 'override',
        sessionPath: '/tmp/pi-source-sessions/existing.jsonl',
        viewKind: 'workspace',
        workspacePath: '/tmp/project',
      },
    ])
  })
})
