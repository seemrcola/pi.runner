import { ref, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import { createRequestId, type BackendMessage, type ClientMessage } from '@shared/protocol'

type UseHistorySyncOptions = {
  isConnected: Readonly<Ref<boolean>>
  activeTaskCount: Readonly<Ref<number>>
  sendClientMessage(message: ClientMessage): boolean
}

export function useHistorySync(options: UseHistorySyncOptions) {
  const isHistorySyncing = ref(false)
  let pendingRequestId: string | null = null

  function refreshHistory() {
    if (!options.isConnected.value || options.activeTaskCount.value > 0 || isHistorySyncing.value) return

    const requestId = createRequestId('sync')
    if (!options.sendClientMessage({ type: 'sync_source_sessions', requestId })) {
      toast.error('刷新失败，现有列表已保留')
      return
    }
    pendingRequestId = requestId
    isHistorySyncing.value = true
  }

  function handleHistorySyncMessage(message: BackendMessage) {
    if (
      (message.type !== 'source_sessions:synced' && message.type !== 'source_sessions:error')
      || !message.requestId
      || message.requestId !== pendingRequestId
    ) return

    pendingRequestId = null
    isHistorySyncing.value = false
    if (message.type === 'source_sessions:error') {
      toast.error('刷新失败，现有列表已保留')
      return
    }

    if (message.result.failed > 0) {
      toast.error(`有 ${message.result.failed} 个会话同步失败`)
    } else if (message.result.indexed > 0) {
      toast.success(`已更新 ${message.result.indexed} 个会话`)
    } else if (message.result.removed > 0) {
      toast.success(`已清理 ${message.result.removed} 条失效历史`)
    } else {
      toast.success('未发现新的会话')
    }
  }

  function cancelHistorySync() {
    pendingRequestId = null
    isHistorySyncing.value = false
  }

  return {
    cancelHistorySync,
    handleHistorySyncMessage,
    isHistorySyncing,
    refreshHistory,
  }
}
