import type { ChatMessage, Conversation } from '../../shared/chat.js'
import type { SessionRow } from './sessionIndexTypes.js'
import { buildAgentTurns } from './turnGrouping.js'

export function createConversationProjector() {
  return function projectConversation(row: SessionRow): Conversation {
    const messages = parseMessages(row.messagesJson)
    return {
      id: row.id,
      title: row.title,
      messages,
      turns: buildAgentTurns(messages),
      sessionPath: row.sourcePath,
      ...(row.workspacePath ? { workspacePath: row.workspacePath } : {}),
      kind: row.kind,
      source: 'pi',
      sourcePath: row.sourcePath,
      createdAt: row.createdAt,
    }
  }
}

function parseMessages(value: string): ChatMessage[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : []
  } catch {
    return []
  }
}
