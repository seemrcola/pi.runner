import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { getBackendRestartDelayMs } from './backendProcess.js'
import { terminateProcessGroup } from './processGroup.js'

type BackendRecord = {
  child: ChildProcessWithoutNullStreams
  groupId?: number
  instanceId: string
  startedAt: number
  finalizing: Promise<void> | null
}

export type BackendSupervisorEvent = {
  event:
    | 'spawned'
    | 'ready'
    | 'cleanup_started'
    | 'cleanup_completed'
    | 'cleanup_retry_scheduled'
    | 'restart_scheduled'
    | 'error'
  instanceId?: string
  pid?: number
  groupId?: number
  outcome?: string
  delayMs?: number
  attempt?: number
  errorName?: string
}

export type BackendSupervisorOptions = {
  spawnBackend(): { child: ChildProcessWithoutNullStreams; instanceId: string }
  verifyReady(instanceId: string): Promise<void>
  terminateGroup?: (groupId: number) => Promise<unknown>
  setTimeout?: typeof setTimeout
  clearTimeout?: typeof clearTimeout
  onStdout?(data: string): void
  onStderr?(data: string): void
  onSupervisorError?(error: Error): void
  onEvent?(event: BackendSupervisorEvent): void
}

export class BackendProcessSupervisor {
  private readonly options: BackendSupervisorOptions
  private current: BackendRecord | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private restartAttempts = 0
  private stopping = false

  constructor(options: BackendSupervisorOptions) {
    this.options = options
  }

  start(): void {
    if (this.stopping || this.current || this.restartTimer) return

    let spawned: ReturnType<BackendSupervisorOptions['spawnBackend']>
    try {
      spawned = this.options.spawnBackend()
    } catch (error) {
      this.report(error)
      this.scheduleRestart()
      return
    }

    const record: BackendRecord = {
      child: spawned.child,
      instanceId: spawned.instanceId,
      startedAt: Date.now(),
      finalizing: null,
      ...(process.platform !== 'win32' && spawned.child.pid ? { groupId: spawned.child.pid } : {}),
    }
    this.current = record
    this.emit({
      event: 'spawned',
      instanceId: record.instanceId,
      ...(record.child.pid ? { pid: record.child.pid } : {}),
      ...(record.groupId ? { groupId: record.groupId } : {}),
    })

    record.child.stdout.on('data', (chunk: Buffer) => this.options.onStdout?.(chunk.toString()))
    record.child.stderr.on('data', (chunk: Buffer) => this.options.onStderr?.(chunk.toString()))
    record.child.once('error', (error) => {
      this.report(error, record)
      void this.finalize(record).catch(() => {})
    })
    record.child.once('close', () => void this.finalize(record).catch(() => {}))

    void this.options.verifyReady(record.instanceId).then(
      () => {
        if (this.current !== record || record.finalizing) return
        this.emit({
          event: 'ready',
          instanceId: record.instanceId,
          ...(record.child.pid ? { pid: record.child.pid } : {}),
        })
      },
      (error) => {
        if (this.current !== record || record.finalizing) return
        this.report(error, record)
        void this.finalize(record).catch(() => {})
      },
    )
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.clearRestartTimer()
    const record = this.current
    if (!record) return
    if (!record.finalizing && record.child.exitCode == null && record.child.signalCode == null) {
      const close = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 7_000)
        record.child.once('close', () => {
          clearTimeout(timer)
          resolve(true)
        })
      })
      try {
        record.child.kill('SIGTERM')
      } catch (error) {
        if (!isNoSuchProcess(error)) throw error
      }
      await close
    }
    await this.finalize(record)
  }

  private finalize(record: BackendRecord): Promise<void> {
    if (record.finalizing) return record.finalizing
    const finalizing = this.performFinalize(record)
    record.finalizing = finalizing
    void finalizing.catch(() => {
      // performFinalize 可能在第一个 await 之前同步抛错；统一在 Promise 已缓存后
      // 清空，保证用户再次退出时可以重试 group cleanup。
      if (record.finalizing === finalizing) record.finalizing = null
    })
    return finalizing
  }

  private async performFinalize(record: BackendRecord): Promise<void> {
    this.emit({
      event: 'cleanup_started',
      instanceId: record.instanceId,
      ...(record.child.pid ? { pid: record.child.pid } : {}),
      ...(record.groupId ? { groupId: record.groupId } : {}),
    })
    try {
      let outcome: unknown
      if (record.groupId) {
        outcome = await (this.options.terminateGroup ?? terminateProcessGroup)(record.groupId)
      } else if (record.child.exitCode == null && record.child.signalCode == null) {
        record.child.kill('SIGTERM')
        outcome = 'signal-sent'
      }
      this.emit({
        event: 'cleanup_completed',
        instanceId: record.instanceId,
        ...(record.child.pid ? { pid: record.child.pid } : {}),
        ...(record.groupId ? { groupId: record.groupId } : {}),
        ...(typeof outcome === 'string' ? { outcome } : {}),
      })
    } catch (error) {
      this.report(error, record)
      // 旧进程树身份仍不确定时不能启动下一套 backend，否则内存 lease 会失去意义。
      this.current = record
      if (!this.stopping) this.scheduleCleanupRetry(record)
      throw error
    }

    if (this.current === record) this.current = null
    if (Date.now() - record.startedAt > 30_000) this.restartAttempts = 0
    if (!this.stopping) this.scheduleRestart()
  }

  private scheduleRestart(): void {
    if (this.stopping || this.restartTimer) return
    const delay = getBackendRestartDelayMs(this.restartAttempts)
    const attempt = this.restartAttempts + 1
    this.restartAttempts += 1
    this.emit({ event: 'restart_scheduled', delayMs: delay, attempt })
    const schedule = this.options.setTimeout ?? setTimeout
    this.restartTimer = schedule(() => {
      this.restartTimer = null
      this.start()
    }, delay)
    ;(this.restartTimer as NodeJS.Timeout).unref?.()
  }

  private scheduleCleanupRetry(record: BackendRecord): void {
    if (this.stopping || this.restartTimer || this.current !== record) return
    const delay = getBackendRestartDelayMs(this.restartAttempts)
    const attempt = this.restartAttempts + 1
    this.restartAttempts += 1
    this.emit({
      event: 'cleanup_retry_scheduled',
      instanceId: record.instanceId,
      ...(record.child.pid ? { pid: record.child.pid } : {}),
      delayMs: delay,
      attempt,
    })
    const schedule = this.options.setTimeout ?? setTimeout
    this.restartTimer = schedule(() => {
      this.restartTimer = null
      if (this.stopping || this.current !== record) return
      void this.finalize(record).catch(() => {})
    }, delay)
    ;(this.restartTimer as NodeJS.Timeout).unref?.()
  }

  private clearRestartTimer(): void {
    if (!this.restartTimer) return
    ;(this.options.clearTimeout ?? clearTimeout)(this.restartTimer)
    this.restartTimer = null
  }

  private report(error: unknown, record?: BackendRecord): void {
    const normalized = error instanceof Error ? error : new Error(String(error))
    this.emit({
      event: 'error',
      ...(record ? { instanceId: record.instanceId } : {}),
      ...(record?.child.pid ? { pid: record.child.pid } : {}),
      errorName: normalized.name,
    })
    this.options.onSupervisorError?.(normalized)
  }

  private emit(event: BackendSupervisorEvent): void {
    try {
      this.options.onEvent?.(event)
    } catch (error) {
      // 诊断写入不能反向打断 supervisor 状态机。
      this.options.onSupervisorError?.(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

function isNoSuchProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}
