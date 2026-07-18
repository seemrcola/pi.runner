import { ref, type Ref } from 'vue'
import { normalizeWorkspacePath } from '@shared/workspacePaths'
import type { ClientMessage, WorkspaceViewState } from '@shared/protocol'

type WorkspaceViewStateOptions = {
  workspaceViewStates?: Ref<Map<string, WorkspaceViewState>>
  sendClientMessage(message: ClientMessage): boolean
  onUpdateError?(message: string): void
}

export function useWorkspaceViewState(options: WorkspaceViewStateOptions) {
  const workspaceViewStates = options.workspaceViewStates ?? ref(new Map<string, WorkspaceViewState>())

  function updateWorkspaceViewState(
    workspacePath: string,
    patch: { isPinned?: boolean; isCollapsed?: boolean },
  ) {
    const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath)
    if (!normalizedWorkspacePath) return
    const didSend = options.sendClientMessage({
      type: 'update_workspace_view_state',
      workspacePath: normalizedWorkspacePath,
      ...patch,
    })
    if (!didSend) options.onUpdateError?.('工作区视图设置未保存，连接恢复后请重试')
  }

  return {
    updateWorkspaceViewState,
    workspaceViewStates,
  }
}
