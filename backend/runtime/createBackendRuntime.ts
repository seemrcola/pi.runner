import { join } from 'node:path'
import { homedir } from 'node:os'
import { createPiProcessManager } from '../pi/index.js'
import { createSessionService } from '../sessions/sessionService.js'
import { createClientMessageDispatcher } from '../client/clientMessageDispatcher.js'
import { createSettingsService } from '../settings/settingsService.js'
import { resolveDesktopDataDir } from '../config/paths.js'
import { createBackendEventBus, type BackendEvent } from '../events/bus.js'
import { createAgentEndSessionSyncSubscriber } from '../events/subscribers.js'
import { randomUUID } from 'node:crypto'

export type BackendRuntimeOptions = {
  transportSubscriber: (payload: BackendEvent) => void
}

export function createBackendRuntime(options: BackendRuntimeOptions) {
  const port = Number(process.env.PI_DESKTOP_BACKEND_PORT ?? '47831')
  const sourceSessionsDir =
    process.env.PI_DESKTOP_SOURCE_SESSIONS_DIR ?? join(homedir(), '.pi', 'agent', 'sessions')
  const dataDir = resolveDesktopDataDir()
  const instanceId = process.env.PI_DESKTOP_BACKEND_INSTANCE_ID ?? randomUUID()
  const sessions = createSessionService(join(dataDir, 'session-index.sqlite'), sourceSessionsDir)
  const settings = createSettingsService()
  sessions.sync()

  // Pi process manager 是运行时事实来源，必须先构造再注入事件副作用订阅者。
  let emitBackendEvent: (payload: BackendEvent) => void = () => {}
  const piRunners = createPiProcessManager(
    (payload) => emitBackendEvent(payload),
    {
      instanceId,
      lifecycleLogPath: join(dataDir, 'runtime', 'process-lifecycle.jsonl'),
      runtimeLockDir: join(dataDir, 'runtime', 'session-locks'),
    },
  )
  const backendEvents = createBackendEventBus([
    // 投影必须先于 transport：renderer 收到 agent_end 后会立即发送排队 follow-up，
    // 因此该轮的 conversations:list 必须更早送达，不能随后覆盖新追加的用户消息。
    createAgentEndSessionSyncSubscriber({
      piRunners: {
        snapshot: (conversationId) => piRunners.snapshot(conversationId),
      },
      sessions,
    }),
    options.transportSubscriber,
  ])
  emitBackendEvent = (payload) => backendEvents.emit(payload)

  const dispatchClientMessage = createClientMessageDispatcher({
    port,
    sourceSessionsDir,
    sessions,
    settings,
    piRunners,
  })

  return {
    port,
    sourceSessionsDir,
    dataDir,
    instanceId,
    sessions,
    settings,
    piRunners,
    dispatchClientMessage,
    broadcast: emitBackendEvent,
  }
}
