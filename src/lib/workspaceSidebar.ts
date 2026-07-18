import type { SidebarConversationGroup } from './sidebarGroups'
import { normalizeWorkspacePath, normalizeWorkspacePathSet } from '@shared/workspacePaths'

export type WorkspaceSidebarState = {
  pinnedWorkspaces: ReadonlySet<string>
}

export type WorkspaceSidebarGroup = SidebarConversationGroup & {
  isPinned: boolean
}

export function buildWorkspaceSidebarGroups(
  groups: SidebarConversationGroup[],
  state: WorkspaceSidebarState,
): WorkspaceSidebarGroup[] {
  const pinnedWorkspaces = normalizeWorkspacePathSet(state.pinnedWorkspaces)
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => {
      const aPinned = pinnedWorkspaces.has(a.group.workspacePath)
      const bPinned = pinnedWorkspaces.has(b.group.workspacePath)
      if (aPinned !== bPinned) return aPinned ? -1 : 1
      return a.index - b.index
    })
    .map(({ group }) => ({
      ...group,
      isPinned: pinnedWorkspaces.has(group.workspacePath),
    }))
}

export function toggleWorkspacePinned(
  pinnedWorkspaces: ReadonlySet<string>,
  workspacePath: string,
): Set<string> {
  const normalizedPath = normalizeWorkspacePath(workspacePath)
  const next = new Set(pinnedWorkspaces)
  if (!normalizedPath) return next
  if (next.has(normalizedPath)) {
    next.delete(normalizedPath)
  } else {
    next.add(normalizedPath)
  }
  return next
}
