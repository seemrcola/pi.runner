import { describe, expect, it } from 'vitest'
import { createClientMessageDispatcher, type ClientMessageHandlerDeps } from '../../backend/client/clientMessageDispatcher.js'

type TestDepsOverrides = Partial<Omit<ClientMessageHandlerDeps, 'sessions'>> & {
  sessions?: Partial<ClientMessageHandlerDeps['sessions']>
}

function createSessions(overrides: Partial<ClientMessageHandlerDeps['sessions']> = {}): ClientMessageHandlerDeps['sessions'] {
  return {
    sync: () => ({ indexed: 0, removed: 0, skipped: 0, failed: 0 }),
    syncSession: () => ({ indexed: 0, removed: 0, skipped: 0, failed: 0 }),
    listConversations: () => [],
    recordViewOverride: () => {},
    recordSessionPlaceholder: () => {},
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
    prepareConversationStart: (input) => ({
      conversationId: input.conversationId,
      sessionPath: input.sessionPath?.trim() || '/tmp/pi-source-sessions/session.jsonl',
      cwd: input.cwd?.trim() || process.cwd(),
      viewKind: input.mode === 'workspace' ? 'workspace' : 'session',
      ...(input.mode === 'workspace' && input.cwd?.trim() ? { workspacePath: input.cwd.trim() } : {}),
      isNewSession: !input.sessionPath?.trim(),
    }),
    recordConversationStart: () => {},
    ...overrides,
  }
}

function createDeps(overrides: TestDepsOverrides = {}): ClientMessageHandlerDeps {
  const { sessions, ...rest } = overrides
  return {
    port: 47831,
    sourceSessionsDir: '/tmp/pi-source-sessions',
    sessions: createSessions(sessions),
    piRunners: {
      list: () => [],
      snapshot: () => undefined,
      start: async () => {},
      prompt: () => {},
      abort: () => {},
      getState: async () => ({ sessionPath: '/tmp/state.jsonl', sessionName: 'State' }),
      shutdownConversation: () => {},
      shutdownWorkspace: () => 0,
    },
    ...rest,
  }
}

describe('backend protocol helpers', () => {
  it('shuts down runners when conversations or workspaces are removed', async () => {
    const shutdowns: string[] = []
    const shutdownWorkspaces: string[] = []
    const sent: Record<string, unknown>[] = []
    const dispatch = createClientMessageDispatcher(
      createDeps({
        piRunners: {
          list: () => [],
          snapshot: () => undefined,
          start: async () => {},
          prompt: () => {},
          abort: () => {},
          getState: async () => ({ sessionPath: '/tmp/state.jsonl', sessionName: 'State' }),
          shutdownConversation: (conversationId) => shutdowns.push(conversationId),
          shutdownWorkspace: (workspacePath) => {
            shutdownWorkspaces.push(workspacePath)
            return 2
          },
        },
      }),
    )

    await dispatch('{"type":"delete_conversation","conversationId":"conv-1"}', (payload) => sent.push(payload))
    await dispatch(
      '{"type":"delete_workspace","workspacePath":"/tmp/project"}',
      (payload) => sent.push(payload),
    )

    expect(shutdowns).toEqual(['conv-1'])
    expect(shutdownWorkspaces).toEqual(['/tmp/project'])
    expect(sent.at(-1)).toEqual({ type: 'workspace:deleted', workspacePath: '/tmp/project', deletedCount: 2 })
  })

  it('resolves start state from the target runner', async () => {
    const sent: Record<string, unknown>[] = []
    const dispatch = createClientMessageDispatcher(createDeps())

    await dispatch(
      '{"type":"start","conversationId":"conv-1","requestId":"start-1","cwd":"/tmp/project","mode":"workspace"}',
      (payload) => sent.push(payload),
    )

    expect(sent[0]).toEqual({
      type: 'pi:started',
      requestId: 'start-1',
      conversationId: 'conv-1',
      sessionPath: '/tmp/state.jsonl',
      sessionName: 'State',
    })
  })
})
