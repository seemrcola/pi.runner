import type { ChatMessage } from '@shared/chat'

export function shouldShowModelWorkingStatus(messages: ChatMessage[], isRunning: boolean): boolean {
  if (isRunning) return true

  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
  return latestAssistant?.status === 'streaming'
}
