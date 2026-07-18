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
    restoreConversation: () => {},
    restoreWorkspace: () => {},
    prepareConversationStart: (input) => {
      const viewKind = input.mode === 'workspace' ? 'workspace' : 'session'
      const cwd = input.cwd?.trim() || process.cwd()
      const workspacePath = viewKind === 'workspace' ? cwd : undefined
      return {
        conversationId: input.conversationId,
        sessionPath: input.sessionPath?.trim() || `/tmp/pi-source-sessions/${viewKind}-${cwd.split('/').pop() || 'home'}.jsonl`,
        cwd,
        viewKind,
        ...(workspacePath ? { workspacePath } : {}),
        isNewSession: !input.sessionPath?.trim(),
      }
    },
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
    settings: {
      snapshot: async () => ({
        pi: { installed: false },
        models: { path: '/tmp/.pi/agent/models.json', exists: false, content: '{\n}\n' },
        settings: { path: '/tmp/.pi/agent/settings.json', exists: false, content: '{\n}\n' },
        skills: [],
        install: { phase: 'idle' },
      }),
      saveModels: async (content) => ({
        pi: { installed: true, executablePath: '/usr/local/bin/pi' },
        models: { path: '/tmp/.pi/agent/models.json', exists: true, content },
        settings: { path: '/tmp/.pi/agent/settings.json', exists: false, content: '{\n}\n' },
        skills: [],
        install: { phase: 'idle' },
      }),
      saveSettings: async (content) => ({
        pi: { installed: true, executablePath: '/usr/local/bin/pi' },
        models: { path: '/tmp/.pi/agent/models.json', exists: false, content: '{\n}\n' },
        settings: { path: '/tmp/.pi/agent/settings.json', exists: true, content },
        skills: [],
        install: { phase: 'idle' },
      }),
      installPi: async () => ({
        pi: { installed: true, executablePath: '/usr/local/bin/pi' },
        models: { path: '/tmp/.pi/agent/models.json', exists: false, content: '{\n}\n' },
        settings: { path: '/tmp/.pi/agent/settings.json', exists: false, content: '{\n}\n' },
        skills: [],
        install: { phase: 'succeeded', output: 'installed' },
      }),
    },
    piRunners: {
      list: () => [],
      snapshot: () => undefined,
      start: async () => {},
      prompt: () => {},
      abort: () => {},
      setActiveConversation: () => {},
      getState: async () => ({}),
      shutdownConversation: () => {},
      shutdownWorkspace: () => 0,
    },
    ...rest,
  }
}

describe('client message dispatcher', () => {
  it('forwards the active conversation identity to runner management', async () => {
    const activeConversationIds: Array<[string, string | null]> = []
    const deps = createDeps()
    deps.piRunners.setActiveConversation = (clientId, conversationId) => {
      activeConversationIds.push([clientId, conversationId])
    }
    const dispatch = createClientMessageDispatcher(deps)

    await dispatch('{"type":"set_active_conversation","conversationId":"conversation-a"}', () => {})
    await dispatch('{"type":"set_active_conversation","conversationId":null}', () => {})

    expect(activeConversationIds).toEqual([
      ['default-client', 'conversation-a'],
      ['default-client', null],
    ])
  })

  it('rejects invalid websocket payloads without throwing', async () => {
    const sent: Record<string, unknown>[] = []
    const dispatch = createClientMessageDispatcher(createDeps())

    await dispatch('not-json', (payload) => sent.push(payload))

    expect(sent).toEqual([{ type: 'pi:error', message: 'Invalid client message' }])
  })

  it('dispatches valid messages through a handler map', async () => {
    const sent: Record<string, unknown>[] = []
    const dispatch = createClientMessageDispatcher(createDeps())

    await dispatch('{"type":"ping"}', (payload) => sent.push(payload))

    expect(sent).toEqual([{ type: 'backend:pong' }])
  })

  it('lists conversations through injected dependencies', async () => {
    const sent: Record<string, unknown>[] = []
    const dispatch = createClientMessageDispatcher(
      createDeps({
        sessions: {
          listConversations: () => [
          {
            id: 'c1',
            title: 'Existing',
            messages: [],
            sessionPath: '/tmp/session.jsonl',
            createdAt: 1,
          },
          ],
        },
      }),
    )

    await dispatch('{"type":"list_conversations"}', (payload) => sent.push(payload))

    expect(sent).toEqual([
      {
        type: 'conversations:list',
        conversations: [
          {
            id: 'c1',
            title: 'Existing',
            messages: [],
            sessionPath: '/tmp/session.jsonl',
            createdAt: 1,
          },
        ],
      },
    ])
  })

  it('lists runner snapshots through the runner manager', async () => {
    const sent: Record<string, unknown>[] = []
    const dispatch = createClientMessageDispatcher(
      createDeps({
        piRunners: {
          list: () => [
            {
              conversationId: 'conv-1',
              phase: 'running',
              cwd: '/tmp/project',
              sessionPath: '/tmp/session.jsonl',
              createdAt: 1,
              lastActiveAt: 2,
            },
          ],
          snapshot: () => undefined,
          start: async () => {},
          prompt: () => {},
          abort: () => {},
          getState: async () => ({}),
          shutdownConversation: () => {},
          shutdownWorkspace: () => 0,
        },
      }),
    )

    await dispatch('{"type":"list_runners"}', (payload) => sent.push(payload))

    expect(sent).toEqual([
      {
        type: 'runner:list',
        runners: [
          {
            conversationId: 'conv-1',
            phase: 'running',
            cwd: '/tmp/project',
            sessionPath: '/tmp/session.jsonl',
            createdAt: 1,
            lastActiveAt: 2,
          },
        ],
      },
    ])
  })

  it('serves settings snapshots and saves model config through the settings service', async () => {
    const sent: Record<string, unknown>[] = []
    const savedContent: string[] = []
    const dispatch = createClientMessageDispatcher(
      createDeps({
        settings: {
          snapshot: async () => ({
            pi: { installed: true, executablePath: '/opt/homebrew/bin/pi' },
            models: { path: '/Users/example/.pi/agent/models.json', exists: true, content: '{"models":[]}\n' },
            settings: { path: '/Users/example/.pi/agent/settings.json', exists: true, content: '{"skills":[]}\n' },
            skills: [
              {
                name: 'reviewer',
                path: '/Users/example/.pi/agent/skills/reviewer/SKILL.md',
                description: 'Review code',
                source: 'agent',
              },
            ],
            install: { phase: 'idle' },
          }),
          saveModels: async (content) => {
            savedContent.push(content)
            return {
              pi: { installed: true, executablePath: '/opt/homebrew/bin/pi' },
              models: { path: '/Users/example/.pi/agent/models.json', exists: true, content },
              settings: { path: '/Users/example/.pi/agent/settings.json', exists: true, content: '{"skills":[]}\n' },
              skills: [],
              install: { phase: 'idle' },
            }
          },
          saveSettings: async () => {
            throw new Error('not used')
          },
          installPi: async () => {
            throw new Error('not used')
          },
        },
      }),
    )

    await dispatch('{"type":"settings:get"}', (payload) => sent.push(payload))
    await dispatch(
      JSON.stringify({ type: 'settings:save_models', content: '{"models":["openai/gpt-5"]}\n' }),
      (payload) => sent.push(payload),
    )

    expect(savedContent).toEqual(['{"models":["openai/gpt-5"]}\n'])
    expect(sent).toEqual([
      {
        type: 'settings:snapshot',
        snapshot: {
          pi: { installed: true, executablePath: '/opt/homebrew/bin/pi' },
          models: { path: '/Users/example/.pi/agent/models.json', exists: true, content: '{"models":[]}\n' },
          settings: { path: '/Users/example/.pi/agent/settings.json', exists: true, content: '{"skills":[]}\n' },
          skills: [
            {
              name: 'reviewer',
              path: '/Users/example/.pi/agent/skills/reviewer/SKILL.md',
              description: 'Review code',
              source: 'agent',
            },
          ],
          install: { phase: 'idle' },
        },
      },
      {
        type: 'settings:snapshot',
        snapshot: {
          pi: { installed: true, executablePath: '/opt/homebrew/bin/pi' },
          models: {
            path: '/Users/example/.pi/agent/models.json',
            exists: true,
            content: '{"models":["openai/gpt-5"]}\n',
          },
          settings: { path: '/Users/example/.pi/agent/settings.json', exists: true, content: '{"skills":[]}\n' },
          skills: [],
          install: { phase: 'idle' },
        },
      },
    ])
  })

  it('saves settings.json through the settings service', async () => {
    const sent: Record<string, unknown>[] = []
    const savedContent: string[] = []
    const dispatch = createClientMessageDispatcher(
      createDeps({
        settings: {
          snapshot: async () => {
            throw new Error('not used')
          },
          saveModels: async () => {
            throw new Error('not used')
          },
          saveSettings: async (content) => {
            savedContent.push(content)
            return {
              pi: { installed: true, executablePath: '/opt/homebrew/bin/pi' },
              models: { path: '/Users/example/.pi/agent/models.json', exists: true, content: '{"models":[]}\n' },
              settings: { path: '/Users/example/.pi/agent/settings.json', exists: true, content },
              skills: [],
              install: { phase: 'idle' },
            }
          },
          installPi: async () => {
            throw new Error('not used')
          },
        },
      }),
    )

    await dispatch(
      JSON.stringify({ type: 'settings:save_settings', content: '{"skills":["~/custom-skills"]}\n' }),
      (payload) => sent.push(payload),
    )

    expect(savedContent).toEqual(['{"skills":["~/custom-skills"]}\n'])
    expect(sent).toEqual([
      {
        type: 'settings:snapshot',
        snapshot: {
          pi: { installed: true, executablePath: '/opt/homebrew/bin/pi' },
          models: { path: '/Users/example/.pi/agent/models.json', exists: true, content: '{"models":[]}\n' },
          settings: {
            path: '/Users/example/.pi/agent/settings.json',
            exists: true,
            content: '{"skills":["~/custom-skills"]}\n',
          },
          skills: [],
          install: { phase: 'idle' },
        },
      },
    ])
  })

  it('returns settings errors without routing them into a conversation', async () => {
    const sent: Record<string, unknown>[] = []
    const dispatch = createClientMessageDispatcher(
      createDeps({
        settings: {
          snapshot: async () => {
            throw new Error('models.json 不是有效 JSON')
          },
          saveModels: async () => {
            throw new Error('not used')
          },
          installPi: async () => {
            throw new Error('not used')
          },
        },
      }),
    )

    await dispatch('{"type":"settings:get"}', (payload) => sent.push(payload))

    expect(sent).toEqual([{ type: 'settings:error', message: 'models.json 不是有效 JSON' }])
  })

  it('syncs source sessions into the sqlite index before listing conversations', async () => {
    const sent: Record<string, unknown>[] = []
    const calls: string[] = []
    const dispatch = createClientMessageDispatcher(
      createDeps({
        sessions: {
          sync: () => {
            calls.push('sync')
            return { indexed: 1, removed: 0, skipped: 2, failed: 0 }
          },
          recordViewOverride: () => {},
          recordSessionPlaceholder: () => {},
          hideSession: () => {},
          hideConversation: () => {},
          hideWorkspace: () => {},
          listConversations: () => {
            calls.push('list')
            return [
              {
                id: 'c1',
                title: 'Synced',
                messages: [],
                sessionPath: '/tmp/pi-source-sessions/session.jsonl',
                createdAt: 1,
              },
            ]
          },
        },
      }),
    )

    await dispatch('{"type":"sync_source_sessions","requestId":"sync-1"}', (payload) => sent.push(payload))

    expect(calls).toEqual(['sync', 'list'])
    expect(sent).toEqual([
      { type: 'source_sessions:synced', requestId: 'sync-1', result: { indexed: 1, removed: 0, skipped: 2, failed: 0 } },
      {
        type: 'conversations:list',
        conversations: [
          {
            id: 'c1',
            title: 'Synced',
            messages: [],
            sessionPath: '/tmp/pi-source-sessions/session.jsonl',
            createdAt: 1,
          },
        ],
      },
    ])
  })

  it.each(['starting', 'running', 'stopping'] as const)(
    'rejects source session sync while a runner is %s',
    async (phase) => {
      const sent: Record<string, unknown>[] = []
      let syncCalls = 0
      const dispatch = createClientMessageDispatcher(createDeps({
        sessions: {
          sync: () => {
            syncCalls += 1
            return { indexed: 0, removed: 0, skipped: 0, failed: 0 }
          },
        },
        piRunners: {
          ...createDeps().piRunners,
          list: () => [{
            conversationId: 'active',
            phase,
            createdAt: 1,
            lastActiveAt: 2,
          }],
        },
      }))

      await dispatch('{"type":"sync_source_sessions","requestId":"sync-active"}', (payload) => sent.push(payload))

      expect(syncCalls).toBe(0)
      expect(sent).toEqual([{
        type: 'source_sessions:error',
        requestId: 'sync-active',
        message: '任务运行中，暂时无法刷新历史',
      }])
    },
  )

  it('records explicit desktop view metadata and placeholders when starting sessions', async () => {
    const overrides: Array<{ sessionPath: string; viewKind: 'session' | 'workspace'; workspacePath?: string }> = []
    const placeholders: Array<{
      id: string
      sessionPath: string
      viewKind: 'session' | 'workspace'
      workspacePath?: string
    }> = []
    const sent: Record<string, unknown>[] = []
    const dispatch = createClientMessageDispatcher(
      createDeps({
        sessions: {
          recordViewOverride: (sessionPath, viewKind, workspacePath) => {
            overrides.push({ sessionPath, viewKind, ...(workspacePath ? { workspacePath } : {}) })
          },
          recordSessionPlaceholder: (placeholder) => {
            placeholders.push({
              id: placeholder.id,
              sessionPath: placeholder.sessionPath,
              viewKind: placeholder.viewKind,
              ...(placeholder.workspacePath ? { workspacePath: placeholder.workspacePath } : {}),
            })
          },
          recordConversationStart: (start) => {
            if (start.isNewSession) {
              placeholders.push({
                id: start.conversationId,
                sessionPath: start.sessionPath,
                viewKind: start.viewKind,
                ...(start.workspacePath ? { workspacePath: start.workspacePath } : {}),
              })
            }
            overrides.push({
              sessionPath: start.sessionPath,
              viewKind: start.viewKind,
              ...(start.workspacePath ? { workspacePath: start.workspacePath } : {}),
            })
          },
        },
        piRunners: {
          list: () => [],
          snapshot: () => undefined,
          start: async () => {},
          prompt: () => {},
          abort: () => {},
          getState: async () => ({}),
          shutdownConversation: () => {},
          shutdownWorkspace: () => 0,
        },
      }),
    )

    await dispatch(
      JSON.stringify({
        type: 'start',
        requestId: 'session-start',
        conversationId: 'session-conv',
        cwd: '/Users/example',
        mode: 'session',
      }),
      (payload) => sent.push(payload),
    )
    await dispatch(
      JSON.stringify({
        type: 'start',
        requestId: 'workspace-start',
        conversationId: 'workspace-conv',
        cwd: '/Users/example',
        mode: 'workspace',
      }),
      (payload) => sent.push(payload),
    )

    expect(overrides).toEqual([
      {
        sessionPath: '/tmp/pi-source-sessions/session-example.jsonl',
        viewKind: 'session',
      },
      {
        sessionPath: '/tmp/pi-source-sessions/workspace-example.jsonl',
        viewKind: 'workspace',
        workspacePath: '/Users/example',
      },
    ])
    expect(placeholders).toEqual([
      {
        id: 'session-conv',
        sessionPath: '/tmp/pi-source-sessions/session-example.jsonl',
        viewKind: 'session',
      },
      {
        id: 'workspace-conv',
        sessionPath: '/tmp/pi-source-sessions/workspace-example.jsonl',
        viewKind: 'workspace',
        workspacePath: '/Users/example',
      },
    ])
  })

  it('does not overwrite indexed session rows with placeholders when continuing existing sessions', async () => {
    const placeholders: string[] = []
    const sent: Record<string, unknown>[] = []
    const dispatch = createClientMessageDispatcher(
      createDeps({
        sessions: {
          sync: () => ({ indexed: 0, removed: 0, skipped: 0, failed: 0 }),
          listConversations: () => [],
          recordViewOverride: () => {},
          recordSessionPlaceholder: (placeholder) => placeholders.push(placeholder.sessionPath),
          hideSession: () => {},
          hideConversation: () => {},
          hideWorkspace: () => {},
        },
      }),
    )

    await dispatch(
      JSON.stringify({
        type: 'start',
        requestId: 'continue-start',
        conversationId: 'existing-conv',
        sessionPath: '/tmp/pi-source-sessions/existing.jsonl',
        cwd: '/Users/example',
        mode: 'session',
      }),
      (payload) => sent.push(payload),
    )

    expect(placeholders).toEqual([])
    expect(sent[0]).toMatchObject({
      type: 'pi:started',
      requestId: 'continue-start',
      conversationId: 'existing-conv',
    })
  })

  it('records logical deletes in the sqlite index', async () => {
    const sent: Record<string, unknown>[] = []
    const hiddenSessions: string[] = []
    const hiddenConversations: Array<{ conversationId: string; sessionPath?: string | null }> = []
    const hiddenWorkspaces: string[] = []
    const shutdownWorkspaces: string[] = []
    const dispatch = createClientMessageDispatcher(
      createDeps({
        sessions: {
          sync: () => ({ indexed: 0, removed: 0, skipped: 0, failed: 0 }),
          listConversations: () => [],
          recordViewOverride: () => {},
          recordSessionPlaceholder: () => {},
          hideSession: (sessionPath) => hiddenSessions.push(sessionPath),
          hideConversation: (conversationId, sessionPath) => hiddenConversations.push({ conversationId, sessionPath }),
          hideWorkspace: (workspacePath) => hiddenWorkspaces.push(workspacePath),
        },
        piRunners: {
          ...createDeps().piRunners,
          shutdownWorkspace: (workspacePath) => {
            shutdownWorkspaces.push(workspacePath)
            return 2
          },
        },
      }),
    )

    await dispatch(
      '{"type":"delete_conversation","requestId":"delete-1","conversationId":"conv-1","sessionPath":"/tmp/pi-source-sessions/session.jsonl"}',
      (payload) => sent.push(payload),
    )
    await dispatch(
      '{"type":"delete_conversation","sessionPath":"/tmp/pi-source-sessions/orphan.jsonl"}',
      () => {},
    )
    await dispatch(
      '{"type":"delete_workspace","requestId":"delete-workspace-1","workspacePath":"/tmp/project"}',
      (payload) => sent.push(payload),
    )

    expect(hiddenSessions).toEqual(['/tmp/pi-source-sessions/orphan.jsonl'])
    expect(hiddenConversations).toEqual([
      { conversationId: 'conv-1', sessionPath: '/tmp/pi-source-sessions/session.jsonl' },
    ])
    expect(hiddenWorkspaces).toEqual(['/tmp/project'])
    expect(shutdownWorkspaces).toEqual(['/tmp/project'])
    expect(sent).toContainEqual({
      type: 'conversation:deleted',
      requestId: 'delete-1',
      sessionPath: '/tmp/pi-source-sessions/session.jsonl',
    })
    expect(sent).toContainEqual({
      type: 'workspace:deleted',
      requestId: 'delete-workspace-1',
      workspacePath: '/tmp/project',
      deletedCount: 2,
    })
  })

  it('restores hidden metadata and lists conversations without starting runners', async () => {
    const restoredConversations: Array<{ conversationId: string; sessionPath?: string | null }> = []
    const restoredWorkspaces: string[] = []
    const sent: Record<string, unknown>[] = []
    let startCalls = 0
    const dispatch = createClientMessageDispatcher(createDeps({
      sessions: {
        restoreConversation: (conversationId, sessionPath) => restoredConversations.push({ conversationId, sessionPath }),
        restoreWorkspace: (workspacePath) => restoredWorkspaces.push(workspacePath),
        listConversations: () => [],
      },
      piRunners: {
        ...createDeps().piRunners,
        start: async () => { startCalls += 1 },
      },
    }))

    await dispatch(
      '{"type":"restore_conversation","requestId":"restore-1","conversationId":"c1","sessionPath":null}',
      (payload) => sent.push(payload),
    )
    await dispatch(
      '{"type":"restore_workspace","requestId":"restore-2","workspacePath":"/tmp/project/"}',
      (payload) => sent.push(payload),
    )

    expect(restoredConversations).toEqual([{ conversationId: 'c1', sessionPath: null }])
    expect(restoredWorkspaces).toEqual(['/tmp/project'])
    expect(startCalls).toBe(0)
    expect(sent).toEqual([
      { type: 'conversation:restored', requestId: 'restore-1', conversationId: 'c1' },
      { type: 'conversations:list', conversations: [] },
      { type: 'workspace:restored', requestId: 'restore-2', workspacePath: '/tmp/project' },
      { type: 'conversations:list', conversations: [] },
    ])
  })

  it.each(['starting', 'running', 'stopping'] as const)(
    'rejects conversation removal while its runner is %s',
    async (phase) => {
      const sent: Record<string, unknown>[] = []
      const hidden: string[] = []
      const shutdown: string[] = []
      const dispatch = createClientMessageDispatcher(createDeps({
        sessions: {
          hideConversation: (conversationId) => hidden.push(conversationId),
        },
        piRunners: {
          ...createDeps().piRunners,
          snapshot: (conversationId) => ({
            conversationId,
            phase,
            cwd: '/tmp/project',
            createdAt: 1,
            lastActiveAt: 2,
          }),
          shutdownConversation: (conversationId) => shutdown.push(conversationId),
        },
      }))

      await dispatch(
        '{"type":"delete_conversation","requestId":"delete-active","conversationId":"conv-1"}',
        (payload) => sent.push(payload),
      )

      expect(hidden).toEqual([])
      expect(shutdown).toEqual([])
      expect(sent).toEqual([{
        type: 'pi:error',
        requestId: 'delete-active',
        conversationId: 'conv-1',
        message: '任务进行中，停止后才能移除',
      }])
    },
  )

  it('rejects workspace removal while any runner in that workspace is active', async () => {
    const sent: Record<string, unknown>[] = []
    const hidden: string[] = []
    const shutdown: string[] = []
    const dispatch = createClientMessageDispatcher(createDeps({
      sessions: {
        hideWorkspace: (workspacePath) => hidden.push(workspacePath),
      },
      piRunners: {
        ...createDeps().piRunners,
        list: () => [{
          conversationId: 'conv-1',
          phase: 'running',
          cwd: '/tmp/project',
          createdAt: 1,
          lastActiveAt: 2,
        }],
        shutdownWorkspace: (workspacePath) => {
          shutdown.push(workspacePath)
          return 1
        },
      },
    }))

    await dispatch(
      '{"type":"delete_workspace","requestId":"delete-active-workspace","workspacePath":"/tmp/project"}',
      (payload) => sent.push(payload),
    )

    expect(hidden).toEqual([])
    expect(shutdown).toEqual([])
    expect(sent).toEqual([{
      type: 'pi:error',
      requestId: 'delete-active-workspace',
      message: '工作区有 1 个任务进行中，停止后才能移除',
    }])
  })

  it('rejects path-only removal when the session belongs to an active runner', async () => {
    const sent: Record<string, unknown>[] = []
    const hidden: string[] = []
    const dispatch = createClientMessageDispatcher(createDeps({
      sessions: {
        hideSession: (sessionPath) => hidden.push(sessionPath),
      },
      piRunners: {
        ...createDeps().piRunners,
        list: () => [{
          conversationId: 'conv-1',
          phase: 'running',
          sessionPath: '/tmp/pi-source-sessions/session.jsonl',
          createdAt: 1,
          lastActiveAt: 2,
        }],
      },
    }))

    await dispatch(
      '{"type":"delete_conversation","requestId":"delete-by-path","sessionPath":"/tmp/pi-source-sessions/session.jsonl"}',
      (payload) => sent.push(payload),
    )

    expect(hidden).toEqual([])
    expect(sent).toEqual([{
      type: 'pi:error',
      requestId: 'delete-by-path',
      message: '任务进行中，停止后才能移除',
    }])
  })

  it('lists and updates persisted workspace view states through sqlite', async () => {
    const sent: Record<string, unknown>[] = []
    const updates: Array<{ workspacePath: string; patch: { isPinned?: boolean; isCollapsed?: boolean } }> = []
    const dispatch = createClientMessageDispatcher(
      createDeps({
        sessions: {
          sync: () => ({ indexed: 0, removed: 0, skipped: 0, failed: 0 }),
          listConversations: () => [],
          recordViewOverride: () => {},
          recordSessionPlaceholder: () => {},
          listWorkspaceViewStates: () => [
            {
              workspacePath: '/tmp/project',
              isPinned: true,
              isCollapsed: false,
              pinnedAt: 10,
              updatedAt: 20,
            },
          ],
          upsertWorkspaceViewState: (workspacePath, patch) => {
            updates.push({ workspacePath, patch })
            return {
              workspacePath,
              isPinned: patch.isPinned ?? false,
              isCollapsed: patch.isCollapsed ?? false,
              pinnedAt: null,
              updatedAt: 30,
            }
          },
          hideSession: () => {},
          hideConversation: () => {},
          hideWorkspace: () => {},
        },
      }),
    )

    await dispatch('{"type":"list_workspace_view_states"}', (payload) => sent.push(payload))
    await dispatch(
      '{"type":"update_workspace_view_state","workspacePath":"/tmp/project","isPinned":false,"isCollapsed":true}',
      (payload) => sent.push(payload),
    )

    expect(updates).toEqual([
      { workspacePath: '/tmp/project', patch: { isPinned: false, isCollapsed: true } },
    ])
    expect(sent).toEqual([
      {
        type: 'workspace_view_states:list',
        states: [
          {
            workspacePath: '/tmp/project',
            isPinned: true,
            isCollapsed: false,
            pinnedAt: 10,
            updatedAt: 20,
          },
        ],
      },
      {
        type: 'workspace_view_state:updated',
          state: {
            workspacePath: '/tmp/project',
            isPinned: false,
            isCollapsed: true,
            pinnedAt: null,
            updatedAt: 30,
          },
        },
    ])
  })

  it('returns request context when a delete handler throws', async () => {
    const sent: Record<string, unknown>[] = []
    const dispatch = createClientMessageDispatcher(
      createDeps({
        sessions: {
          sync: () => ({ indexed: 0, removed: 0, skipped: 0, failed: 0 }),
          listConversations: () => [],
          recordViewOverride: () => {},
          recordSessionPlaceholder: () => {},
          hideSession: () => {},
          hideConversation: () => {
            throw new Error('sqlite unavailable')
          },
          hideWorkspace: () => {},
        },
      }),
    )

    await dispatch(
      '{"type":"delete_conversation","requestId":"delete-1","conversationId":"conv-1"}',
      (payload) => sent.push(payload),
    )

    expect(sent).toEqual([
      {
        type: 'pi:error',
        requestId: 'delete-1',
        conversationId: 'conv-1',
        message: 'sqlite unavailable',
      },
    ])
  })

  it('rejects removed slash command protocol messages', async () => {
    const sent: Record<string, unknown>[] = []
    const dispatch = createClientMessageDispatcher(createDeps())

    await dispatch(
      JSON.stringify({
        type: 'rpc_command',
        conversationId: 'c1',
        id: 'rpc-1',
        command: { type: 'custom' },
      }),
      (payload) => sent.push(payload),
    )

    expect(sent).toEqual([{ type: 'pi:error', message: 'Invalid client message' }])
  })

  it('rejects removed extension management protocol messages', async () => {
    const sent: Record<string, unknown>[] = []
    const dispatch = createClientMessageDispatcher(createDeps())

    await dispatch('{"type":"install_extension","source":"npm:test-extension"}', (payload) => sent.push(payload))

    expect(sent).toEqual([{ type: 'pi:error', message: 'Invalid client message' }])
  })

  it('routes prompt and abort through the runner manager syscalls', async () => {
    const promptCalls: Array<{
      conversationId: string
      id: string
      prompt: string
      streamingBehavior?: 'steer' | 'followUp'
      images?: Array<{ type: 'image'; data: string; mimeType: string }>
    }> = []
    const recordedImages: Array<{
      conversationId: string
      sessionPath?: string
      messageId: string
      promptText?: string
      images: Array<{ type: 'image'; data: string; mimeType: string }>
    }> = []
    const abortCalls: Array<{ conversationId: string; id: string }> = []
    const sent: Record<string, unknown>[] = []
    const piRunners = {
      list: () => [],
      snapshot: () => ({
        conversationId: 'conv-1',
        phase: 'running',
        sessionPath: '/tmp/pi-source-sessions/session.jsonl',
        createdAt: 1,
        lastActiveAt: 2,
      }),
      start: async () => {},
      prompt: (
        conversationId: string,
        id: string,
        prompt: string,
        streamingBehavior?: 'steer' | 'followUp',
        images?: Array<{ type: 'image'; data: string; mimeType: string }>,
      ) => {
        promptCalls.push({
          conversationId,
          id,
          prompt,
          ...(streamingBehavior ? { streamingBehavior } : {}),
          ...(images ? { images } : {}),
        })
      },
      abort: (conversationId: string, id: string) => {
        abortCalls.push({ conversationId, id })
      },
      getState: async () => ({}),
      shutdownConversation: () => {},
      shutdownWorkspace: () => 0,
    }
    const dispatch = createClientMessageDispatcher(
      createDeps({
        sessions: {
          recordMessageImages: (input) => recordedImages.push(input),
        },
        piRunners,
      }),
    )

    await dispatch(
      '{"type":"prompt","conversationId":"conv-1","id":"prompt-1","prompt":"hello","streamingBehavior":"steer","images":[{"type":"image","data":"abc123","mimeType":"image/png"}]}',
      (payload) => sent.push(payload),
    )
    await dispatch(
      '{"type":"abort","conversationId":"conv-1","id":"abort-1"}',
      (payload) => sent.push(payload),
    )

    expect(promptCalls).toEqual([{
      conversationId: 'conv-1',
      id: 'prompt-1',
      prompt: 'hello',
      streamingBehavior: 'steer',
      images: [{ type: 'image', data: 'abc123', mimeType: 'image/png' }],
    }])
    expect(recordedImages).toEqual([{
      conversationId: 'conv-1',
      sessionPath: '/tmp/pi-source-sessions/session.jsonl',
      messageId: 'prompt-1',
      promptText: 'hello',
      images: [{ type: 'image', data: 'abc123', mimeType: 'image/png' }],
    }])
    expect(abortCalls).toEqual([{ conversationId: 'conv-1', id: 'abort-1' }])
    expect(sent).toEqual([])
  })

  it('does not report prompt failure when desktop image projection persistence fails after pi accepts the prompt', async () => {
    const promptCalls: Array<{ conversationId: string; id: string; prompt: string }> = []
    const sent: Record<string, unknown>[] = []
    const dispatch = createClientMessageDispatcher(
      createDeps({
        piRunners: {
          list: () => [],
          snapshot: () => undefined,
          start: async () => {},
          prompt: (conversationId: string, id: string, prompt: string) => {
            promptCalls.push({ conversationId, id, prompt })
          },
          abort: () => {},
          getState: async () => ({}),
          shutdownConversation: () => {},
          shutdownWorkspace: () => 0,
        },
        sessions: {
          recordMessageImages: () => {
            throw new Error('disk full')
          },
        },
      }),
    )

    await dispatch(
      '{"type":"prompt","conversationId":"conv-1","id":"prompt-1","images":[{"type":"image","data":"abc123","mimeType":"image/png"}]}',
      (payload) => sent.push(payload),
    )

    expect(promptCalls).toEqual([{ conversationId: 'conv-1', id: 'prompt-1', prompt: 'Describe this image.' }])
    expect(sent).toEqual([])
  })
})
