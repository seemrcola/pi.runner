import { parseBackendMessage, type BackendMessage, type ClientMessage } from '@shared/protocol'

type TimerId = ReturnType<typeof setTimeout>

export type BackendSocketClientOptions = {
  WebSocketCtor?: typeof WebSocket
  getUrl(): Promise<string>
  onMessage(message: BackendMessage): void
  onConnected(): void
  onDisconnected(): void
  onError?(error: Error): void
  onStateChange?(state: 'connecting' | 'connected' | 'reconnecting' | 'offline'): void
  setTimeout?: (handler: () => void, timeout: number) => TimerId
  clearTimeout?: (id: TimerId) => void
}

export function getReconnectDelayMs(attempt: number): number {
  return Math.min(5000, 250 * 2 ** Math.max(0, attempt))
}

export function createBackendSocketClient(options: BackendSocketClientOptions) {
  const WebSocketCtor = options.WebSocketCtor ?? WebSocket
  const schedule = options.setTimeout ?? setTimeout
  const unschedule = options.clearTimeout ?? clearTimeout
  let socket: WebSocket | null = null
  let reconnectTimer: TimerId | null = null
  let reconnectAttempts = 0
  let closedByClient = false
  let connecting = false
  let connectGeneration = 0

  async function connect(): Promise<void> {
    if (connecting) return
    const generation = ++connectGeneration
    connecting = true
    if (reconnectAttempts === 0) options.onStateChange?.('connecting')
    else if (reconnectAttempts >= 3) options.onStateChange?.('reconnecting')
    closedByClient = false
    try {
      const url = await options.getUrl()
      if (closedByClient || generation !== connectGeneration) return
      const nextSocket = new WebSocketCtor(url)
      socket = nextSocket
      nextSocket.addEventListener('open', () => handleOpen(nextSocket))
      nextSocket.addEventListener('close', () => handleClose(nextSocket))
      nextSocket.addEventListener('error', handleError)
      nextSocket.addEventListener('message', handleMessage)
    } catch (error) {
      if (closedByClient || generation !== connectGeneration) return
      options.onError?.(error instanceof Error ? error : new Error(String(error)))
      scheduleReconnect()
    } finally {
      if (generation === connectGeneration) connecting = false
    }
  }

  function send(message: ClientMessage): boolean {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(message))
    return true
  }

  function close(): void {
    closedByClient = true
    connectGeneration += 1
    connecting = false
    if (reconnectTimer != null) {
      unschedule(reconnectTimer)
      reconnectTimer = null
    }
    socket?.close()
    socket = null
  }

  function handleOpen(openedSocket: WebSocket): void {
    if (socket !== openedSocket || closedByClient) return
    reconnectAttempts = 0
    options.onStateChange?.('connected')
    options.onConnected()
  }

  function handleClose(closedSocket: WebSocket): void {
    if (socket !== closedSocket) return
    socket = null
    options.onDisconnected()
    if (!closedByClient) scheduleReconnect()
  }

  function handleError(): void {
    options.onError?.(new Error('Backend socket error'))
  }

  function handleMessage(event: MessageEvent): void {
    try {
      const message = parseBackendMessage(String(event.data))
      if (!message) throw new Error('Invalid backend message')
      options.onMessage(message)
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error(String(error)))
    }
  }

  function scheduleReconnect(): void {
    if (reconnectTimer != null) return
    const delay = getReconnectDelayMs(reconnectAttempts)
    reconnectAttempts += 1
    options.onStateChange?.(reconnectAttempts >= 3 ? 'offline' : 'reconnecting')
    reconnectTimer = schedule(() => {
      reconnectTimer = null
      void connect()
    }, delay)
  }

  return {
    connect,
    send,
    close,
  }
}
