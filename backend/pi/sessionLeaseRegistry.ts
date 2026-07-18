import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import {
  readProcessIdentity,
  type ProcessIdentity,
  type ProcessIdentityReader,
} from '../process/processIdentity.js'

type RuntimeLockMetadata = {
  schemaVersion: 1
  sessionPath: string
  conversationId: string
  ownerInstanceId: string
  owner: ProcessIdentity
  writer?: ProcessIdentity
  createdAt: number
}

type LeaseRecord = {
  conversationId: string
  lockDirectory?: string
  metadata?: RuntimeLockMetadata
}

export type SessionLeaseRegistryOptions = {
  runtimeDir?: string
  instanceId?: string
  readProcessIdentity?: ProcessIdentityReader
}

export class SessionLeaseRegistry {
  private readonly owners = new Map<string, LeaseRecord>()
  private readonly instanceId: string
  private readonly ownerIdentity: ProcessIdentity
  private readonly readIdentity: ProcessIdentityReader

  constructor(private readonly options: SessionLeaseRegistryOptions = {}) {
    this.instanceId = options.instanceId ?? randomUUID()
    this.readIdentity = options.readProcessIdentity ?? readProcessIdentity
    this.ownerIdentity = this.readIdentity(process.pid) ?? {
      pid: process.pid,
      // ps 不可用时仍写入不可伪造的实例标识；后续恢复无法确认身份，因此会 fail closed。
      startedAt: `unverified:${this.instanceId}`,
      command: process.execPath,
    }
  }

  ownerOf(sessionPath: string): string | undefined {
    return this.owners.get(canonicalizeSessionPath(sessionPath))?.conversationId
  }

  claim(sessionPath: string, conversationId: string): void {
    const sessionKey = canonicalizeSessionPath(sessionPath)
    const owner = this.owners.get(sessionKey)
    if (owner && owner.conversationId !== conversationId) {
      throw new Error('Session is already open in another conversation')
    }
    if (owner) return

    const record: LeaseRecord = { conversationId }
    if (this.options.runtimeDir) {
      const lockDirectory = this.acquireRuntimeLock(sessionKey, conversationId)
      record.lockDirectory = lockDirectory
      record.metadata = this.readMetadata(lockDirectory)
    }
    this.owners.set(sessionKey, record)
  }

  setWriter(sessionPath: string, conversationId: string, pid: number): void {
    const sessionKey = canonicalizeSessionPath(sessionPath)
    const record = this.owners.get(sessionKey)
    if (!record || record.conversationId !== conversationId) {
      throw new Error('Cannot register writer without owning the session lease')
    }
    if (!record.lockDirectory || !record.metadata) return
    const writer = this.readIdentity(pid)
    if (!writer) throw new Error(`Cannot verify Pi writer process ${pid}`)
    record.metadata = { ...record.metadata, writer }
    this.writeMetadata(record.lockDirectory, record.metadata)
  }

  transfer(sessionPath: string, fromConversationId: string, toConversationId: string): void {
    const sessionKey = canonicalizeSessionPath(sessionPath)
    const record = this.owners.get(sessionKey)
    if (!record || record.conversationId !== fromConversationId) {
      throw new Error('Cannot transfer a session lease not owned by the source conversation')
    }
    let nextMetadata = record.metadata
    if (record.lockDirectory && record.metadata) {
      nextMetadata = { ...record.metadata, conversationId: toConversationId }
      this.writeMetadata(record.lockDirectory, nextMetadata)
    }
    record.conversationId = toConversationId
    record.metadata = nextMetadata
  }

  release(sessionPath: string, conversationId: string): void {
    const sessionKey = canonicalizeSessionPath(sessionPath)
    const record = this.owners.get(sessionKey)
    if (!record || record.conversationId !== conversationId) return
    if (record.lockDirectory) rmSync(record.lockDirectory, { recursive: true, force: true })
    this.owners.delete(sessionKey)
  }

  clear(): void {
    for (const [sessionPath, record] of this.owners) this.release(sessionPath, record.conversationId)
  }

  private acquireRuntimeLock(sessionPath: string, conversationId: string): string {
    const runtimeDir = this.options.runtimeDir!
    mkdirSync(runtimeDir, { recursive: true })
    const digest = createHash('sha256').update(sessionPath).digest('hex')
    const lockDirectory = join(runtimeDir, `${digest}.lock`)

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        mkdirSync(lockDirectory)
        const metadata: RuntimeLockMetadata = {
          schemaVersion: 1,
          sessionPath,
          conversationId,
          ownerInstanceId: this.instanceId,
          owner: this.ownerIdentity,
          createdAt: Date.now(),
        }
        try {
          this.writeMetadata(lockDirectory, metadata)
        } catch (error) {
          // mkdir 与 owner.json 写入共同构成一次 claim。元数据提交失败时只回滚
          // 本次刚创建的目录，避免留下无法自动判断所有者的永久损坏锁。
          try {
            rmSync(lockDirectory, { recursive: true, force: true })
          } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Session runtime lock initialization failed')
          }
          throw error
        }
        return lockDirectory
      } catch (error) {
        if (!isNodeErrorWithCode(error, 'EEXIST')) throw error
        const existing = this.readMetadata(lockDirectory)
        const ownerState = inspectExpectedProcess(existing.owner, this.readIdentity)
        if (!existing.writer && ownerState !== 'same') {
          throw new Error(`Cannot verify whether a session writer spawned before owner exit: ${sessionPath}`)
        }
        const writerState = existing.writer
          ? inspectExpectedProcess(existing.writer, this.readIdentity)
          : 'absent'
        if (ownerState === 'same' || writerState === 'same') {
          throw new Error(`Session runtime lock is held by another live process: ${sessionPath}`)
        }
        if (ownerState === 'unknown' || writerState === 'unknown') {
          throw new Error(`Cannot verify existing session runtime lock owner: ${sessionPath}`)
        }
        // 只有元数据完整且 owner/writer 身份均确认不存在时才删除。损坏或无法读取的锁
        // 会在 readMetadata 中直接报错，避免因系统睡眠、PID 复用或瞬时 IO 错误误抢所有权。
        rmSync(lockDirectory, { recursive: true, force: true })
      }
    }
    throw new Error(`Failed to acquire session runtime lock: ${sessionPath}`)
  }

  private readMetadata(lockDirectory: string): RuntimeLockMetadata {
    const parsed = JSON.parse(readFileSync(join(lockDirectory, 'owner.json'), 'utf8')) as Partial<RuntimeLockMetadata>
    if (
      parsed.schemaVersion !== 1
      || typeof parsed.sessionPath !== 'string'
      || typeof parsed.conversationId !== 'string'
      || typeof parsed.ownerInstanceId !== 'string'
      || !isProcessIdentity(parsed.owner)
      || typeof parsed.createdAt !== 'number'
      || (parsed.writer !== undefined && !isProcessIdentity(parsed.writer))
    ) {
      throw new Error(`Invalid session runtime lock metadata: ${lockDirectory}`)
    }
    return parsed as RuntimeLockMetadata
  }

  private writeMetadata(lockDirectory: string, metadata: RuntimeLockMetadata): void {
    const temporaryPath = join(lockDirectory, `owner.${process.pid}.${randomUUID()}.tmp`)
    writeFileSync(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, join(lockDirectory, 'owner.json'))
  }
}

export function canonicalizeSessionPath(sessionPath: string): string {
  const absolutePath = resolve(sessionPath)
  try {
    return realpathSync.native(absolutePath)
  } catch (error) {
    if (!isNodeErrorWithCode(error, 'ENOENT')) throw error
    try {
      return join(realpathSync.native(dirname(absolutePath)), basename(absolutePath))
    } catch (parentError) {
      if (!isNodeErrorWithCode(parentError, 'ENOENT')) throw parentError
      return absolutePath
    }
  }
}

function isProcessIdentity(value: unknown): value is ProcessIdentity {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as ProcessIdentity).pid === 'number'
    && typeof (value as ProcessIdentity).startedAt === 'string'
    && typeof (value as ProcessIdentity).command === 'string',
  )
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}

function inspectExpectedProcess(
  expected: ProcessIdentity,
  readIdentity: ProcessIdentityReader,
): 'same' | 'absent' | 'unknown' {
  const current = readIdentity(expected.pid)
  if (current) {
    if (current.state?.startsWith('Z')) return 'absent'
    // owner 身份初次读取失败时会写入 unverified nonce。只要相同 PID 仍可见，
    // 就无法证明它不是原 owner，不能按普通 identity mismatch 当作 PID 复用。
    if (expected.startedAt.startsWith('unverified:')) return 'unknown'
    return current.startedAt === expected.startedAt && current.command === expected.command
      ? 'same'
      : 'absent'
  }
  try {
    process.kill(expected.pid, 0)
    return 'unknown'
  } catch (error) {
    return isNodeErrorWithCode(error, 'ESRCH') ? 'absent' : 'unknown'
  }
}
