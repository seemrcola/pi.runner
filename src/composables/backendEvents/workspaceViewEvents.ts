import type { Ref } from 'vue'
import type { BackendMessage, WorkspaceViewState } from '@shared/protocol'
import { normalizeWorkspacePath } from '@shared/workspacePaths'

export type WorkspaceViewEventsOptions = {
  expandedWorkspaces: Ref<Set<string>>
  workspaceViewStates: Ref<Map<string, WorkspaceViewState>>
}

export function handleWorkspaceViewStateMessage(
  options: WorkspaceViewEventsOptions,
  message: BackendMessage,
): boolean {
  switch (message.type) {
    case 'workspace_view_states:list':
      options.workspaceViewStates.value = new Map(
        message.states.map(normalizeWorkspaceViewState).map((state) => [state.workspacePath, state]),
      )
      options.expandedWorkspaces.value = applyWorkspaceViewStates(
        options.expandedWorkspaces.value,
        message.states.map(normalizeWorkspaceViewState),
      )
      return true

    case 'workspace_view_state:updated':
      const state = normalizeWorkspaceViewState(message.state)
      options.workspaceViewStates.value = new Map(options.workspaceViewStates.value).set(state.workspacePath, state)
      options.expandedWorkspaces.value = applyWorkspaceViewStates(
        options.expandedWorkspaces.value,
        [state],
      )
      return true

    default:
      return false
  }
}

function applyWorkspaceViewStates(
  expandedWorkspaces: ReadonlySet<string>,
  states: WorkspaceViewState[],
): Set<string> {
  const next = new Set(expandedWorkspaces)
  for (const state of states) {
    if (state.isCollapsed) next.delete(state.workspacePath)
    else next.add(state.workspacePath)
  }
  return next
}

function normalizeWorkspaceViewState(state: WorkspaceViewState): WorkspaceViewState {
  return {
    ...state,
    workspacePath: normalizeWorkspacePath(state.workspacePath),
  }
}
