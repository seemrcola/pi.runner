import { describe, expect, it } from 'vitest'
import { shouldShowModelWorkingStatus } from '@/lib/messageWorkingStatus'
import type { ChatMessage } from '@shared/chat'

function message(role: ChatMessage['role'], status?: ChatMessage['status']): ChatMessage {
  return {
    id: `${role}-${status ?? 'done'}`,
    role,
    text: '',
    status,
    timestamp: 1,
  }
}

describe('model working status', () => {
  it('shows while the active runner is still running even if no text is streaming', () => {
    expect(shouldShowModelWorkingStatus([], true)).toBe(true)
  })

  it('shows while the latest assistant message is still streaming', () => {
    expect(shouldShowModelWorkingStatus([
      message('user'),
      message('assistant', 'streaming'),
    ], false)).toBe(true)
  })

  it('hides after the runner is idle and the latest assistant message is done', () => {
    expect(shouldShowModelWorkingStatus([
      message('user'),
      message('assistant', 'done'),
    ], false)).toBe(false)
  })
})
