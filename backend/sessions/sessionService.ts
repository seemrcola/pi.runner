import { normalizeWorkspacePath } from '../../shared/workspacePaths.js'
import { DEFAULT_CONVERSATION_TITLE } from '../../shared/chat.js'
import { createSessionIndexStore, type SessionIndexStore } from './sessionIndexStore.js'
import { createSessionStore, type SessionStore } from './sessionStore.js'

export type { SessionIndexSyncResult } from './sessionIndexStore.js'

export type PreparedConversationStart = {
  conversationId: string
  sessionPath: string
  cwd: string
  viewKind: 'session' | 'workspace'
  workspacePath?: string
  isNewSession: boolean
}

export type SessionService = SessionIndexStore & {
  prepareConversationStart(input: {
    conversationId: string
    sessionPath?: string | null
    cwd?: string | null
    mode?: 'session' | 'workspace'
  }): PreparedConversationStart
  recordConversationStart(
    start: PreparedConversationStart,
    options?: { title?: string; createdAt?: number },
  ): void
}

export function createSessionService(dbPath: string, sourceRoot: string): SessionService {
  return createSessionServiceFacade(
    createSessionStore(sourceRoot),
    createSessionIndexStore(dbPath, sourceRoot),
  )
}

export function createSessionServiceFacade(
  sessionStore: SessionStore,
  sessionIndex: SessionIndexStore,
): SessionService {
  return {
    ...sessionIndex,
    prepareConversationStart(input) {
      const viewKind = input.mode === 'workspace' ? 'workspace' : 'session'
      const cwd = input.cwd?.trim() ? normalizeWorkspacePath(input.cwd) : process.cwd()
      const sessionPath = sessionStore.resolveSessionPath(input.sessionPath)
      const workspacePath = viewKind === 'workspace' ? cwd : undefined

      return {
        conversationId: input.conversationId,
        sessionPath,
        cwd,
        viewKind,
        ...(workspacePath ? { workspacePath } : {}),
        isNewSession: !input.sessionPath?.trim(),
      }
    },
    recordConversationStart(start, options) {
      // 新建会话在 Pi 写出真实 JSONL 前需要占位行；继续已有会话只记录桌面展示意图。
      if (start.isNewSession) {
        sessionIndex.recordSessionPlaceholder({
          id: start.conversationId,
          sessionPath: start.sessionPath,
          title: options?.title ?? DEFAULT_CONVERSATION_TITLE,
          viewKind: start.viewKind,
          workspacePath: start.workspacePath,
          createdAt: options?.createdAt,
        })
      }
      sessionIndex.recordViewOverride(
        start.sessionPath,
        start.viewKind,
        start.workspacePath,
      )
    },
  }
}
