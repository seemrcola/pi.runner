import type { AgentTurn, ChatMessage } from '../../shared/chat.js'

export function buildAgentTurns(messages: ChatMessage[]): AgentTurn[] {
  const turns: AgentTurn[] = []
  let current: AgentTurn | null = null

  for (const message of messages) {
    if (message.role === 'user') {
      current = createAgentTurn(message.id)
      turns.push(current)
      current.messageIds.push(message.id)
      continue
    }

    if (!current) {
      current = createAgentTurn(message.id)
      turns.push(current)
    }
    current.messageIds.push(message.id)
  }

  return turns
}

function createAgentTurn(id: string): AgentTurn {
  return {
    id,
    messageIds: [],
  }
}
