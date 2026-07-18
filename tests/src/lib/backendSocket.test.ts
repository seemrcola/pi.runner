import { describe, expect, it, vi } from 'vitest'
import { createBackendSocketClient, getReconnectDelayMs } from '../../../src/lib/backendSocket'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readyState = 0
  sent: string[] = []
  listeners = new Map<string, Array<(event?: unknown) => void>>()

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event?: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  send(payload: string) {
    this.sent.push(payload)
  }

  close() {
    this.readyState = 3
  }

  emit(type: string, event?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

describe('backend socket client', () => {
  it('uses capped reconnect backoff', () => {
    expect(getReconnectDelayMs(0)).toBe(250)
    expect(getReconnectDelayMs(1)).toBe(500)
    expect(getReconnectDelayMs(4)).toBe(4000)
    expect(getReconnectDelayMs(10)).toBe(5000)
  })

  it('connects, sends typed payloads, and parses messages', () => {
    FakeWebSocket.instances = []
    const onMessage = vi.fn()
    const onConnected = vi.fn()
    const client = createBackendSocketClient({
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      getUrl: async () => 'ws://backend',
      onMessage,
      onConnected,
      onDisconnected: vi.fn(),
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    })

    return client.connect().then(() => {
      const socket = FakeWebSocket.instances[0]
      socket.readyState = 1
      socket.emit('open')
      client.send({ type: 'ping' })
      socket.emit('message', { data: '{"type":"backend:pong"}' })

      expect(onConnected).toHaveBeenCalledTimes(1)
      expect(socket.sent).toEqual(['{"type":"ping"}'])
      expect(onMessage).toHaveBeenCalledWith({ type: 'backend:pong' })
    })
  })

  it('rejects malformed backend messages before they reach reducers', async () => {
    FakeWebSocket.instances = []
    const onMessage = vi.fn()
    const onError = vi.fn()
    const client = createBackendSocketClient({
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      getUrl: async () => 'ws://backend',
      onMessage,
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
      onError,
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    })

    await client.connect()
    FakeWebSocket.instances[0].emit('message', {
      data: '{"type":"runner:snapshot","snapshot":{"conversationId":"c1","phase":"bad","createdAt":1,"lastActiveAt":2}}',
    })

    expect(onMessage).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid backend message' }))
  })

  it('schedules reconnect after an unexpected close', async () => {
    FakeWebSocket.instances = []
    const schedule = vi.fn()
    const onDisconnected = vi.fn()
    const client = createBackendSocketClient({
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      getUrl: async () => 'ws://backend',
      onMessage: vi.fn(),
      onConnected: vi.fn(),
      onDisconnected,
      setTimeout: schedule,
      clearTimeout: vi.fn(),
    })

    await client.connect()
    FakeWebSocket.instances[0].emit('close')

    expect(onDisconnected).toHaveBeenCalledTimes(1)
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 250)
  })

  it('does not create a socket after close cancels an in-flight URL request', async () => {
    FakeWebSocket.instances = []
    let resolveUrl: ((url: string) => void) | undefined
    const client = createBackendSocketClient({
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      getUrl: () => new Promise((resolve) => { resolveUrl = resolve }),
      onMessage: vi.fn(),
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    })

    const connecting = client.connect()
    client.close()
    resolveUrl?.('ws://backend')
    await connecting

    expect(FakeWebSocket.instances).toEqual([])
  })

  it('reports URL lookup failures and schedules recovery', async () => {
    const schedule = vi.fn()
    const onError = vi.fn()
    const client = createBackendSocketClient({
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      getUrl: async () => { throw new Error('IPC unavailable') },
      onMessage: vi.fn(),
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
      onError,
      setTimeout: schedule,
      clearTimeout: vi.fn(),
    })

    await client.connect()

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'IPC unavailable' }))
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 250)
  })

  it('reports connecting, reconnecting, and offline recovery states', async () => {
    FakeWebSocket.instances = []
    const states: string[] = []
    const scheduled: Array<() => void> = []
    const client = createBackendSocketClient({
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      getUrl: async () => 'ws://backend',
      onMessage: vi.fn(),
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
      onStateChange: (state) => states.push(state),
      setTimeout: (callback) => { scheduled.push(callback); return scheduled.length as unknown as ReturnType<typeof setTimeout> },
      clearTimeout: vi.fn(),
    })

    await client.connect()
    FakeWebSocket.instances[0].emit('open')
    FakeWebSocket.instances[0].emit('close')
    scheduled.shift()?.()
    await Promise.resolve()
    FakeWebSocket.instances[1].emit('close')
    scheduled.shift()?.()
    await Promise.resolve()
    FakeWebSocket.instances[2].emit('close')

    expect(states).toEqual(['connecting', 'connected', 'reconnecting', 'reconnecting', 'offline'])
  })
})
