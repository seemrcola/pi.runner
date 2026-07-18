import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

const MAX_LOG_BYTES = 2 * 1024 * 1024

export type ProcessLifecycleLogEvent = {
  event: string
  conversationId?: string
  sessionPath?: string
  phase?: string
  pid?: number
  outcome?: string
  errorName?: string
}

export type ProcessLifecycleLog = {
  record(event: ProcessLifecycleLogEvent): void
}

export class JsonlProcessLifecycleLog implements ProcessLifecycleLog {
  constructor(
    private readonly filePath: string,
    private readonly instanceId: string,
  ) {}

  record(event: ProcessLifecycleLogEvent): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      this.rotateIfNeeded()
      appendFileSync(this.filePath, `${JSON.stringify({
        timestamp: new Date().toISOString(),
        instanceId: this.instanceId,
        event: event.event,
        ...(event.conversationId ? { conversationId: event.conversationId } : {}),
        ...(event.sessionPath ? { sessionHash: hashSessionPath(event.sessionPath) } : {}),
        ...(event.phase ? { phase: event.phase } : {}),
        ...(event.pid ? { pid: event.pid } : {}),
        ...(event.outcome ? { outcome: event.outcome } : {}),
        ...(event.errorName ? { errorName: event.errorName } : {}),
      })}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch (error) {
      // 诊断日志不能反向破坏 runner 生命周期；失败只留在 stderr，业务状态继续收敛。
      console.error('Failed to append process lifecycle log', error)
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (statSync(this.filePath).size < MAX_LOG_BYTES) return
      const previousPath = `${this.filePath}.1`
      rmSync(previousPath, { force: true })
      renameSync(this.filePath, previousPath)
    } catch (error) {
      if (!isNodeErrorWithCode(error, 'ENOENT')) throw error
    }
  }
}

export const noopProcessLifecycleLog: ProcessLifecycleLog = {
  record() {},
}

function hashSessionPath(sessionPath: string): string {
  return createHash('sha256').update(sessionPath).digest('hex').slice(0, 16)
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
