import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useHistorySync } from '../../src/composables/useHistorySync'
import type { BackendMessage, ClientMessage } from '../../shared/protocol'

const { success, error } = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('vue-sonner', () => ({
  toast: { success, error },
}))

describe('history sync', () => {
  it('sends one correlated request and reports the matching result', () => {
    const sent: ClientMessage[] = []
    const sync = useHistorySync({
      isConnected: ref(true),
      activeTaskCount: ref(0),
      sendClientMessage(message) {
        sent.push(message)
        return true
      },
    })

    sync.refreshHistory()
    const request = sent[0]
    expect(request).toMatchObject({ type: 'sync_source_sessions' })
    expect(request && 'requestId' in request ? request.requestId : '').toBeTruthy()
    expect(sync.isHistorySyncing.value).toBe(true)

    sync.handleHistorySyncMessage({
      type: 'source_sessions:synced',
      requestId: request && 'requestId' in request ? request.requestId : '',
      result: { indexed: 2, removed: 0, skipped: 1, failed: 0 },
    })

    expect(sync.isHistorySyncing.value).toBe(false)
    expect(success).toHaveBeenCalledWith('已更新 2 个会话')
  })

  it('ignores automatic and unrelated results, then reports a matching failure', () => {
    const sent: ClientMessage[] = []
    const sync = useHistorySync({
      isConnected: ref(true),
      activeTaskCount: ref(0),
      sendClientMessage(message) {
        sent.push(message)
        return true
      },
    })
    sync.refreshHistory()
    const requestId = (sent[0] as Extract<ClientMessage, { type: 'sync_source_sessions' }>).requestId

    sync.handleHistorySyncMessage({
      type: 'source_sessions:synced',
      result: { indexed: 0, removed: 0, skipped: 1, failed: 0 },
    })
    sync.handleHistorySyncMessage({
      type: 'source_sessions:synced',
      requestId: 'other',
      result: { indexed: 1, removed: 0, skipped: 0, failed: 0 },
    })
    expect(sync.isHistorySyncing.value).toBe(true)

    sync.handleHistorySyncMessage({
      type: 'source_sessions:error',
      requestId,
      message: '刷新失败',
    } satisfies BackendMessage)

    expect(sync.isHistorySyncing.value).toBe(false)
    expect(error).toHaveBeenCalledWith('刷新失败，现有列表已保留')
  })

  it('does not send while disconnected, busy, syncing, or when socket send fails', () => {
    const isConnected = ref(false)
    const activeTaskCount = ref(0)
    const sendClientMessage = vi.fn(() => false)
    const sync = useHistorySync({ isConnected, activeTaskCount, sendClientMessage })

    sync.refreshHistory()
    isConnected.value = true
    activeTaskCount.value = 1
    sync.refreshHistory()
    activeTaskCount.value = 0
    sync.refreshHistory()

    expect(sendClientMessage).toHaveBeenCalledTimes(1)
    expect(sync.isHistorySyncing.value).toBe(false)
    expect(error).toHaveBeenCalledWith('刷新失败，现有列表已保留')
  })

  it('cancels an in-flight request when the connection is lost', () => {
    const sync = useHistorySync({
      isConnected: ref(true),
      activeTaskCount: ref(0),
      sendClientMessage: () => true,
    })

    sync.refreshHistory()
    expect(sync.isHistorySyncing.value).toBe(true)

    sync.cancelHistorySync()
    expect(sync.isHistorySyncing.value).toBe(false)
  })

  it('reports partial failures and removed stale history accurately', () => {
    const sent: ClientMessage[] = []
    const sync = useHistorySync({
      isConnected: ref(true),
      activeTaskCount: ref(0),
      sendClientMessage(message) { sent.push(message); return true },
    })
    sync.refreshHistory()
    const requestId = (sent[0] as Extract<ClientMessage, { type: 'sync_source_sessions' }>).requestId
    sync.handleHistorySyncMessage({
      type: 'source_sessions:synced',
      requestId,
      result: { indexed: 1, removed: 0, skipped: 0, failed: 2 },
    })
    expect(error).toHaveBeenCalledWith('有 2 个会话同步失败')

    sync.refreshHistory()
    const secondRequestId = (sent[1] as Extract<ClientMessage, { type: 'sync_source_sessions' }>).requestId
    sync.handleHistorySyncMessage({
      type: 'source_sessions:synced',
      requestId: secondRequestId,
      result: { indexed: 0, removed: 3, skipped: 1, failed: 0 },
    })
    expect(success).toHaveBeenCalledWith('已清理 3 条失效历史')
  })
})
