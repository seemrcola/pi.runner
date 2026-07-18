import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BackendSupervisorEvent } from './backendSupervisor.js'

const MAX_LOG_BYTES = 2 * 1024 * 1024

export class BackendSupervisorLog {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  record(event: BackendSupervisorEvent): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      this.rotateIfNeeded()
      appendFileSync(this.filePath, `${JSON.stringify({
        timestamp: new Date().toISOString(),
        ...event,
      })}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch (error) {
      // 日志失败不能改变 backend 的拉起或清理决策。
      console.error('Failed to append backend supervisor log', error)
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

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
