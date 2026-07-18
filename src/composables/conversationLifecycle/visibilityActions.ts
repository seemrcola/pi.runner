import {
  buildConversationExport,
  getConversationExportFilename,
  removeConversationById,
} from '@/lib/conversations'
import { createRequestId, type ClientMessage } from '@shared/protocol'
import { normalizeWorkspacePath } from '@shared/workspacePaths'
import type { OptimisticDelete, UseConversationLifecycleOptions } from './types'

export function createVisibilityActions(options: UseConversationLifecycleOptions) {
  const optimisticDeletes = new Map<string, OptimisticDelete>()
  const optimisticRestores = new Map<string, OptimisticDelete>()

  function exportConversation(id: string) {
    const conversation = options.conversations.value.find((item) => item.id === id)
    if (!conversation) return

    if (id === options.activeId.value) options.flushNow(id)

    const blob = new Blob([buildConversationExport(conversation)], {
      type: 'text/markdown;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = getConversationExportFilename(conversation)
    link.click()
    URL.revokeObjectURL(url)
    options.notify?.success(`已导出：${link.download}`)
  }

  function deleteConversation(id: string) {
    const conversation = options.conversations.value.find((item) => item.id === id)
    if (!conversation) return
    if (isConversationActive(id)) {
      options.notify?.error('任务进行中，停止后才能移除')
      return
    }
    const requestId = createRequestId('delete-conversation')
    const rollback = captureDeleteRollback('conversation', {
      removedConversations: [conversation],
      conversationId: id,
      sessionPath: conversation.sessionPath,
    })
    const wasActive = id === options.activeId.value

    const result = removeConversationById(options.conversations.value, id, options.activeId.value)
    options.conversations.value = result.conversations
    options.activeId.value = result.activeId
    options.runtimes.value.delete(id)
    rollback.activeIdAfterDelete = options.activeId.value

    if (wasActive && options.activeId.value) {
      options.forceScrollToBottom()
    }

    const message: ClientMessage = conversation.sessionPath
      ? {
        type: 'delete_conversation',
        requestId,
        conversationId: id,
        sessionPath: conversation.sessionPath,
      }
      : { type: 'delete_conversation', requestId, conversationId: id }
    optimisticDeletes.set(requestId, rollback)
    if (!options.sendClientMessage(message)) {
      rollbackOptimisticDelete(requestId)
    }
  }

  function deleteWorkspace(workspacePath: string) {
    const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath)
    if (!normalizedWorkspacePath) return
    const activeTaskCount = options.conversations.value.filter((conversation) => (
      conversation.kind === 'workspace'
      && normalizeWorkspacePath(conversation.workspacePath ?? '') === normalizedWorkspacePath
      && isConversationActive(conversation.id)
    )).length
    if (activeTaskCount > 0) {
      options.notify?.error(`工作区有 ${activeTaskCount} 个任务进行中，停止后才能移除`)
      return
    }
    const requestId = createRequestId('delete-workspace')
    const removedConversations = options.conversations.value.filter((conversation) => (
      conversation.kind === 'workspace'
      && normalizeWorkspacePath(conversation.workspacePath ?? '') === normalizedWorkspacePath
    ))
    const rollback = captureDeleteRollback('workspace', {
      removedConversations,
      workspacePath: normalizedWorkspacePath,
    })
    const activeConversation = options.activeId.value ? options.conversationById(options.activeId.value) : null
    const wasActive = activeConversation?.workspacePath === normalizedWorkspacePath

    options.conversations.value = options.conversations.value.filter(
      (conversation) => !(conversation.kind === 'workspace' && conversation.workspacePath === normalizedWorkspacePath),
    )
    if (!options.activeId.value || !options.conversations.value.some((conversation) => conversation.id === options.activeId.value)) {
      options.activeId.value = options.conversations.value[0]?.id ?? null
    }
    rollback.activeIdAfterDelete = options.activeId.value

    if (wasActive && options.activeId.value) {
      options.forceScrollToBottom()
    }

    optimisticDeletes.set(requestId, rollback)
    if (!options.sendClientMessage({
      type: 'delete_workspace',
      requestId,
      workspacePath: normalizedWorkspacePath,
    })) {
      rollbackOptimisticDelete(requestId)
    }
  }

  function captureDeleteRollback(
    kind: OptimisticDelete['kind'],
    target: Pick<OptimisticDelete, 'removedConversations' | 'conversationId' | 'sessionPath' | 'workspacePath'>,
  ): OptimisticDelete {
    return {
      kind,
      ...target,
      conversations: [...options.conversations.value],
      activeId: options.activeId.value,
      runtimes: new Map(options.runtimes.value),
    }
  }

  function isConversationActive(conversationId: string): boolean {
    const phase = options.runnerSnapshotFor(conversationId)?.phase
    return phase === 'starting'
      || phase === 'running'
      || phase === 'stopping'
      || phase === 'terminating'
      || phase === 'termination_failed'
  }

  function confirmOptimisticDelete(requestId?: string): boolean {
    if (!requestId) return false
    const pending = optimisticDeletes.get(requestId)
    if (!pending) return false
    optimisticDeletes.delete(requestId)
    options.notify?.success(pending.kind === 'workspace' ? '已移除工作区' : '已移除会话', {
      duration: 8000,
      action: {
        label: '撤销',
        onClick: () => restoreOptimisticDelete(pending),
      },
    })
    return true
  }

  function restoreOptimisticDelete(deletion: OptimisticDelete) {
    const requestId = createRequestId(`restore-${deletion.kind}`)
    const message: ClientMessage = deletion.kind === 'workspace'
      ? {
        type: 'restore_workspace',
        requestId,
        workspacePath: deletion.workspacePath ?? '',
      }
      : {
        type: 'restore_conversation',
        requestId,
        conversationId: deletion.conversationId ?? '',
        sessionPath: deletion.sessionPath ?? null,
      }
    if (!options.sendClientMessage(message)) {
      options.notify?.error('撤销失败，请重试')
      return
    }
    optimisticRestores.set(requestId, deletion)
  }

  function confirmOptimisticRestore(requestId?: string): boolean {
    if (!requestId) return false
    const pending = optimisticRestores.get(requestId)
    if (!pending) return false
    optimisticRestores.delete(requestId)

    const restored = restoreDeletedConversations(pending, false)
    if (!options.activeId.value) options.activeId.value = restored[0]?.id ?? null
    options.notify?.success(pending.kind === 'workspace' ? '工作区已恢复' : '会话已恢复')
    return true
  }

  function rejectOptimisticRestore(requestId?: string, reason?: string): boolean {
    if (!requestId || !optimisticRestores.has(requestId)) return false
    optimisticRestores.delete(requestId)
    options.notify?.error(reason ?? '撤销失败，请重试')
    return true
  }

  function rollbackOptimisticDelete(requestId?: string, reason?: string): boolean {
    if (!requestId) return false
    const pending = optimisticDeletes.get(requestId)
    if (!pending) return false
    optimisticDeletes.delete(requestId)
    restoreDeletedConversations(pending, true)
    // 只有用户仍停留在删除动作选中的回退会话时，才恢复原 activeId，避免覆盖期间的主动切换。
    if (options.activeId.value === pending.activeIdAfterDelete) options.activeId.value = pending.activeId
    if (!options.activeId.value || !options.conversations.value.some(({ id }) => id === options.activeId.value)) {
      options.activeId.value = pending.activeId && options.conversations.value.some(({ id }) => id === pending.activeId)
        ? pending.activeId
        : pending.removedConversations.find(({ id }) => options.conversations.value.some((item) => item.id === id))?.id ?? null
    }
    options.notify?.error(reason ?? '移除失败，已恢复')
    return true
  }

  function restoreDeletedConversations(pending: OptimisticDelete, preserveOriginalOrder: boolean) {
    const currentIds = new Set(options.conversations.value.map((conversation) => conversation.id))
    const restored = pending.removedConversations.filter((conversation) => !currentIds.has(conversation.id))
    if (restored.length === 0) return restored

    // 撤销确认延续当前列表顺序；失败回滚则尽量恢复删除前的相对位置。
    if (!preserveOriginalOrder) {
      options.conversations.value = [...options.conversations.value, ...restored]
      restoreDeletedRuntimes(pending, restored)
      return restored
    }

    // 只合并本次删除对象，不能用旧快照覆盖后续已确认的删除或新到达的会话。
    const restoredIds = new Set(restored.map((conversation) => conversation.id))
    const pendingIds = new Set(pending.conversations.map((conversation) => conversation.id))
    const originalById = new Map(pending.conversations.map((conversation) => [conversation.id, conversation]))
    const merged: typeof options.conversations.value = []
    let originalIndex = 0

    for (const current of options.conversations.value) {
      if (pendingIds.has(current.id)) {
        while (originalIndex < pending.conversations.length) {
          const original = pending.conversations[originalIndex]
          if (original.id === current.id) break
          if (restoredIds.has(original.id)) merged.push(originalById.get(original.id)!)
          originalIndex += 1
        }
        originalIndex += 1
      }
      merged.push(current)
    }
    for (; originalIndex < pending.conversations.length; originalIndex += 1) {
      const original = pending.conversations[originalIndex]
      if (restoredIds.has(original.id)) merged.push(originalById.get(original.id)!)
    }
    options.conversations.value = merged

    restoreDeletedRuntimes(pending, restored)
    return restored
  }

  function restoreDeletedRuntimes(pending: OptimisticDelete, restored: OptimisticDelete['removedConversations']) {
    for (const conversation of restored) {
      const runtime = pending.runtimes.get(conversation.id)
      if (runtime) options.runtimes.value.set(conversation.id, runtime)
      else options.runtimeFor(conversation.id)
    }
  }

  async function openWorkspaceFolder(workspacePath: string) {
    if (!window.piDesktop) return
    const error = await window.piDesktop.openWorkspaceFolder(normalizeWorkspacePath(workspacePath))
    if (error) options.notify?.error(`无法打开工作区：${error}`)
  }

  return {
    confirmOptimisticDelete,
    confirmOptimisticRestore,
    deleteConversation,
    deleteWorkspace,
    exportConversation,
    openWorkspaceFolder,
    rejectOptimisticRestore,
    rollbackOptimisticDelete,
  }
}
