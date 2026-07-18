import { describe, expect, it } from 'vitest'
import {
  addPendingSteer,
  clearConversationRuntimeRequests,
  createConversationRuntime,
  drainPendingSteers,
  removePendingSteer,
} from '../../../src/lib/conversationRuntime'

describe('conversation UI runtime', () => {
  it('stores only local UI bookkeeping for a conversation', () => {
    const runtime = createConversationRuntime()

    expect(runtime).toEqual({
      draft: '',
      draftImages: [],
      activeTurn: null,
      pendingPromptId: null,
      pendingStartPrompt: null,
      activeStartRequest: null,
      rafId: null,
      pendingSteers: [],
    })
    expect(runtime).not.toHaveProperty('phase')
    expect(runtime).not.toHaveProperty('agentActive')
  })

  it('clears pending requests when a runtime is invalidated', () => {
    const runtime = createConversationRuntime()
    runtime.activeStartRequest = { requestId: 'start-1', conversationId: 'c1' }
    runtime.pendingPromptId = 'prompt-1'
    runtime.pendingStartPrompt = { id: 'prompt-after-start', text: 'hello after start' }

    clearConversationRuntimeRequests(runtime)

    expect(runtime.activeStartRequest).toBeNull()
    expect(runtime.pendingPromptId).toBeNull()
    expect(runtime.pendingStartPrompt).toBeNull()
  })

  it('stores removable pending steer prompts before they are submitted', () => {
    const runtime = createConversationRuntime()
    runtime.pendingPromptId = 'prompt-1'

    const pending = addPendingSteer(runtime, 'commit everything uncommitted')

    expect(runtime.pendingPromptId).toBe('prompt-1')
    expect(runtime.pendingSteers).toEqual([
      expect.objectContaining({
        id: pending.id,
        text: 'commit everything uncommitted',
      }),
    ])

    removePendingSteer(runtime, pending.id)

    expect(runtime.pendingSteers).toEqual([])
    expect(runtime.pendingPromptId).toBe('prompt-1')
  })

  it('drains pending steer prompts in creation order', () => {
    const runtime = createConversationRuntime()
    const first = addPendingSteer(runtime, 'first instruction')
    const second = addPendingSteer(runtime, 'second instruction')

    expect(drainPendingSteers(runtime)).toEqual([first, second])
    expect(runtime.pendingSteers).toEqual([])
  })
})
