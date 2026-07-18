import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { parsePiRpcLine, serializeRpcCommand, type PiRpcEvent } from './rpcEvents.js'
import { buildProcessEnv, resolvePiExecutable, splitArgs, supportsApprove } from './cli.js'
import type { ImageContent } from '../../shared/chat.js'
import type { PromptStreamingBehavior } from '../../shared/protocol.js'
import { terminateChildProcess, type ProcessTerminationResult } from '../process/processTree.js'

type Broadcast = (payload: PiRpcEvent) => void
type PendingRequest = {
  resolve: (response: PiRpcResponse) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}
export type PiRpcResponse = {
  id: string
  success: boolean
  error?: string
  data?: unknown
}
type PiState = {
  sessionPath?: string
  sessionName?: string
}
type PiProcessDiagnostics = {
  command: string
  args: string[]
  cwd: string
  stderr: string[]
  exitCode: number | null
  exitSignal: string | null
}
type PiProcessLifecycle = {
  onSpawn?(pid: number): void
  onExit?(): void
  onTerminationFailed?(error: Error): void
}
type PiProcessPlatform = {
  resolveExecutable(): Promise<string>
  resolveProcessEnv(): Promise<NodeJS.ProcessEnv>
  supportsApprove(executable: string): Promise<boolean>
  spawnProcess: typeof spawn
  terminateProcess?(child: ChildProcessWithoutNullStreams): Promise<ProcessTerminationResult>
}

const defaultPlatform: PiProcessPlatform = {
  resolveExecutable: resolvePiExecutable,
  resolveProcessEnv: buildProcessEnv,
  supportsApprove,
  spawnProcess: spawn,
  terminateProcess: terminateChildProcess,
}

const MAX_PENDING_STDIN_BYTES = 96 * 1024 * 1024
const MAX_STDOUT_RECORD_BYTES = 16 * 1024 * 1024

export class PiProcessRunner {
  private piProcess: ChildProcessWithoutNullStreams | null = null
  private lineBuffer = ''
  private generation = 0
  private requestSeq = 0
  private pendingRequests = new Map<string, PendingRequest>()
  private diagnostics: PiProcessDiagnostics | null = null
  private pendingStdinBytes = 0
  private terminationFailure: Error | null = null
  private readonly terminatingProcesses = new WeakSet<ChildProcessWithoutNullStreams>()

  constructor(
    private readonly broadcast: Broadcast,
    private readonly lifecycle: PiProcessLifecycle = {},
    private readonly platform: PiProcessPlatform = defaultPlatform,
  ) {}

  isRunning(): boolean {
    return Boolean(
      this.piProcess
      && this.piProcess.exitCode == null
      && this.piProcess.signalCode == null,
    )
  }

  hasProcessHandle(): boolean {
    return this.piProcess !== null
  }

  getDiagnostics(): Readonly<PiProcessDiagnostics> | null {
    return this.diagnostics
  }

  async start(input: {
    cwd: string
    extraArgs?: string
    sessionPath: string
  }): Promise<void> {
    this.generation += 1
    const myGen = this.generation
    const previousProcess = this.piProcess
    this.lineBuffer = ''
    this.rejectPendingRequests(new Error('pi process restarted'))
    if (previousProcess) {
      // 旧进程只有在终止 helper 确认 terminal 后才清空；失败时保留 handle，
      // 防止直接调用 runner.start() 的路径绕过 Manager 后丢失进程所有权。
      await this.terminateTrackedProcess(previousProcess)
      this.assertStartIsCurrent(myGen)
    }

    const executable = await this.platform.resolveExecutable()
    this.assertStartIsCurrent(myGen)
    const processEnv = await this.platform.resolveProcessEnv()
    this.assertStartIsCurrent(myGen)
    const args = ['--mode', 'rpc']

    if (await this.platform.supportsApprove(executable)) {
      args.push('--approve')
    }
    this.assertStartIsCurrent(myGen)
    args.push('--session', input.sessionPath)
    args.push(...splitArgs(input.extraArgs))

    this.diagnostics = {
      command: executable,
      args: [...args],
      cwd: input.cwd,
      stderr: [],
      exitCode: null,
      exitSignal: null,
    }
    this.broadcast({ type: 'pi:status', message: `Starting pi ${args.join(' ')}` })

    const child = this.platform.spawnProcess(executable, args, {
      cwd: input.cwd,
      env: processEnv,
      shell: false,
    })
    this.piProcess = child
    this.lineBuffer = ''
    let didSpawn = false

    child.stdout.on('data', (chunk: Buffer) => {
      if (this.generation !== myGen) return
      this.consumeStdout(chunk.toString())
    })

    child.stderr.on('data', (chunk: Buffer) => {
      if (this.generation !== myGen) return
      const data = chunk.toString()
      if (this.diagnostics) {
        this.diagnostics.stderr.push(data)
        const stderr = this.diagnostics.stderr.join('')
        if (stderr.length > 8192) this.diagnostics.stderr = [stderr.slice(-4096)]
      }
      this.broadcast({ type: 'pi:stderr', data })
    })

    child.stdin.on('error', (error) => {
      if (this.generation !== myGen) return
      // spawn 失败可能同时让 stdin 报 EPIPE；启动阶段的失败统一由 child error
      // 交给 start() 返回，避免额外广播一次 runtime error。
      if (!didSpawn) return
      this.broadcast({ type: 'pi:error', message: this.formatDiagnosticError(error.message) })
      this.rejectPendingRequests(error)
      void this.terminateAfterRuntimeFailure(child, error)
    })

    child.on('error', (error) => {
      if (this.generation !== myGen) return
      this.rejectPendingRequests(error)
      // spawn 前的错误由 start() rejection 返回给请求方；只有已启动进程的后续错误
      // 才属于异步 runtime 事件，避免同一失败被广播两次并产生 error/exited 抖动。
      if (didSpawn) {
        this.broadcast({ type: 'pi:error', message: this.formatDiagnosticError(error.message) })
        void this.terminateAfterRuntimeFailure(child, error)
      } else {
        this.piProcess = null
      }
    })

    child.on('exit', (code, signal) => {
      if (this.generation !== myGen) return
      if (this.diagnostics) {
        this.diagnostics.exitCode = code
        this.diagnostics.exitSignal = signal
      }
      // exit 只表示 OS 进程结束，stdout/stderr 此时可能仍有缓冲数据。保留 child handle
      // 到 close，写入侧通过 exitCode 拒绝新请求，Manager 也不能在 terminal 前重启。
    })

    child.on('close', (code, signal) => {
      if (this.generation !== myGen) {
        // 终止 helper 成功时会自行提交；如果 helper 已失败后进程才最终 close，
        // 这里恢复为真实 terminal，允许 Manager 释放此前 fail-closed 的 lease。
        if (this.piProcess === child && !this.terminatingProcesses.has(child)) {
          this.piProcess = null
          this.terminationFailure = null
          this.lifecycle.onExit?.()
        }
        return
      }
      if (this.diagnostics) {
        this.diagnostics.exitCode = code
        this.diagnostics.exitSignal = signal
      }
      // close 保证 stdio 已排空；兼容最后一条没有换行但内容完整的 RPC 记录。
      if (this.lineBuffer.trim()) this.consumeStdout('\n')
      else this.lineBuffer = ''
      // 最后一条事件会同步进入 manager；例如 agent_end 可能触发空闲容量回收并调用
      // terminate()。此时当前 generation 已失效，close 不能再重复提交终态。
      if (this.generation !== myGen) return
      this.broadcast({
        type: 'pi:status',
        message: `pi exited code=${code ?? 0} signal=${signal ?? ''}`,
      })
      this.rejectPendingRequests(new Error(`pi exited code=${code ?? 0} signal=${signal ?? ''}`))
      this.piProcess = null
      this.generation += 1
      this.lifecycle.onExit?.()
    })

    // spawn() 只代表拿到了 ChildProcess 对象；可执行文件不存在等错误会异步触发 error。
    // 上层只有在 spawn 事件后才能发送 pi:started，否则首条 prompt 会被投递给不存在的进程。
    await new Promise<void>((resolve, reject) => {
      const onStartupError = (error: Error) => {
        if (this.generation === myGen) this.generation += 1
        reject(new Error(this.formatDiagnosticError(error.message)))
      }
      child.once('error', onStartupError)
      child.once('spawn', () => {
        didSpawn = true
        child.off('error', onStartupError)
        const pid = child.pid
        if (!pid) {
          void this.rejectSpawnAfterCleanup(child, new Error('Pi process spawned without a PID'), reject)
          return
        }
        try {
          this.lifecycle.onSpawn?.(pid)
          resolve()
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error))
          void this.rejectSpawnAfterCleanup(child, failure, reject)
        }
      })
    })
    this.assertStartIsCurrent(myGen)
  }

  async writePrompt(
    id: string,
    prompt: string,
    streamingBehavior?: PromptStreamingBehavior,
    images?: ImageContent[],
  ): Promise<PiRpcResponse> {
    const response = await this.request(id, {
      type: 'prompt',
      message: prompt,
      ...(streamingBehavior ? { streamingBehavior } : {}),
      ...(images?.length ? { images } : {}),
    })
    if (response.success) this.broadcast({ type: 'pi:response', ...response })
    return response
  }

  request(
    id: string,
    command: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<PiRpcResponse> {
    const child = this.piProcess
    if (!child || !this.isRunning()) {
      return Promise.reject(new Error('Pi process not started'))
    }
    if (this.pendingRequests.has(id)) {
      return Promise.reject(new Error(`Duplicate RPC request id: ${id}`))
    }

    const payload = serializeRpcCommand({ id, ...command })
    const payloadBytes = Buffer.byteLength(payload)
    if (this.pendingStdinBytes + payloadBytes > MAX_PENDING_STDIN_BYTES) {
      return Promise.reject(new Error('Pi stdin queue limit exceeded'))
    }
    const promise = new Promise<PiRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`RPC command timed out: ${String(command.type)}`))
      }, timeoutMs)
      this.pendingRequests.set(id, { resolve, reject, timer })
    })
    this.pendingStdinBytes += payloadBytes
    try {
      child.stdin.write(payload, (error?: Error | null) => {
        this.pendingStdinBytes = Math.max(0, this.pendingStdinBytes - payloadBytes)
        if (!error) return
        this.rejectPendingRequest(id, error)
      })
    } catch (error) {
      this.pendingStdinBytes = Math.max(0, this.pendingStdinBytes - payloadBytes)
      this.rejectPendingRequest(id, error instanceof Error ? error : new Error(String(error)))
    }
    return promise
  }

  async getState(timeoutMs = 30_000): Promise<PiState> {
    const response = await this.request(this.nextRequestId('state'), { type: 'get_state' }, timeoutMs)
    if (!response.success) throw new Error(response.error ?? 'get_state failed')
    const data =
      response.data && typeof response.data === 'object' && !Array.isArray(response.data)
        ? (response.data as Record<string, unknown>)
        : {}
    return {
      ...(typeof data.sessionFile === 'string' ? { sessionPath: data.sessionFile } : {}),
      ...(typeof data.sessionName === 'string' ? { sessionName: data.sessionName } : {}),
    }
  }

  abort(id: string): Promise<PiRpcResponse> {
    return this.request(id, { type: 'abort' })
  }

  async terminate(): Promise<ProcessTerminationResult> {
    // 先使尚在异步探测 executable/capability 的 start 失效，避免 shutdown 后再创建孤儿进程。
    this.generation += 1
    const child = this.piProcess
    this.rejectPendingRequests(new Error('pi process shut down'))
    this.pendingStdinBytes = 0
    if (!child) return { outcome: 'already-exited', forcedPids: [] }
    return this.terminateTrackedProcess(child)
  }

  private consumeStdout(chunk: string) {
    this.lineBuffer += chunk
    if (Buffer.byteLength(this.lineBuffer) > MAX_STDOUT_RECORD_BYTES) {
      const error = new Error('Pi stdout record exceeded 16MB limit')
      this.lineBuffer = ''
      this.broadcast({ type: 'pi:error', message: error.message })
      this.rejectPendingRequests(error)
      const child = this.piProcess
      if (child) void this.terminateAfterRuntimeFailure(child, error)
      return
    }
    const lines = this.lineBuffer.split('\n')
    this.lineBuffer = lines.pop() ?? ''

    for (const line of lines) {
      let event
      try {
        event = parsePiRpcLine(line)
      } catch (error) {
        this.broadcast({
          type: 'pi:error',
          message: `Failed to parse PI event: ${error instanceof Error ? error.message : String(error)}`,
        })
        continue
      }

      if (event) {
        if (event.type === 'pi:response' && this.resolvePendingRequest(event)) {
          continue
        }
        this.broadcast(event)
      }
    }
  }

  private resolvePendingRequest(response: PiRpcResponse): boolean {
    const pending = this.pendingRequests.get(response.id)
    if (!pending) return false
    this.pendingRequests.delete(response.id)
    clearTimeout(pending.timer)
    pending.resolve({
      id: response.id,
      success: response.success,
      ...(response.error != null ? { error: response.error } : {}),
      ...(response.data != null ? { data: response.data } : {}),
    })
    return true
  }

  private rejectPendingRequests(error: Error) {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }

  private rejectPendingRequest(id: string, error: Error): void {
    const pending = this.pendingRequests.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingRequests.delete(id)
    pending.reject(error)
  }

  private terminateProcess(child: ChildProcessWithoutNullStreams): Promise<ProcessTerminationResult> {
    return (this.platform.terminateProcess ?? terminateChildProcess)(child)
  }

  private async terminateTrackedProcess(child: ChildProcessWithoutNullStreams): Promise<ProcessTerminationResult> {
    this.terminatingProcesses.add(child)
    try {
      // exit 之后 close 之前，PID 已经不再是可靠的信号目标，但 stdio 仍可能有最后事件。
      // 此时只等待既有 close，不能把 exitCode 当成 terminal，也不能再次按 PID 强杀。
      const result = hasChildExited(child)
        ? await waitForTrackedClose(child)
        : await this.terminateProcess(child)
      if (this.piProcess === child) this.piProcess = null
      this.terminationFailure = null
      return result
    } catch (error) {
      this.terminationFailure = error instanceof Error ? error : new Error(String(error))
      throw this.terminationFailure
    } finally {
      this.terminatingProcesses.delete(child)
    }
  }

  private async terminateAfterRuntimeFailure(child: ChildProcessWithoutNullStreams, cause: Error): Promise<void> {
    if (this.piProcess !== child) return
    this.generation += 1
    try {
      await this.terminateTrackedProcess(child)
      this.lifecycle.onExit?.()
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      failure.cause = cause
      this.lifecycle.onTerminationFailed?.(failure)
    }
  }

  private async rejectSpawnAfterCleanup(
    child: ChildProcessWithoutNullStreams,
    error: Error,
    reject: (error: Error) => void,
  ): Promise<void> {
    this.generation += 1
    try {
      await this.terminateTrackedProcess(child)
      reject(error)
    } catch (terminationError) {
      reject(new AggregateError(
        [error, terminationError],
        'Pi spawn ownership registration failed and cleanup was incomplete',
      ))
    }
  }

  private formatDiagnosticError(message: string): string {
    if (!this.diagnostics) return message
    const stderr = this.diagnostics.stderr.join('').trim()
    const lines = [
      message,
      '',
      `pi path: ${this.diagnostics.command}`,
      `cwd: ${this.diagnostics.cwd}`,
      `args: ${this.diagnostics.args.join(' ')}`,
    ]
    if (stderr) lines.push(`stderr: ${stderr.length > 600 ? `...${stderr.slice(-600)}` : stderr}`)
    return lines.join('\n')
  }

  private nextRequestId(prefix: string): string {
    this.requestSeq += 1
    return `${prefix}-${this.generation}-${this.requestSeq}`
  }

  private assertStartIsCurrent(generation: number): void {
    if (this.generation !== generation) throw new Error('Pi process start cancelled')
  }
}

function hasChildExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

async function waitForTrackedClose(child: ChildProcessWithoutNullStreams): Promise<ProcessTerminationResult> {
  const pid = child.pid
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      new Promise<void>((resolve) => child.once('close', () => resolve())),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          `Process ${pid ?? 'unknown'} exited but stdio did not close`,
        )), 2_000)
      }),
    ])
    return { outcome: 'already-exited', ...(pid ? { pid } : {}), forcedPids: [] }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
