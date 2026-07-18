import { describe, expect, it } from 'vitest'
import {
  ensureWorkspaceExpanded,
  groupConversationsByWorkspace,
  toggleWorkspaceExpanded,
} from '../../../src/lib/sidebarGroups'
import type { Conversation } from '@shared/chat'

function conversation(id: string, workspacePath?: string): Conversation {
  return {
    id,
    title: id,
    messages: [],
    sessionPath: `/tmp/${id}.jsonl`,
    kind: 'workspace',
    workspacePath,
    createdAt: Date.now(),
  }
}

describe('sidebar groups', () => {
  it('groups conversations by workspace and marks groups collapsed by default', () => {
    const groups = groupConversationsByWorkspace(
      [
        conversation('a', '/Users/example/project-a'),
        conversation('b', '/Users/example/project-a'),
        conversation('c', '/Users/example/project-b'),
      ],
      new Set(),
    )

    expect(groups.map((group) => [group.workspacePath, group.label, group.isCollapsed, group.conversations.length])).toEqual([
      ['/Users/example/project-a', 'project-a', true, 2],
      ['/Users/example/project-b', 'project-b', true, 1],
    ])
  })

  it('toggles one workspace expanded state without mutating the original set', () => {
    const expanded = new Set(['/Users/example/project-a'])

    expect([...toggleWorkspaceExpanded(expanded, '/Users/example/project-a')]).toEqual([])
    expect([...toggleWorkspaceExpanded(expanded, '/Users/example/project-b')].sort()).toEqual([
      '/Users/example/project-a',
      '/Users/example/project-b',
    ])
    expect([...expanded]).toEqual(['/Users/example/project-a'])
  })

  it('ensures a workspace is expanded without collapsing already-expanded workspaces', () => {
    const expanded = new Set(['/Users/example/project-a'])

    expect([...ensureWorkspaceExpanded(expanded, '/Users/example/project-a')]).toEqual([
      '/Users/example/project-a',
    ])
    expect([...ensureWorkspaceExpanded(expanded, '/Users/example/project-b')].sort()).toEqual([
      '/Users/example/project-a',
      '/Users/example/project-b',
    ])
    expect([...expanded]).toEqual(['/Users/example/project-a'])
  })

  it('does not group root session conversations as workspaces even when they have cwd metadata', () => {
    const session = {
      ...conversation('session', '/Users/example/project-a'),
      kind: 'session' as const,
    }

    expect(groupConversationsByWorkspace([session], new Set())).toEqual([])
  })

  it('groups sessions by cwd-derived workspace path', () => {
    const session = {
      ...conversation('session-a'),
      workspacePath: '/Users/example/project-a',
    }

    expect(groupConversationsByWorkspace([session], new Set())).toEqual([
      {
        workspacePath: '/Users/example/project-a',
        label: 'project-a',
        conversations: [session],
        isCollapsed: true,
      },
    ])
  })

  it('keeps optimistic workspace conversations visible before a session path is assigned', () => {
    const optimisticConversation = {
      ...conversation('optimistic', '/Users/example/project-a'),
      sessionPath: null,
    }

    expect(groupConversationsByWorkspace([optimisticConversation], new Set())).toEqual([
      {
        workspacePath: '/Users/example/project-a',
        label: 'project-a',
        conversations: [optimisticConversation],
        isCollapsed: true,
      },
    ])
  })
})
