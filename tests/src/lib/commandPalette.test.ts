import { describe, expect, it } from 'vitest'
import {
  buildCommandPaletteItems,
  filterCommandPaletteItems,
  type CommandPaletteActionId,
} from '@/lib/commandPalette'
import type { Conversation } from '@shared/chat'

function conversation(
  id: string,
  title: string,
  kind: Conversation['kind'],
  workspacePath = '',
): Conversation {
  return {
    id,
    title,
    kind,
    workspacePath,
    messages: [],
    turns: [],
    sessionPath: null,
    createdAt: 1,
  }
}

describe('command palette', () => {
  it('builds app actions and conversation switch actions with stable ids', () => {
    const items = buildCommandPaletteItems({
      conversations: [
        conversation('session-1', 'Review architecture notes', 'session'),
        conversation('workspace-1', 'Fix runner leak', 'workspace', '/Users/me/project'),
      ],
      conversationStatuses: {
        'session-1': 'idle',
        'workspace-1': 'running',
      },
      isConnected: true,
      activeTaskCount: 0,
      isHistorySyncing: false,
    })

    expect(items.map((item) => item.id)).toEqual([
      'new-conversation',
      'start-session-only',
      'choose-workspace',
      'refresh-history',
      'open-settings',
      'switch:session-1',
      'switch:workspace-1',
    ])
    expect(items.find((item) => item.id === 'switch:workspace-1')).toMatchObject({
      title: 'Fix runner leak',
      subtitle: '/Users/me/project',
      keywords: expect.arrayContaining(['running', '/Users/me/project']),
      actionId: 'switch-conversation' satisfies CommandPaletteActionId,
      conversationId: 'workspace-1',
    })
  })

  it('marks connection-dependent commands disabled when backend is disconnected', () => {
    const items = buildCommandPaletteItems({
      conversations: [],
      conversationStatuses: {},
      isConnected: false,
      activeTaskCount: 0,
      isHistorySyncing: false,
    })

    expect(items.find((item) => item.id === 'start-session-only')).toMatchObject({
      disabled: true,
      disabledReason: '后端未连接',
    })
    expect(items.find((item) => item.id === 'refresh-history')).toMatchObject({
      disabled: true,
      disabledReason: '后端未连接',
    })
    expect(items.find((item) => item.id === 'open-settings')?.disabled).toBe(false)
  })

  it('disables history refresh while tasks run or another refresh is pending', () => {
    const running = buildCommandPaletteItems({
      conversations: [],
      conversationStatuses: {},
      isConnected: true,
      activeTaskCount: 1,
      isHistorySyncing: false,
    })
    const syncing = buildCommandPaletteItems({
      conversations: [],
      conversationStatuses: {},
      isConnected: true,
      activeTaskCount: 0,
      isHistorySyncing: true,
    })

    expect(running.find((item) => item.id === 'refresh-history')).toMatchObject({
      disabled: true,
      disabledReason: '任务运行中',
    })
    expect(syncing.find((item) => item.id === 'refresh-history')).toMatchObject({
      disabled: true,
      disabledReason: '正在刷新',
    })
  })

  it('filters by title, workspace path, group and runtime status', () => {
    const items = buildCommandPaletteItems({
      conversations: [
        conversation('a', 'Plan release', 'session'),
        conversation('b', 'Repair websocket stream', 'workspace', '/Users/me/pi-desktop-mvp'),
      ],
      conversationStatuses: {
        a: 'idle',
        b: 'error',
      },
      isConnected: true,
      activeTaskCount: 0,
      isHistorySyncing: false,
    })

    expect(filterCommandPaletteItems(items, 'websocket').map((item) => item.id)).toEqual(['switch:b'])
    expect(filterCommandPaletteItems(items, 'pi-desktop').map((item) => item.id)).toEqual(['switch:b'])
    expect(filterCommandPaletteItems(items, 'error').map((item) => item.id)).toEqual(['switch:b'])
    expect(filterCommandPaletteItems(items, 'settings').map((item) => item.id)).toEqual(['open-settings'])
  })
})
