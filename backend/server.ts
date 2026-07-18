import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import { isAuthorizedRequest } from './transport/auth.js'
import { type BackendEvent } from './events/bus.js'
import { createBackendRuntime } from './runtime/createBackendRuntime.js'
import { startParentWatchdog } from './process/parentWatchdog.js'

const backendToken = process.env.PI_DESKTOP_BACKEND_TOKEN
const clients = new Set<WebSocket>()

const runtime = createBackendRuntime({
  transportSubscriber(payload) {
    for (const socket of clients) {
      send(socket, payload)
    }
  },
})

const httpServer = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      ok: true,
      instanceId: runtime.instanceId,
    }))
    return
  }

  response.writeHead(404)
  response.end()
})

const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: 96 * 1024 * 1024,
})
const MAX_SOCKET_BUFFERED_BYTES = 16 * 1024 * 1024

wss.on('connection', (socket, request) => {
  if (!isAuthorizedRequest(request.url, backendToken)) {
    socket.close(1008, 'Unauthorized')
    return
  }

  clients.add(socket)
  const clientId = randomUUID()
  send(socket, { type: 'backend:ready', port: runtime.port })

  socket.on('message', (raw) => {
    runtime.dispatchClientMessage(raw.toString(), (payload) => send(socket, payload), clientId).catch((error) => {
      send(socket, {
        type: 'pi:error',
        message: error instanceof Error ? error.message : String(error),
      })
    })
  })

  socket.on('close', () => {
    clients.delete(socket)
    runtime.piRunners.setActiveConversation(clientId, null)
  })
})

httpServer.listen(runtime.port, '127.0.0.1', () => {
  console.log('[pi-desktop] source sessions dir:', runtime.sourceSessionsDir)
  console.log('[pi-desktop] data dir:', runtime.dataDir)
  console.log('[pi-desktop] indexed conversations:', runtime.sessions.listConversations().length)
  runtime.broadcast({ type: 'backend:ready', port: runtime.port })
})

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

let shutdownPromise: Promise<void> | null = null
let supervisorExited = false
const stopParentWatchdog = startParentWatchdog({
  expectedParentPid: process.env.PI_DESKTOP_SUPERVISOR_PID,
  onOrphaned() {
    supervisorExited = true
    shutdown()
  },
})

function send(socket: WebSocket, payload: BackendEvent) {
  if (socket.readyState !== socket.OPEN) return
  if (socket.bufferedAmount > MAX_SOCKET_BUFFERED_BYTES) {
    socket.terminate()
    return
  }
  try {
    socket.send(JSON.stringify(payload), (error) => {
      if (error) socket.terminate()
    })
  } catch {
    socket.terminate()
  }
}

function shutdown() {
  shutdownPromise ??= performShutdown()
}

async function performShutdown() {
  stopParentWatchdog()
  const shutdownResults = await Promise.allSettled([
    runtime.piRunners.shutdownAll(),
    runtime.settings.shutdown(),
  ])
  for (const result of shutdownResults) {
    if (result.status === 'fulfilled') continue
    // Electron supervisor 仍会对 backend process group 做最终收敛。单个异常 runner
    // 不能阻止 transport 关闭，否则 backend 会永久卡在退出路径。
    console.error('Failed to terminate a managed backend process cleanly', result.reason)
  }
  // ws.close() 只停止接收新连接，不会主动结束现有升级连接；显式终止后
  // httpServer.close() 才能稳定完成，避免 Electron 退出时遗留 backend 子进程。
  for (const socket of clients) socket.terminate()
  wss.close()
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  if (supervisorExited && process.platform !== 'win32') {
    try {
      // Electron 已不存在时没有外层 supervisor 可升级清理。backend 是 detached group
      // leader，此处连同仍继承该组的 Pi/installer 一起退出，避免孤儿进程长期占端口。
      process.kill(-process.pid, 'SIGKILL')
    } catch (error) {
      if (!isNoSuchProcess(error)) console.error('Failed to terminate orphaned backend process group', error)
    }
  }
  process.exit(0)
}

function isNoSuchProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}
