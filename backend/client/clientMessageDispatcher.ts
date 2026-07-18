import type { ImageContent } from '../../shared/chat.js'
import {
  parseClientMessage,
  type BackendMessage,
  type ClientMessage,
  type PiRunnerSnapshot,
  type PiSettingsSnapshot,
  type PromptStreamingBehavior,
} from '../../shared/protocol.js'
import { createConversationLifecycleService } from './conversationLifecycle.js'
import type { SessionService } from '../sessions/sessionService.js'
import type { PiProcessState } from '../pi/index.js'

type Send = (payload: BackendMessage) => void
type Handler = (message: ClientMessage, send: Send, clientId: string) => Promise<void> | void

export type ClientMessageHandlerDeps = {
  port: number
  sourceSessionsDir: string
  sessions: SessionService
  settings: {
    snapshot(): Promise<PiSettingsSnapshot>
    saveModels(content: string): Promise<PiSettingsSnapshot>
    saveSettings(content: string): Promise<PiSettingsSnapshot>
    saveAll(models: string, settings: string): Promise<PiSettingsSnapshot>
    installPi(): Promise<PiSettingsSnapshot>
  }
  piRunners: {
    list(): PiRunnerSnapshot[]
    snapshot(conversationId: string): PiRunnerSnapshot | undefined
    start(conversationId: string, input: { cwd: string; extraArgs?: string; sessionPath: string }): Promise<void>
    prompt(
      conversationId: string,
      id: string,
      prompt: string,
      streamingBehavior?: PromptStreamingBehavior,
      images?: ImageContent[],
    ): Promise<void>
    abort(conversationId: string, id: string): Promise<void>
    setActiveConversation(clientId: string, conversationId: string | null): void
    getState(conversationId: string): Promise<PiProcessState>
    shutdownConversation(conversationId: string): Promise<void>
    shutdownWorkspace(workspacePath: string): Promise<number>
  }
}

export function createClientMessageDispatcher(deps: ClientMessageHandlerDeps) {
  const handlers = createClientMessageHandlers(deps)

  return async function dispatchClientMessage(raw: string, send: Send, clientId = 'default-client'): Promise<void> {
    const message = parseClientMessage(raw)
    if (!message) {
      send({ type: 'pi:error', message: 'Invalid client message' })
      return
    }

    const handler = handlers[message.type]
    if (!handler) {
      send({ type: 'pi:error', message: 'Unknown client message' })
      return
    }
    try {
      await handler(message, send, clientId)
    } catch (error) {
      if (message.type.startsWith('settings:')) {
        send({
          type: 'settings:error',
          message: error instanceof Error ? error.message : String(error),
        })
        return
      }
      send({
        type: 'pi:error',
        ...messageRequestContext(message),
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

function messageRequestContext(message: ClientMessage): { requestId?: string; conversationId?: string } {
  return {
    ...('requestId' in message && typeof message.requestId === 'string' ? { requestId: message.requestId } : {}),
    ...('conversationId' in message && typeof message.conversationId === 'string' ? { conversationId: message.conversationId } : {}),
  }
}

function createClientMessageHandlers(deps: ClientMessageHandlerDeps): Partial<Record<ClientMessage['type'], Handler>> {
  const lifecycle = createConversationLifecycleService(deps)

  return {
    ping(_message, send) {
      send({ type: 'backend:pong' })
    },
    list_conversations(_message, send) {
      send({ type: 'conversations:list', conversations: deps.sessions.listConversations() })
    },
    list_runners(_message, send) {
      send({ type: 'runner:list', runners: deps.piRunners.list() })
    },
    set_active_conversation(message, _send, clientId) {
      if (message.type !== 'set_active_conversation') return
      deps.piRunners.setActiveConversation(clientId, message.conversationId)
    },
    list_workspace_view_states(_message, send) {
      send({ type: 'workspace_view_states:list', states: deps.sessions.listWorkspaceViewStates() })
    },
    async 'settings:get'(_message, send) {
      send({ type: 'settings:snapshot', snapshot: await deps.settings.snapshot() })
    },
    async 'settings:save_models'(message, send) {
      if (message.type !== 'settings:save_models') return
      send({ type: 'settings:snapshot', snapshot: await deps.settings.saveModels(message.content) })
    },
    async 'settings:save_settings'(message, send) {
      if (message.type !== 'settings:save_settings') return
      send({ type: 'settings:snapshot', snapshot: await deps.settings.saveSettings(message.content) })
    },
    async 'settings:save_all'(message, send) {
      if (message.type !== 'settings:save_all') return
      send({ type: 'settings:snapshot', snapshot: await deps.settings.saveAll(message.models, message.settings) })
    },
    async 'settings:install_pi'(_message, send) {
      send({ type: 'settings:snapshot', snapshot: await deps.settings.installPi() })
    },
    update_workspace_view_state(message, send) {
      if (message.type !== 'update_workspace_view_state') return
      const state = deps.sessions.upsertWorkspaceViewState(message.workspacePath, {
        isPinned: message.isPinned,
        isCollapsed: message.isCollapsed,
      })
      send({ type: 'workspace_view_state:updated', state })
    },
    sync_source_sessions(message, send) {
      if (message.type !== 'sync_source_sessions') return
      const hasActiveRunner = deps.piRunners.list().some(({ phase }) => (
        phase === 'starting'
        || phase === 'running'
        || phase === 'stopping'
        || phase === 'terminating'
        || phase === 'termination_failed'
      ))
      if (hasActiveRunner) {
        send({
          type: 'source_sessions:error',
          requestId: message.requestId,
          message: '任务运行中，暂时无法刷新历史',
        })
        return
      }

      try {
        const result = deps.sessions.sync()
        send({ type: 'source_sessions:synced', requestId: message.requestId, result })
        send({ type: 'conversations:list', conversations: deps.sessions.listConversations() })
      } catch (error) {
        // 手动刷新有独立的请求生命周期，不能退化成无法关联的全局 pi:error。
        send({
          type: 'source_sessions:error',
          requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
    async delete_conversation(message, send) {
      if (message.type !== 'delete_conversation') return
      await lifecycle.deleteConversation(message, send)
    },
    async delete_workspace(message, send) {
      if (message.type !== 'delete_workspace') return
      await lifecycle.deleteWorkspace(message, send)
    },
    restore_conversation(message, send) {
      if (message.type !== 'restore_conversation') return
      lifecycle.restoreConversation(message, send)
    },
    restore_workspace(message, send) {
      if (message.type !== 'restore_workspace') return
      lifecycle.restoreWorkspace(message, send)
    },
    async start(message, send) {
      if (message.type !== 'start') return
      await lifecycle.start(message, send)
    },
    async prompt(message, send) {
      if (message.type !== 'prompt') return
      const conversationId = message.conversationId?.trim()
      if (!conversationId) {
        send({ type: 'pi:error', message: 'Prompt conversationId is required' })
        return
      }
      const prompt = message.prompt?.trim()
      const images = message.images?.length ? message.images : undefined
      if (!prompt && !images) {
        send({ type: 'pi:error', conversationId, message: 'Prompt is required' })
        return
      }

      try {
        const promptId = message.id?.trim() || `prompt-${Date.now()}`
        const promptText = prompt || 'Describe this image.'
        await deps.piRunners.prompt(
          conversationId,
          promptId,
          promptText,
          message.streamingBehavior,
          images,
        )
        if (images) {
          try {
            deps.sessions.recordMessageImages({
              conversationId,
              sessionPath: deps.piRunners.snapshot(conversationId)?.sessionPath,
              messageId: promptId,
              promptText,
              images,
            })
          } catch (error) {
            // 图片投影只服务 Desktop 回看；Pi 已经收到 prompt 时不能再把用户任务标记为发送失败。
            console.warn('Failed to persist desktop image projection', error)
          }
        }
      } catch (error) {
        send({
          type: 'pi:error',
          conversationId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
    async abort(message, send) {
      if (message.type !== 'abort') return
      const conversationId = message.conversationId?.trim()
      if (!conversationId) {
        send({ type: 'pi:error', message: 'Abort conversationId is required' })
        return
      }
      try {
        await deps.piRunners.abort(conversationId, message.id?.trim() || `abort-${Date.now()}`)
      } catch (error) {
        send({
          type: 'pi:error',
          conversationId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }
}
