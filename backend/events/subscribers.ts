import type { PiRunnerSnapshot } from '../pi/index.js'
import { syncSessionAfterAgentEnd } from './agentEndSessionSync.js'
import type { SessionService } from '../sessions/sessionService.js'
import type { BackendEventSubscriber } from './bus.js'

type RunnerSnapshots = {
  snapshot(conversationId: string): PiRunnerSnapshot | undefined
}

export function createAgentEndSessionSyncSubscriber(deps: {
  piRunners: RunnerSnapshots
  sessions: Pick<SessionService, 'syncSession' | 'listConversations'>
}): BackendEventSubscriber {
  return (payload, emit) => {
    syncSessionAfterAgentEnd(payload, {
      piRunners: deps.piRunners,
      sessions: deps.sessions,
      // agent end 后会产生二级事件，继续走 event bus，避免同步结果绕过统一出口。
      broadcast: emit,
    })
  }
}
