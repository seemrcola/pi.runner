import type { BackendMessage, ClientMessage } from '../../shared/protocol.js'
import type { SessionService } from '../sessions/sessionService.js'
import { normalizeWorkspacePath } from '../../shared/workspacePaths.js'
import type { PiProcessState, PiRunnerSnapshot } from '../pi/index.js'
import { DEFAULT_CONVERSATION_TITLE } from '../../shared/chat.js'

type Send = (payload: BackendMessage) => void

export type ConversationLifecycleDeps = {
  sessions: SessionService
  piRunners: {
    start(conversationId: string, input: { cwd: string; extraArgs?: string; sessionPath: string }): Promise<void>
    getState(conversationId: string): Promise<PiProcessState>
    snapshot(conversationId: string): PiRunnerSnapshot | undefined
    list(): PiRunnerSnapshot[]
    shutdownConversation(conversationId: string): Promise<void>
    shutdownWorkspace(workspacePath: string): Promise<number>
  }
}

export function createConversationLifecycleService(deps: ConversationLifecycleDeps) {
  async function start(message: Extract<ClientMessage, { type: 'start' }>, send: Send) {
    const requestId = message.requestId?.trim()
    const conversationId = message.conversationId?.trim()
    if (!requestId || !conversationId) {
      send({ type: 'pi:error', message: 'Start requestId and conversationId are required' })
      return
    }

    let sessionStart
    try {
      sessionStart = deps.sessions.prepareConversationStart({
        conversationId,
        sessionPath: message.sessionPath,
        cwd: message.cwd,
        mode: message.mode ?? undefined,
      })
    } catch (error) {
      send({ type: 'pi:error', message: error instanceof Error ? error.message : String(error) })
      return
    }

    try {
      await deps.piRunners.start(conversationId, {
        cwd: sessionStart.cwd,
        extraArgs: message.extraArgs,
        sessionPath: sessionStart.sessionPath,
      })
    } catch (error) {
      send({
        type: 'pi:error',
        conversationId,
        message: error instanceof Error ? error.message : String(error),
      })
      return
    }
    deps.sessions.recordConversationStart(sessionStart, {
      title: DEFAULT_CONVERSATION_TITLE,
      createdAt: Date.now(),
    })
    let state: PiProcessState = {}
    try {
      state = await deps.piRunners.getState(conversationId)
    } catch {
      state = {}
    }
    send({
      type: 'pi:started',
      requestId,
      conversationId,
      sessionPath: state.sessionPath ?? sessionStart.sessionPath,
      ...(state.sessionName ? { sessionName: state.sessionName } : {}),
    })
  }

  async function deleteConversation(message: Extract<ClientMessage, { type: 'delete_conversation' }>, send: Send) {
    const requestId = message.requestId?.trim()
    const conversationId = message.conversationId?.trim()
    const sessionPath = message.sessionPath?.trim()
    const activeByConversation = conversationId && isActiveRunner(deps.piRunners.snapshot(conversationId))
    const activeBySessionPath = sessionPath && deps.piRunners.list().some((snapshot) => (
      snapshot.sessionPath === sessionPath && isActiveRunner(snapshot)
    ))
    if (activeByConversation || activeBySessionPath) {
      send({
        type: 'pi:error',
        ...(requestId ? { requestId } : {}),
        conversationId,
        message: '任务进行中，停止后才能移除',
      })
      return
    }
    if (conversationId) await deps.piRunners.shutdownConversation(conversationId)
    if (conversationId) deps.sessions.hideConversation(conversationId, sessionPath)
    else if (sessionPath) deps.sessions.hideSession(sessionPath)
    send({ type: 'conversation:deleted', ...(requestId ? { requestId } : {}), sessionPath: sessionPath ?? '' })
  }

  async function deleteWorkspace(message: Extract<ClientMessage, { type: 'delete_workspace' }>, send: Send) {
    const requestId = message.requestId?.trim()
    const workspacePath = message.workspacePath ? normalizeWorkspacePath(message.workspacePath) : ''
    const activeTaskCount = workspacePath
      ? deps.piRunners.list().filter((snapshot) => (
          snapshot.cwd
          && normalizeWorkspacePath(snapshot.cwd) === workspacePath
          && isActiveRunner(snapshot)
        )).length
      : 0
    if (activeTaskCount > 0) {
      send({
        type: 'pi:error',
        ...(requestId ? { requestId } : {}),
        message: `工作区有 ${activeTaskCount} 个任务进行中，停止后才能移除`,
      })
      return
    }
    const deletedCount = workspacePath ? await deps.piRunners.shutdownWorkspace(workspacePath) : 0
    if (workspacePath) deps.sessions.hideWorkspace(workspacePath)
    send({ type: 'workspace:deleted', ...(requestId ? { requestId } : {}), workspacePath: workspacePath ?? '', deletedCount })
  }

  function restoreConversation(message: Extract<ClientMessage, { type: 'restore_conversation' }>, send: Send) {
    deps.sessions.restoreConversation(message.conversationId, message.sessionPath)
    send({
      type: 'conversation:restored',
      requestId: message.requestId,
      conversationId: message.conversationId,
    })
    send({ type: 'conversations:list', conversations: deps.sessions.listConversations() })
  }

  function restoreWorkspace(message: Extract<ClientMessage, { type: 'restore_workspace' }>, send: Send) {
    const workspacePath = normalizeWorkspacePath(message.workspacePath)
    deps.sessions.restoreWorkspace(workspacePath)
    send({ type: 'workspace:restored', requestId: message.requestId, workspacePath })
    send({ type: 'conversations:list', conversations: deps.sessions.listConversations() })
  }

  return {
    deleteConversation,
    deleteWorkspace,
    restoreConversation,
    restoreWorkspace,
    start,
  }
}

function isActiveRunner(snapshot: PiRunnerSnapshot | undefined): boolean {
  return snapshot?.phase === 'starting'
    || snapshot?.phase === 'running'
    || snapshot?.phase === 'stopping'
    || snapshot?.phase === 'terminating'
    || snapshot?.phase === 'termination_failed'
}
