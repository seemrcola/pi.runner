import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import {
  type ChatMessage,
  type ChatMessageSegment,
  type Conversation,
  type ImageContent,
  isImageContentMimeType,
  type MessageRole,
  type ToolMeta,
} from '../../shared/chat.js'
import { normalizeWorkspacePath } from '../../shared/workspacePaths.js'
import { buildAgentTurns } from './turnGrouping.js'

type SessionRecord = {
  type?: string
  id?: string
  timestamp?: string | number
  cwd?: string
  sessionName?: unknown
  name?: unknown
  message?: {
    role?: string
    content?: unknown
    toolCallId?: string
    toolName?: string
    details?: unknown
    isError?: unknown
  }
  data?: {
    message?: {
      role?: string
      content?: unknown
      toolCallId?: string
      toolName?: string
      details?: unknown
      isError?: unknown
    }
  }
  role?: string
  content?: unknown
}

type MessagePayload = {
  role?: string
  content?: unknown
  toolCallId?: string
  toolName?: string
  details?: unknown
  isError?: unknown
}

type ParsedChatMessageRole = MessageRole | 'tool'

type ParsedChatMessage = Omit<ChatMessage, 'role'> & {
  role: ParsedChatMessageRole
}

type ParsedToolMessage = ParsedChatMessage & { role: 'tool' }
type ParsedConversationMessage = ParsedChatMessage & { role: MessageRole }

export type ParsedSession = Conversation & {
  sourcePath: string
  sourceMtime: number
  sourceSize: number
  updatedAt: number
}

export function readParsedSession(sourcePath: string, sourceMtime: number, sourceSize: number): ParsedSession {
  const content = readFileSync(sourcePath, 'utf8')
  const messages: ChatMessage[] = []
  let sessionId = ''
  let workspacePath = ''
  let title = ''
  let createdAt = 0
  let updatedAt = 0

  const lines = content.split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const record = parseRecord(trimmed, index === lines.length - 1)
    if (!record) continue

    title ||= cleanTitle(record.sessionName ?? record.name) ?? ''
    const recordTime = parseTimestamp(record.timestamp)
    if (recordTime) {
      if (!createdAt) createdAt = recordTime
      updatedAt = Math.max(updatedAt, recordTime)
    }

    if (record.type === 'session') {
      sessionId = record.id ?? sessionId
      workspacePath = record.cwd ? normalizeWorkspacePath(record.cwd) : workspacePath
      continue
    }

    const message = toChatMessage(record)
    if (!message) continue
    if (isParsedToolMessage(message)) {
      attachToolToAssistant(messages, message)
      continue
    }
    messages.push(finalizeHistoricalMessage(asConversationMessage(message)))
    if (message.role === 'user' && message.text && !title) title = cleanTitle(message.text) ?? ''
  }

  const fallbackTime = sourceMtime || Date.now()
  return {
    id: sessionId || basename(sourcePath, '.jsonl'),
    title: title || getConversationTitle(messages),
    messages,
    turns: buildAgentTurns(messages),
    sessionPath: sourcePath,
    ...(workspacePath ? { workspacePath } : {}),
    kind: workspacePath ? 'workspace' : 'session',
    source: 'pi',
    sourcePath,
    createdAt: createdAt || messages[0]?.timestamp || fallbackTime,
    updatedAt: updatedAt || messages[messages.length - 1]?.timestamp || createdAt || fallbackTime,
    sourceMtime,
    sourceSize,
  }
}

function parseRecord(line: string, isTrailingRecord: boolean): SessionRecord | null {
  try {
    const parsed = JSON.parse(line) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as SessionRecord) : null
  } catch (error) {
    // Pi 可能在 agent_end 与文件 flush 之间留下半行。此时不能把当前 mtime/size
    // 记成已索引，否则后续同步会永久跳过这条尚未完成的消息。
    if (isTrailingRecord) {
      throw new Error(`Incomplete trailing JSONL record: ${error instanceof Error ? error.message : String(error)}`)
    }
    return null
  }
}

function toChatMessage(record: SessionRecord): ParsedChatMessage | null {
  if (record.type && record.type !== 'message') return null
  const source: MessagePayload = record.message ?? record.data?.message ?? {
    role: record.role,
    content: record.content,
  }
  const role = normalizeRole(source.role)
  if (!role) return null

  const text = extractText(source.content)
  const thinking = extractThinking(source.content)
  const segments = extractMessageSegments(source.content)
  const images = role === 'user' ? extractImages(source.content) : []
  const timestamp = parseTimestamp(record.timestamp) || Date.now()
  if (role !== 'tool' && !text && !thinking && images.length === 0) return null

  const message: ParsedChatMessage = {
    id: record.id || `msg-${timestamp}`,
    role,
    text,
    timestamp,
  }
  if (thinking) message.thinking = thinking
  if (segments.length > 0) message.segments = segments
  if (images.length > 0) message.images = images
  if (role === 'tool') message.meta = buildToolMeta(source)
  return message
}

function normalizeRole(role: string | undefined): ParsedChatMessageRole | null {
  if (role === 'user' || role === 'assistant' || role === 'system') return role
  if (role === 'tool' || role === 'toolResult') return 'tool'
  return null
}

function finalizeHistoricalMessage(message: ChatMessage): ChatMessage {
  if (message.role === 'assistant') {
    message.tools ??= []
    message.status = 'done'
    message.thinkingActive = false
  }
  return message
}

function attachToolToAssistant(messages: ChatMessage[], toolMessage: ParsedToolMessage): void {
  const tool = isToolMeta(toolMessage.meta) ? toolMessage.meta : buildToolMeta({})
  let assistant = [...messages].reverse().find((message) => message.role === 'assistant')
  if (!assistant) {
    assistant = {
      id: `assistant-tools-${tool.toolCallId}`,
      role: 'assistant',
      text: '',
      timestamp: toolMessage.timestamp,
      tools: [],
      status: 'done',
      thinkingActive: false,
    }
    messages.push(assistant)
  }
  assistant.tools ??= []
  assistant.tools.push(tool)
  assistant.segments ??= []
  assistant.segments.push({ type: 'tool', toolCallId: tool.toolCallId, tool })
}

function isToolMeta(meta: ChatMessage['meta']): meta is ToolMeta {
  return Boolean(meta && 'toolCallId' in meta)
}

function isParsedToolMessage(message: ParsedChatMessage): message is ParsedToolMessage {
  return message.role === 'tool'
}

function asConversationMessage(message: ParsedChatMessage): ParsedConversationMessage {
  return message as ParsedConversationMessage
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const typedPart = part as { type?: string; text?: unknown; thinking?: unknown }
      if (typedPart.type === 'text' && typeof typedPart.text === 'string') return typedPart.text
      return typeof typedPart.text === 'string' ? typedPart.text : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function extractThinking(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const typedPart = part as { type?: string; thinking?: unknown }
      return typedPart.type === 'thinking' && typeof typedPart.thinking === 'string'
        ? typedPart.thinking
        : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function extractImages(content: unknown): ImageContent[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((part) => {
    if (!part || typeof part !== 'object') return []
    const typedPart = part as { type?: string; data?: unknown; mimeType?: unknown }
    if (typedPart.type !== 'image') return []
    if (typeof typedPart.data !== 'string' || !typedPart.data) return []
    if (typeof typedPart.mimeType !== 'string' || !isImageContentMimeType(typedPart.mimeType)) return []
    return [{ type: 'image', data: typedPart.data, mimeType: typedPart.mimeType }]
  })
}

function extractMessageSegments(content: unknown): ChatMessageSegment[] {
  if (typeof content === 'string') return content ? [{ type: 'text', content }] : []
  if (!Array.isArray(content)) return []
  const segments: ChatMessageSegment[] = []
  for (const part of content) {
    if (typeof part === 'string') {
      appendTextSegment(segments, 'text', part)
      continue
    }
    if (!part || typeof part !== 'object') continue
    const typedPart = part as { type?: string; text?: unknown; thinking?: unknown }
    if (typedPart.type === 'thinking' && typeof typedPart.thinking === 'string') {
      appendTextSegment(segments, 'thinking', typedPart.thinking)
      continue
    }
    const text = typeof typedPart.text === 'string' ? typedPart.text : ''
    if (text) appendTextSegment(segments, 'text', text)
  }
  return segments
}

function appendTextSegment(
  segments: ChatMessageSegment[],
  type: Extract<ChatMessageSegment['type'], 'thinking' | 'text'>,
  content: string,
): void {
  if (!content) return
  const latest = segments[segments.length - 1]
  if (latest?.type === type) {
    latest.content += `\n\n${content}`
    return
  }
  segments.push({ type, content })
}

function buildToolMeta(message: MessagePayload): ToolMeta {
  const details = extractToolDetails(message.details)
  const result = extractText(message.content)
  return {
    toolName: message.toolName ?? 'tool',
    toolCallId: message.toolCallId ?? 'history-tool',
    status: message.isError === true ? 'error' : 'done',
    ...(result ? { result } : {}),
    ...details,
  }
}

function extractToolDetails(details: unknown): Pick<ToolMeta, 'diff'> {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {}
  const typedDetails = details as { diff?: unknown }
  return {
    ...(typeof typedDetails.diff === 'string' ? { diff: typedDetails.diff } : {}),
  }
}

function getConversationTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user' && message.text)
  const title = firstUserMessage?.text || messages.find((message) => message.text)?.text
  if (!title) return 'Untitled conversation'
  return cleanTitle(title) ?? 'Untitled conversation'
}

function cleanTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text || /^untitled$/i.test(text)) return undefined
  return text.length > 40 ? `${text.slice(0, 40)}…` : text
}

function parseTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}
