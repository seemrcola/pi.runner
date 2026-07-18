import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DEFAULT_CONVERSATION_TITLE, isImageContentMimeType, type Conversation, type ImageContent } from '../../shared/chat.js'
import type { WorkspaceViewState } from '../../shared/protocol.js'
import { normalizeWorkspacePath } from '../../shared/workspacePaths.js'
import { ensureSessionIndexSchema } from './sessionIndexSchema.js'
import { assertSourceSessionPath, syncSessionIndex, syncSingleSession } from './sessionIndexSync.js'
import { createConversationProjector } from './sessionProjection.js'
import type { SessionIndexSyncResult, SessionRow } from './sessionIndexTypes.js'
export type { SessionIndexSyncResult }

export type SessionIndexStore = {
  sync(): SessionIndexSyncResult
  syncSession(sessionPath: string): SessionIndexSyncResult
  listConversations(): Conversation[]
  recordViewOverride(
    sessionPath: string,
    viewKind: 'session' | 'workspace',
    workspacePath?: string | null,
  ): void
  recordSessionPlaceholder(input: {
    id: string
    sessionPath: string
    title?: string
    viewKind: 'session' | 'workspace'
    workspacePath?: string | null
    createdAt?: number
  }): void
  recordMessageImages(input: {
    conversationId: string
    sessionPath?: string
    messageId: string
    promptText?: string
    images: ImageContent[]
  }): void
  listWorkspaceViewStates(): WorkspaceViewState[]
  upsertWorkspaceViewState(
    workspacePath: string,
    patch: { isPinned?: boolean; isCollapsed?: boolean },
  ): WorkspaceViewState
  hideSession(sessionPath: string): void
  hideConversation(conversationId: string, sessionPath?: string | null): void
  hideWorkspace(workspacePath: string): void
  restoreConversation(conversationId: string, sessionPath?: string | null): void
  restoreWorkspace(workspacePath: string): void
}

export function createSessionIndexStore(dbPath: string, sourceRoot: string): SessionIndexStore {
  const resolvedDbPath = resolve(dbPath)
  const resolvedSourceRoot = resolve(sourceRoot)
  const attachmentDir = join(dirname(resolvedDbPath), 'attachments')
  mkdirSync(dirname(resolvedDbPath), { recursive: true })
  mkdirSync(attachmentDir, { recursive: true })
  const db = new DatabaseSync(resolvedDbPath)
  ensureSessionIndexSchema(db)

  const selectMeta = db.prepare(`
    select
      source_mtime as sourceMtime,
      source_size as sourceSize,
      is_placeholder as isPlaceholder,
      parser_version as parserVersion,
      id
    from sessions
    where source_path = ?
  `)
  const selectSourcePaths = db.prepare('select source_path as sourcePath, is_placeholder as isPlaceholder from sessions')
  const deleteBySourcePath = db.prepare('delete from sessions where source_path = ?')
  const upsert = db.prepare(`
    insert into sessions (
      id,
      source_path,
      source_mtime,
      source_size,
      title,
      workspace_path,
      kind,
      created_at,
      updated_at,
      messages_json,
      last_indexed_at,
      parser_version,
      is_placeholder
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    on conflict(source_path) do update set
      id = case when sessions.is_placeholder = 1 then sessions.id else excluded.id end,
      source_mtime = excluded.source_mtime,
      source_size = excluded.source_size,
      title = excluded.title,
      workspace_path = excluded.workspace_path,
      kind = excluded.kind,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      messages_json = excluded.messages_json,
      last_indexed_at = excluded.last_indexed_at,
      parser_version = excluded.parser_version,
      is_placeholder = 0
  `)
  const upsertPlaceholder = db.prepare(`
    insert into sessions (
      id,
      source_path,
      source_mtime,
      source_size,
      title,
      workspace_path,
      kind,
      created_at,
      updated_at,
      messages_json,
      last_indexed_at,
      is_placeholder
    )
    values (?, ?, 0, 0, ?, ?, ?, ?, ?, '[]', ?, 1)
    on conflict(source_path) do update set
      id = excluded.id,
      title = excluded.title,
      workspace_path = excluded.workspace_path,
      kind = excluded.kind,
      updated_at = excluded.updated_at,
      last_indexed_at = excluded.last_indexed_at,
      is_placeholder = case when sessions.is_placeholder = 1 then 1 else sessions.is_placeholder end
  `)
  const selectConversations = db.prepare(`
    with projected as (
    select
      sessions.id,
      sessions.title,
      sessions.source_path as sourcePath,
      sessions.source_mtime as sourceMtime,
      sessions.source_size as sourceSize,
      case
        when session_view_overrides.view_kind = 'session' then null
        when session_view_overrides.view_kind = 'workspace' then coalesce(session_view_overrides.workspace_path, sessions.workspace_path)
        else sessions.workspace_path
      end as workspacePath,
      coalesce(session_view_overrides.view_kind, sessions.kind) as kind,
      sessions.created_at as createdAt,
      sessions.updated_at as updatedAt,
      sessions.messages_json as messagesJson
    from sessions
    left join session_view_overrides on session_view_overrides.session_path = sessions.source_path
    )
    select projected.*
    from projected
    left join hidden_sessions on hidden_sessions.session_path = projected.sourcePath
    left join hidden_workspaces
      on projected.kind = 'workspace'
      and projected.workspacePath = hidden_workspaces.workspace_path
    where hidden_sessions.session_path is null
      and hidden_workspaces.workspace_path is null
    order by projected.updatedAt desc
  `)
  const upsertViewOverride = db.prepare(`
    insert into session_view_overrides (session_path, view_kind, workspace_path, updated_at)
    values (?, ?, ?, ?)
    on conflict(session_path) do update set
      view_kind = excluded.view_kind,
      workspace_path = excluded.workspace_path,
      updated_at = excluded.updated_at
  `)
  const hideSessionStatement = db.prepare(`
    insert into hidden_sessions (session_path, hidden_at)
    values (?, ?)
    on conflict(session_path) do update set hidden_at = excluded.hidden_at
  `)
  const hideWorkspaceStatement = db.prepare(`
    insert into hidden_workspaces (workspace_path, hidden_at)
    values (?, ?)
    on conflict(workspace_path) do update set hidden_at = excluded.hidden_at
  `)
  const unhideSessionStatement = db.prepare('delete from hidden_sessions where session_path = ?')
  const unhideWorkspaceStatement = db.prepare('delete from hidden_workspaces where workspace_path = ?')
  const selectSessionPathById = db.prepare('select source_path as sourcePath from sessions where id = ? limit 1')
  const deleteMessageImages = db.prepare('delete from message_image_attachments where session_path = ? and message_id = ?')
  const insertMessageImage = db.prepare(`
    insert into message_image_attachments (
      session_path,
      message_id,
      position,
      prompt_text,
      mime_type,
      file_path,
      sha256,
      created_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const selectImageAttachments = db.prepare(`
    select
      session_path as sessionPath,
      message_id as messageId,
      position,
      prompt_text as promptText,
      mime_type as mimeType,
      file_path as filePath,
      sha256
    from message_image_attachments
    where session_path = ?
    order by message_id asc, position asc
  `)
  const selectWorkspaceViewStates = db.prepare(`
    select
      workspace_path as workspacePath,
      is_pinned as isPinned,
      is_collapsed as isCollapsed,
      pinned_at as pinnedAt,
      updated_at as updatedAt
    from workspace_view_states
    order by workspace_path asc
  `)
  const selectWorkspaceViewState = db.prepare(`
    select
      workspace_path as workspacePath,
      is_pinned as isPinned,
      is_collapsed as isCollapsed,
      pinned_at as pinnedAt,
      updated_at as updatedAt
    from workspace_view_states
    where workspace_path = ?
  `)
  const upsertWorkspaceViewStateStatement = db.prepare(`
    insert into workspace_view_states (
      workspace_path,
      is_pinned,
      is_collapsed,
      pinned_at,
      updated_at
    )
    values (?, ?, ?, ?, ?)
    on conflict(workspace_path) do update set
      is_pinned = excluded.is_pinned,
      is_collapsed = excluded.is_collapsed,
      pinned_at = excluded.pinned_at,
      updated_at = excluded.updated_at
  `)
  const syncStatements = {
    selectMeta,
    selectSourcePaths,
    deleteBySourcePath,
    upsert,
  }
  const projectConversation = createConversationProjector()

  return {
    sync() {
      return syncSessionIndex(resolvedSourceRoot, syncStatements)
    },
    syncSession(sessionPath) {
      return syncSingleSession(resolvedSourceRoot, sessionPath, syncStatements)
    },
    listConversations() {
      return (selectConversations.all() as SessionRow[])
        .map(projectConversation)
        .map(applyImageAttachments)
    },
    recordViewOverride(sessionPath, viewKind, workspacePath) {
      upsertViewOverride.run(
        resolve(sessionPath),
        viewKind,
        normalizeOptionalWorkspacePath(viewKind, workspacePath),
        Date.now(),
      )
    },
    recordSessionPlaceholder(input) {
      const sessionPath = resolve(input.sessionPath)
      const now = Date.now()
      const createdAt = input.createdAt ?? now
      const workspacePath = normalizeOptionalWorkspacePath(input.viewKind, input.workspacePath)
      upsertPlaceholder.run(
        input.id,
        sessionPath,
        input.title?.trim() || DEFAULT_CONVERSATION_TITLE,
        workspacePath,
        input.viewKind,
        createdAt,
        now,
        now,
      )
      upsertViewOverride.run(sessionPath, input.viewKind, workspacePath, now)
      unhideSessionStatement.run(sessionPath)
      if (workspacePath) unhideWorkspaceStatement.run(workspacePath)
    },
    recordMessageImages(input) {
      if (input.images.length === 0) return
      const sessionPath = resolveImageAttachmentSessionPath(input.sessionPath, input.conversationId)
      if (!sessionPath) return
      const messageId = input.messageId.trim()
      if (!messageId) return

      const now = Date.now()
      const preparedImages = input.images.map((image) => prepareImageAttachment(attachmentDir, image))
      for (const prepared of preparedImages) {
        if (!existsSync(prepared.filePath)) writeFileSync(prepared.filePath, prepared.buffer)
      }

      // 同一条 message 的图片映射必须整体替换，避免多图写入中断后留下半套 SQLite 投影。
      db.exec('begin immediate')
      try {
        deleteMessageImages.run(sessionPath, messageId)
        preparedImages.forEach((prepared, index) => {
          insertMessageImage.run(
            sessionPath,
            messageId,
            index,
            input.promptText ?? null,
            prepared.image.mimeType,
            prepared.filePath,
            prepared.sha256,
            now,
          )
        })
        db.exec('commit')
      } catch (error) {
        db.exec('rollback')
        throw error
      }
    },
    listWorkspaceViewStates() {
      return (selectWorkspaceViewStates.all() as WorkspaceViewStateRow[]).map(normalizeWorkspaceViewState)
    },
    upsertWorkspaceViewState(workspacePath, patch) {
      const normalizedPath = normalizeWorkspacePath(workspacePath)
      if (!normalizedPath) throw new Error('workspacePath is required')
      const existing = selectWorkspaceViewState.get(normalizedPath) as WorkspaceViewStateRow | undefined
      const previous = existing ? normalizeWorkspaceViewState(existing) : null
      const now = Date.now()
      const isPinned = patch.isPinned ?? previous?.isPinned ?? false
      const isCollapsed = patch.isCollapsed ?? previous?.isCollapsed ?? false
      const pinnedAt = isPinned ? previous?.pinnedAt ?? now : null

      upsertWorkspaceViewStateStatement.run(
        normalizedPath,
        isPinned ? 1 : 0,
        isCollapsed ? 1 : 0,
        pinnedAt,
        now,
      )

      return {
        workspacePath: normalizedPath,
        isPinned,
        isCollapsed,
        pinnedAt,
        updatedAt: now,
      }
    },
    hideSession(sessionPath) {
      hideSessionStatement.run(resolve(sessionPath), Date.now())
    },
    hideConversation(conversationId, sessionPath) {
      const directPath = sessionPath?.trim()
      if (directPath) {
        hideSessionStatement.run(resolve(directPath), Date.now())
        return
      }
      const row = selectSessionPathById.get(conversationId.trim()) as { sourcePath: string } | undefined
      if (row?.sourcePath) hideSessionStatement.run(row.sourcePath, Date.now())
    },
    hideWorkspace(workspacePath) {
      const normalized = normalizeWorkspacePath(workspacePath)
      if (!normalized) return
      hideWorkspaceStatement.run(normalized, Date.now())
    },
    restoreConversation(conversationId, sessionPath) {
      const directPath = sessionPath?.trim()
      if (directPath) {
        unhideSessionStatement.run(resolve(directPath))
        return
      }
      const row = selectSessionPathById.get(conversationId.trim()) as { sourcePath: string } | undefined
      if (row?.sourcePath) unhideSessionStatement.run(row.sourcePath)
    },
    restoreWorkspace(workspacePath) {
      const normalized = normalizeWorkspacePath(workspacePath)
      if (normalized) unhideWorkspaceStatement.run(normalized)
    },
  }

  function resolveImageAttachmentSessionPath(sessionPath: string | undefined, conversationId: string): string | null {
    const directPath = sessionPath?.trim()
    if (directPath) {
      const resolvedPath = resolve(directPath)
      try {
        assertSourceSessionPath(resolvedSourceRoot, resolvedPath)
        return resolvedPath
      } catch {
        return null
      }
    }

    const row = selectSessionPathById.get(conversationId.trim()) as { sourcePath: string } | undefined
    return row?.sourcePath ?? null
  }

  function applyImageAttachments(conversation: Conversation): Conversation {
    const sessionPath = conversation.sessionPath
    if (!sessionPath) return conversation
    const rows = selectImageAttachments.all(sessionPath) as ImageAttachmentRow[]
    if (rows.length === 0) return conversation

    const byMessageId = new Map<string, ImageContent[]>()
    const fallbackGroups = new Map<string, { promptText: string; images: ImageContent[] }>()
    for (const row of rows) {
      if (!existsSync(row.filePath)) continue
      if (!isImageContentMimeType(row.mimeType)) continue
      const list = byMessageId.get(row.messageId) ?? []
      const image = {
        type: 'image',
        data: readFileSync(row.filePath).toString('base64'),
        mimeType: row.mimeType,
      } satisfies ImageContent
      list.push(image)
      byMessageId.set(row.messageId, list)

      const fallback = fallbackGroups.get(row.messageId) ?? { promptText: row.promptText ?? '', images: [] }
      fallback.images.push(image)
      fallbackGroups.set(row.messageId, fallback)
    }

    const matchedMessageIds = new Set<string>()
    for (const message of conversation.messages) {
      const images = byMessageId.get(message.id)
      if (message.role !== 'user' || !images?.length || message.images?.length) continue
      message.images = images
      matchedMessageIds.add(message.id)
      fallbackGroups.delete(message.id)
    }

    const unmatchedGroups = [...fallbackGroups.values()]
    const userMessages = conversation.messages.filter((message) => message.role === 'user')
    for (const group of unmatchedGroups) {
      const target = findFallbackImageTarget(userMessages, matchedMessageIds, group.promptText)
      if (!target) continue
      if (target.images?.length) {
        matchedMessageIds.add(target.id)
        continue
      }
      target.images = group.images
      matchedMessageIds.add(target.id)
    }
    return conversation
  }
}

type WorkspaceViewStateRow = {
  workspacePath: string
  isPinned: number | boolean
  isCollapsed: number | boolean
  pinnedAt: number | null
  updatedAt: number
}

type ImageAttachmentRow = {
  sessionPath: string
  messageId: string
  position: number
  promptText: string | null
  mimeType: string
  filePath: string
  sha256: string
}

function findFallbackImageTarget(
  messages: Conversation['messages'],
  matchedMessageIds: Set<string>,
  promptText: string,
): Conversation['messages'][number] | null {
  const normalizedPrompt = promptText.trim()
  if (normalizedPrompt) {
    const textMatch = messages.find(
      (message) => !matchedMessageIds.has(message.id) && message.text.trim() === normalizedPrompt,
    )
    if (textMatch) return textMatch
  }
  return messages.find((message) => !matchedMessageIds.has(message.id) && !message.images?.length) ?? null
}

function prepareImageAttachment(attachmentDir: string, image: ImageContent): {
  image: ImageContent
  buffer: Buffer
  sha256: string
  filePath: string
} {
  const buffer = Buffer.from(image.data, 'base64')
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  return {
    image,
    buffer,
    sha256,
    filePath: join(attachmentDir, `${sha256}${extensionForMimeType(image.mimeType)}`),
  }
}

function extensionForMimeType(mimeType: ImageContent['mimeType']): string {
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/gif') return '.gif'
  return '.webp'
}

function normalizeWorkspaceViewState(row: WorkspaceViewStateRow): WorkspaceViewState {
  return {
    workspacePath: row.workspacePath,
    isPinned: Boolean(row.isPinned),
    isCollapsed: Boolean(row.isCollapsed),
    pinnedAt: row.pinnedAt,
    updatedAt: row.updatedAt,
  }
}

function normalizeOptionalWorkspacePath(
  viewKind: 'session' | 'workspace',
  workspacePath?: string | null,
): string | null {
  if (viewKind !== 'workspace') return null
  const normalized = workspacePath ? normalizeWorkspacePath(workspacePath) : ''
  return normalized || null
}
