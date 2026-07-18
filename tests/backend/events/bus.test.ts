import { describe, expect, it, vi } from 'vitest'
import { createBackendEventBus } from '../../../backend/events/bus.js'

describe('backend event bus', () => {
  it('continues dispatching when one subscriber fails', () => {
    const received: string[] = []
    const onSubscriberError = vi.fn()
    const bus = createBackendEventBus([
      () => {
        throw new Error('transport failed')
      },
      (payload) => received.push(payload.type),
    ], onSubscriberError)

    expect(() => bus.emit({ type: 'backend:pong' })).not.toThrow()
    expect(received).toEqual(['backend:pong'])
    expect(onSubscriberError).toHaveBeenCalledWith(expect.objectContaining({ message: 'transport failed' }))
  })
})
