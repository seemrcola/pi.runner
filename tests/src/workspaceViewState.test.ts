import { ref } from 'vue'
import { describe, expect, test, vi } from 'vitest'
import { useWorkspaceViewState } from '../../src/composables/useWorkspaceViewState'

describe('workspace view state composable', () => {
  test('normalizes updates and waits for backend confirmation before changing persisted state', () => {
    const sent: unknown[] = []
    const workspaceViewStates = ref(new Map())

    const { updateWorkspaceViewState } = useWorkspaceViewState({
      workspaceViewStates,
      sendClientMessage: (message) => {
        sent.push(message)
        return true
      },
    })

    updateWorkspaceViewState('/tmp/project/../project/', { isPinned: true })

    expect([...workspaceViewStates.value.values()]).toEqual([])
    expect(sent).toEqual([
      {
        type: 'update_workspace_view_state',
        workspacePath: '/tmp/project',
        isPinned: true,
      },
    ])
  })

  test('keeps confirmed state unchanged when the backend send fails', () => {
    const previous = {
      workspacePath: '/tmp/project',
      isPinned: false,
      isCollapsed: false,
      pinnedAt: null,
      updatedAt: 100,
    }
    const workspaceViewStates = ref(new Map([['/tmp/project', previous]]))
    const onUpdateError = vi.fn()
    const { updateWorkspaceViewState } = useWorkspaceViewState({
      workspaceViewStates,
      sendClientMessage: () => false,
      onUpdateError,
    })

    updateWorkspaceViewState('/tmp/project', { isPinned: true })

    expect(workspaceViewStates.value.get('/tmp/project')).toEqual(previous)
    expect(onUpdateError).toHaveBeenCalledWith('工作区视图设置未保存，连接恢复后请重试')
  })
})
