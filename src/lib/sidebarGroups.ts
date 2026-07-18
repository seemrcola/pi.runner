import type { Conversation } from '@shared/chat'
import { normalizeWorkspacePath, normalizeWorkspacePathSet } from '@shared/workspacePaths'

export type SidebarConversationGroup = {
  workspacePath: string
  label: string
  conversations: Conversation[]
  isCollapsed: boolean
}

const UNKNOWN_WORKSPACE = 'Unknown workspace'

export function groupConversationsByWorkspace(
  conversations: Conversation[],
  expandedWorkspaces: ReadonlySet<string>,
): SidebarConversationGroup[] {
  const groups = new Map<string, Conversation[]>()
  const normalizedExpandedWorkspaces = normalizeWorkspacePathSet(expandedWorkspaces)
  for (const conversation of conversations) {
    if (conversation.kind !== 'workspace') continue
    if (!conversation.workspacePath) continue
    const workspacePath = normalizeWorkspacePath(conversation.workspacePath)
    if (!workspacePath) continue
    const normalizedConversation = { ...conversation, workspacePath }
    const groupedConversations = groups.get(workspacePath) ?? []
    groups.set(workspacePath, [...groupedConversations, normalizedConversation])
  }

  return [...groups.entries()].map(([workspacePath, groupedConversations]) => {
    return {
      workspacePath,
      label: workspaceLabel(workspacePath),
      conversations: groupedConversations,
      isCollapsed: !normalizedExpandedWorkspaces.has(workspacePath),
    }
  })
}

export function toggleWorkspaceExpanded(
  expandedWorkspaces: ReadonlySet<string>,
  workspacePath: string,
): Set<string> {
  const normalizedPath = normalizeWorkspacePath(workspacePath)
  const next = new Set(expandedWorkspaces)
  if (!normalizedPath) return next
  if (next.has(normalizedPath)) {
    next.delete(normalizedPath)
  } else {
    next.add(normalizedPath)
  }
  return next
}

export function ensureWorkspaceExpanded(
  expandedWorkspaces: ReadonlySet<string>,
  workspacePath: string,
): Set<string> {
  const normalizedPath = normalizeWorkspacePath(workspacePath)
  const next = new Set(expandedWorkspaces)
  if (normalizedPath) next.add(normalizedPath)
  return next
}

function workspaceLabel(workspacePath: string): string {
  if (workspacePath === UNKNOWN_WORKSPACE) return workspacePath
  return workspacePath.split('/').filter(Boolean).at(-1) ?? workspacePath
}
