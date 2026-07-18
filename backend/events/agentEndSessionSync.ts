import type { Conversation } from '../../shared/chat.js'
import type { BackendMessage } from '../../shared/protocol.js'
import type { PiRunnerSnapshot } from '../pi/index.js'
import type { SessionIndexSyncResult } from '../sessions/sessionService.js'

type AgentEndPayload = {
  type?: unknown
  conversationId?: unknown
  willRetry?: unknown
}

type SessionIndexForAgentEndSync = {
  syncSession(sessionPath: string): SessionIndexSyncResult
  listConversations(): Conversation[]
}

type RunnerSnapshots = {
  snapshot(conversationId: string): PiRunnerSnapshot | undefined
}

type AgentEndSyncDeps = {
  piRunners: RunnerSnapshots
  sessions: SessionIndexForAgentEndSync
  broadcast(payload: BackendMessage): void
}

export function syncSessionAfterAgentEnd(payload: AgentEndPayload, deps: AgentEndSyncDeps): void {
  if (payload.type !== 'pi:agent_end') return
  if (payload.willRetry === true) return
  if (typeof payload.conversationId !== 'string' || !payload.conversationId) return

  const snapshot = deps.piRunners.snapshot(payload.conversationId)
  if (!snapshot?.sessionPath) return

  try {
    const result = deps.sessions.syncSession(snapshot.sessionPath)
    if (result.failed > 0) {
      deps.broadcast({
        type: 'pi:error',
        conversationId: payload.conversationId,
        message: 'Session projection sync failed',
      })
      return
    }
    deps.broadcast({ type: 'source_sessions:synced', result })
    deps.broadcast({ type: 'conversations:list', conversations: deps.sessions.listConversations() })
  } catch (error) {
    // 投影同步是可恢复副作用，不能让 Pi stdout 回调因磁盘或 SQLite 错误崩溃。
    deps.broadcast({
      type: 'pi:error',
      conversationId: payload.conversationId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
