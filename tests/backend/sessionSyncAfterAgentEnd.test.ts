import { describe, expect, it } from 'vitest'
import { syncSessionAfterAgentEnd } from '../../backend/events/agentEndSessionSync.js'
import { createBackendEventBus } from '../../backend/events/bus.js'
import { createAgentEndSessionSyncSubscriber } from '../../backend/events/subscribers.js'

describe('session sync after agent end', () => {
  it('syncs only the ended conversation session and broadcasts the refreshed list', () => {
    const syncedPaths: string[] = []
    const broadcasts: Record<string, unknown>[] = []

    syncSessionAfterAgentEnd(
      {
        type: 'pi:agent_end',
        conversationId: 'conv-1',
      },
      {
        piRunners: {
          snapshot: (conversationId) => conversationId === 'conv-1'
            ? {
                conversationId,
                phase: 'idle',
                sessionPath: '/tmp/pi-source-sessions/conv-1.jsonl',
                createdAt: 1,
                lastActiveAt: 2,
              }
            : undefined,
        },
        sessions: {
          syncSession: (sessionPath) => {
            syncedPaths.push(sessionPath)
            return { indexed: 1, removed: 0, skipped: 0, failed: 0 }
          },
          listConversations: () => [
            {
              id: 'conv-1',
              title: 'Updated',
              messages: [],
              sessionPath: '/tmp/pi-source-sessions/conv-1.jsonl',
              createdAt: 1,
            },
          ],
        },
        broadcast: (payload) => broadcasts.push(payload),
      },
    )

    expect(syncedPaths).toEqual(['/tmp/pi-source-sessions/conv-1.jsonl'])
    expect(broadcasts).toEqual([
      {
        type: 'source_sessions:synced',
        result: { indexed: 1, removed: 0, skipped: 0, failed: 0 },
      },
      {
        type: 'conversations:list',
        conversations: [
          {
            id: 'conv-1',
            title: 'Updated',
            messages: [],
            sessionPath: '/tmp/pi-source-sessions/conv-1.jsonl',
            createdAt: 1,
          },
        ],
      },
    ])
  })

  it('publishes the refreshed projection before the agent_end that can trigger a follow-up', () => {
    const receivedTypes: string[] = []
    const projectionSubscriber = createAgentEndSessionSyncSubscriber({
      piRunners: {
        snapshot: () => ({
          conversationId: 'conv-1',
          phase: 'idle',
          sessionPath: '/tmp/pi-source-sessions/conv-1.jsonl',
          createdAt: 1,
          lastActiveAt: 2,
        }),
      },
      sessions: {
        syncSession: () => ({ indexed: 1, removed: 0, skipped: 0, failed: 0 }),
        listConversations: () => [{
          id: 'conv-1',
          title: 'Updated',
          messages: [],
          sessionPath: '/tmp/pi-source-sessions/conv-1.jsonl',
          createdAt: 1,
        }],
      },
    })
    const bus = createBackendEventBus([
      projectionSubscriber,
      (payload) => receivedTypes.push(payload.type),
    ])

    bus.emit({ type: 'pi:agent_end', conversationId: 'conv-1' })

    expect(receivedTypes).toEqual([
      'source_sessions:synced',
      'conversations:list',
      'pi:agent_end',
    ])
  })

  it('does not sync retrying agent attempts', () => {
    const syncedPaths: string[] = []

    syncSessionAfterAgentEnd(
      {
        type: 'pi:agent_end',
        conversationId: 'conv-1',
        willRetry: true,
      },
      {
        piRunners: {
          snapshot: () => ({
            conversationId: 'conv-1',
            phase: 'running',
            sessionPath: '/tmp/pi-source-sessions/conv-1.jsonl',
            createdAt: 1,
            lastActiveAt: 2,
          }),
        },
        sessions: {
          syncSession: (sessionPath) => {
            syncedPaths.push(sessionPath)
            return { indexed: 1, removed: 0, skipped: 0, failed: 0 }
          },
          listConversations: () => [],
        },
        broadcast: () => {},
      },
    )

    expect(syncedPaths).toEqual([])
  })

  it('reports projection failures without throwing through the event callback', () => {
    const broadcasts: Record<string, unknown>[] = []

    expect(() => syncSessionAfterAgentEnd(
      {
        type: 'pi:agent_end',
        conversationId: 'conv-1',
      },
      {
        piRunners: {
          snapshot: () => ({
            conversationId: 'conv-1',
            phase: 'idle',
            sessionPath: '/tmp/pi-source-sessions/conv-1.jsonl',
            createdAt: 1,
            lastActiveAt: 2,
          }),
        },
        sessions: {
          syncSession: () => {
            throw new Error('session file disappeared')
          },
          listConversations: () => [],
        },
        broadcast: (payload) => broadcasts.push(payload),
      },
    )).not.toThrow()

    expect(broadcasts).toEqual([
      {
        type: 'pi:error',
        conversationId: 'conv-1',
        message: 'session file disappeared',
      },
    ])
  })

  it('reports failed sync results without replacing the current projection', () => {
    const broadcasts: Record<string, unknown>[] = []

    syncSessionAfterAgentEnd(
      { type: 'pi:agent_end', conversationId: 'conv-1' },
      {
        piRunners: {
          snapshot: () => ({
            conversationId: 'conv-1',
            phase: 'idle',
            sessionPath: '/tmp/pi-source-sessions/conv-1.jsonl',
            createdAt: 1,
            lastActiveAt: 2,
          }),
        },
        sessions: {
          syncSession: () => ({ indexed: 0, removed: 0, skipped: 0, failed: 1 }),
          listConversations: () => {
            throw new Error('must keep the current renderer projection')
          },
        },
        broadcast: (payload) => broadcasts.push(payload),
      },
    )

    expect(broadcasts).toEqual([
      {
        type: 'pi:error',
        conversationId: 'conv-1',
        message: 'Session projection sync failed',
      },
    ])
  })
})
