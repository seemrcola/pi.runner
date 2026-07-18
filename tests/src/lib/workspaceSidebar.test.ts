import { describe, expect, it } from 'vitest'
import type { Conversation } from '@shared/chat'
import { groupConversationsByWorkspace } from '../../../src/lib/sidebarGroups'
import {
  buildWorkspaceSidebarGroups,
  toggleWorkspacePinned,
} from '../../../src/lib/workspaceSidebar'

function conversation(id: string, workspacePath?: string): Conversation {
  return {
    id,
    title: id,
    messages: [],
    sessionPath: null,
    kind: 'workspace',
    workspacePath,
    createdAt: Date.now(),
  }
}

describe('workspace sidebar helpers', () => {
  it('keeps pinned workspaces above unpinned groups and preserves display labels', () => {
    const groups = groupConversationsByWorkspace(
      [
        conversation('a', '/Users/example/project-a'),
        conversation('b', '/Users/example/project-b'),
        conversation('c', '/Users/example/project-c'),
      ],
      new Set(['/Users/example/project-b']),
    )

    const next = buildWorkspaceSidebarGroups(groups, {
      pinnedWorkspaces: new Set(['/Users/example/project-b']),
    })

    expect(next.map((group) => [group.workspacePath, group.label, group.isPinned])).toEqual([
      ['/Users/example/project-b', 'project-b', true],
      ['/Users/example/project-a', 'project-a', false],
      ['/Users/example/project-c', 'project-c', false],
    ])
  })

  it('toggles pinned workspaces without mutating the original state', () => {
    const pinned = new Set(['/Users/example/project-a'])

    expect([...toggleWorkspacePinned(pinned, '/Users/example/project-a')]).toEqual([])
    expect([...toggleWorkspacePinned(pinned, '/Users/example/project-b')].sort()).toEqual([
      '/Users/example/project-a',
      '/Users/example/project-b',
    ])
    expect([...pinned]).toEqual(['/Users/example/project-a'])
  })

  it('groups equivalent workspace path spellings together', () => {
    const groups = groupConversationsByWorkspace(
      [
        conversation('a', '/Users/example/project-a'),
        conversation('b', '/Users/example/project-a/'),
        conversation('c', '/Users/example/project-a/../project-a'),
      ],
      new Set(['/Users/example/project-a/']),
    )

    expect(groups).toMatchObject([
      {
        workspacePath: '/Users/example/project-a',
        label: 'project-a',
        conversations: [
          expect.objectContaining({ id: 'a', workspacePath: '/Users/example/project-a' }),
          expect.objectContaining({ id: 'b', workspacePath: '/Users/example/project-a' }),
          expect.objectContaining({ id: 'c', workspacePath: '/Users/example/project-a' }),
        ],
        isCollapsed: false,
      },
    ])
  })

})
