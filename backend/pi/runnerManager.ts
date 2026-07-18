import { PiProcessRunner } from './processRunner.js'
import { resolve } from 'node:path'
import type { ImageContent } from '../../shared/chat.js'
import type { BackendMessage, PiRunnerPhase, PiRunnerSnapshot, PromptStreamingBehavior } from '../../shared/protocol.js'
import { normalizeWorkspacePath } from '../../shared/workspacePaths.js'
import { canonicalizeSessionPath, SessionLeaseRegistry } from './sessionLeaseRegistry.js'
import type { PiRpcEvent } from './rpcEvents.js'
import {
  JsonlProcessLifecycleLog,
  noopProcessLifecycleLog,
  type ProcessLifecycleLog,
} from './lifecycleLog.js'

type Broadcast = (payload: BackendMessage) => void
type ManagedRunner = Pick<
  PiProcessRunner,
  | 'isRunning'
  | 'hasProcessHandle'
  | 'start'
  | 'writePrompt'
  | 'abort'
  | 'terminate'
  | 'getState'
  | 'getDiagnostics'
>
type RunnerLifecycle = {
  onSpawn(pid: number): void
  onExit(): void
  onTerminationFailed(error: Error): void
}
type RunnerFactory = (broadcast: (payload: PiRpcEvent) => void, lifecycle: RunnerLifecycle) => ManagedRunner
export type PiProcessState = {
  sessionPath?: string
  sessionName?: string
}
export type PiProcessManagementApi = {
  list(): PiRunnerSnapshot[]
  snapshot(conversationId: string): PiRunnerSnapshot | undefined
  start(conversationId: string, input: { cwd: string; extraArgs?: string; sessionPath: string }): Promise<void>
  prompt(
    conversationId: string,
    id: string,
    prompt: string,
    streamingBehavior?: PromptStreamingBehavior,
    images?: ImageContent[],
  ): Promise<void>
  abort(conversationId: string, id: string): Promise<void>
  setActiveConversation(clientId: string, conversationId: string | null): void
  getState(conversationId: string): Promise<PiProcessState>
  shutdownConversation(conversationId: string): Promise<void>
  shutdownWorkspace(workspacePath: string): Promise<number>
  shutdownAll(): Promise<void>
}
export type { PiRunnerPhase, PiRunnerSnapshot }
type RunnerRecord = {
  runner: ManagedRunner
  conversationId: string
  phase: PiRunnerPhase
  sessionPath?: string
  cwd?: string
  createdAt: number
  startedAt?: number
  lastActiveAt: number
  idleSince?: number
  error?: string
  startPromise?: Promise<void>
  startInputKey?: string
  pendingRpcCommand?: { type: 'prompt' | 'abort'; id: string; lifecycleSettled?: boolean }
  terminationPromise?: Promise<void>
}

const BACKGROUND_IDLE_TIMEOUT_MS = 10 * 60 * 1000
const ACTIVE_IDLE_TIMEOUT_MS = 30 * 60 * 1000
const MAX_RETAINED_IDLE_RUNNERS = 3
const MAX_ACTIVE_RUNNERS = 4

export class PiRunnerManager {
  private runners = new Map<string, RunnerRecord>()
  private sessionRecords = new Map<string, RunnerRecord>()
  private activeConversationsByClient = new Map<string, string>()
  private retentionTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly broadcast: Broadcast,
    private readonly createRunner: RunnerFactory = (runnerBroadcast, lifecycle) => new PiProcessRunner(runnerBroadcast, lifecycle),
    private readonly sessionLeases: SessionLeaseRegistry = new SessionLeaseRegistry(),
    private readonly lifecycleLog: ProcessLifecycleLog = noopProcessLifecycleLog,
  ) {}

  start(conversationId: string, input: { cwd: string; extraArgs?: string; sessionPath: string }): Promise<void> {
    const sessionKey = normalizeSessionPath(input.sessionPath)
    const startInputKey = buildStartInputKey(input)
    const liveSessionRecord = this.sessionRecords.get(sessionKey)
    if (liveSessionRecord && liveSessionRecord.conversationId !== conversationId) {
      if (
        liveSessionRecord.phase === 'terminating'
        || liveSessionRecord.phase === 'termination_failed'
        || (liveSessionRecord.phase !== 'starting' && !liveSessionRecord.runner.isRunning())
      ) {
        return Promise.reject(new Error('Session process ownership is not safely released'))
      }
      const targetRecord = this.runners.get(conversationId)
      if (targetRecord && targetRecord !== liveSessionRecord) {
        if (targetRecord.phase !== 'exited') {
          return Promise.reject(new Error('Conversation already owns another runner'))
        }
        // 自动回收会保留 exited snapshot；它已不拥有进程，可由迁回持久 id 的 live record 安全替换。
        this.releaseConversationLease(conversationId)
        this.runners.delete(conversationId)
      }
      return this.attachConversationToLiveSession(conversationId, liveSessionRecord, input)
    }

    const existingRecord = this.runners.get(conversationId)
    const activeRunnerCount = [...this.runners.values()].filter((candidate) => (
      candidate !== existingRecord && reservesActiveCapacity(candidate)
    )).length
    if ((!existingRecord || !reservesActiveCapacity(existingRecord)) && activeRunnerCount >= MAX_ACTIVE_RUNNERS) {
      return Promise.reject(new Error(`Active Pi runner limit reached (${MAX_ACTIVE_RUNNERS})`))
    }

    const record = this.recordFor(conversationId)
    if (record.startPromise) {
      if (record.startInputKey === startInputKey) return record.startPromise
      return Promise.reject(new Error('Conversation is already starting with different session input'))
    }

    if (record.phase === 'termination_failed' || record.phase === 'terminating') {
      return Promise.reject(new Error('Conversation process termination is not complete'))
    }
    if (record.phase !== 'new' && record.runner.isRunning()) {
      if (
        record.sessionPath
        && normalizeSessionPath(record.sessionPath) === sessionKey
        && record.startInputKey === undefined
      ) return Promise.resolve()
      return Promise.reject(new Error('Conversation already owns a live runner'))
    }
    if (
      record.phase !== 'new'
      && record.phase !== 'exited'
      && (record.phase !== 'error' || record.runner.hasProcessHandle())
    ) {
      return Promise.reject(new Error('Conversation process has not reached a terminal state'))
    }
    this.releaseConversationLease(conversationId)
    // 对外 snapshot 保留稳定的绝对路径；canonical key 只用于所有权判重，避免 macOS
    // 将 /tmp 显示成 /private/tmp 后破坏既有 SQLite/Renderer 身份。
    record.sessionPath = resolve(input.sessionPath)
    record.cwd = normalizeWorkspacePath(input.cwd)
    record.phase = 'starting'
    record.startedAt = Date.now()
    record.lastActiveAt = record.startedAt
    record.idleSince = undefined
    record.error = undefined
    record.startInputKey = startInputKey
    try {
      this.sessionLeases.claim(sessionKey, conversationId)
    } catch (error) {
      record.phase = 'error'
      record.error = error instanceof Error ? error.message : String(error)
      record.startInputKey = undefined
      this.broadcastSnapshot(record)
      return Promise.reject(error)
    }
    this.sessionRecords.set(sessionKey, record)
    this.broadcastSnapshot(record)
    const idle = this.idleRecords(conversationId)
    let runnerStart: Promise<void>
    try {
      runnerStart = idle.length >= MAX_RETAINED_IDLE_RUNNERS
        ? this.closeIdleRunner(idle[0]).then(() => record.runner.start(input))
        : record.runner.start(input)
    } catch (error) {
      runnerStart = Promise.reject(error)
    }
    record.startPromise = runnerStart.then(() => {
      if (this.ownsRecord(record) && record.phase === 'starting') {
        record.phase = 'idle'
        record.idleSince = Date.now()
        void this.enforceIdleCapacity()
        this.scheduleRetentionCheck()
        this.broadcastSnapshot(record)
      }
    }).catch((error) => {
      if (!this.ownsRecord(record)) throw error
      if (record.runner.hasProcessHandle()) {
        record.phase = 'termination_failed'
        record.error = error instanceof Error ? error.message : String(error)
        record.idleSince = undefined
        this.scheduleRetentionCheck()
        this.broadcastSnapshot(record)
        throw error
      }
      record.phase = 'error'
      record.error = error instanceof Error ? error.message : String(error)
      record.idleSince = undefined
      try {
        this.releaseConversationLease(record.conversationId)
      } catch (releaseError) {
        record.phase = 'termination_failed'
        record.error = releaseError instanceof Error ? releaseError.message : String(releaseError)
        this.broadcastSnapshot(record)
        throw new AggregateError([error, releaseError], 'Pi start failed and session lock cleanup was incomplete')
      }
      this.scheduleRetentionCheck()
      this.broadcastSnapshot(record)
      throw error
    }).finally(() => {
      record.startPromise = undefined
      record.startInputKey = undefined
    })
    return record.startPromise
  }

  async prompt(
    conversationId: string,
    id: string,
    prompt: string,
    streamingBehavior?: PromptStreamingBehavior,
    images?: ImageContent[],
  ): Promise<void> {
    const record = this.recordFor(conversationId)
    if (record.phase === 'terminating' || record.phase === 'termination_failed') {
      throw new Error('Pi process termination is not complete')
    }
    if (!record.runner.isRunning()) {
      record.phase = 'error'
      record.error = 'Pi process not started'
      throw new Error(record.error)
    }
    if (record.pendingRpcCommand) {
      throw new Error(`Pi RPC command is already pending: ${record.pendingRpcCommand.type}`)
    }
    const pendingCommand = { type: 'prompt' as const, id, lifecycleSettled: false }
    record.pendingRpcCommand = pendingCommand
    const promptStreamingBehavior = streamingBehavior ?? (record.phase === 'running' ? 'steer' : undefined)
    const previousPhase = record.phase
    record.lastActiveAt = Date.now()
    record.idleSince = undefined
    record.error = undefined
    try {
      const response = images?.length
        ? await record.runner.writePrompt(id, prompt, promptStreamingBehavior, images)
        : await record.runner.writePrompt(id, prompt, promptStreamingBehavior)
      if (!response.success) throw new Error(response.error ?? 'Pi rejected prompt')
    } catch (error) {
      if (
        this.ownsRecord(record)
        && record.runner.isRunning()
        && !isTerminationPhase(record.phase)
        && !pendingCommand.lifecycleSettled
      ) {
        record.phase = previousPhase
        record.idleSince = previousPhase === 'idle' ? Date.now() : undefined
        record.error = error instanceof Error ? error.message : String(error)
        this.broadcastSnapshot(record)
        this.scheduleRetentionCheck()
      }
      throw error
    } finally {
      if (record.pendingRpcCommand?.type === 'prompt' && record.pendingRpcCommand.id === id) {
        record.pendingRpcCommand = undefined
      }
    }
    if (!this.ownsRecord(record) || !record.runner.isRunning()) {
      throw new Error('Pi runner exited while prompt was pending')
    }
    // agent_end/pi:error 比 RPC response 更权威；乱序到达时不能用 ACK 把终态覆盖回 running。
    if (pendingCommand.lifecycleSettled) return
    record.phase = 'running'
    record.error = undefined
    this.broadcastSnapshot(record)
    this.scheduleRetentionCheck()
  }

  async abort(conversationId: string, id: string): Promise<void> {
    const record = this.runners.get(conversationId)
    if (!record || record.phase !== 'running' || !record.runner.isRunning()) {
      throw new Error('Pi runner is not running')
    }
    if (record.pendingRpcCommand) {
      throw new Error(`Pi RPC command is already pending: ${record.pendingRpcCommand.type}`)
    }
    const pendingCommand = { type: 'abort' as const, id, lifecycleSettled: false }
    record.pendingRpcCommand = pendingCommand
    // stdin write 只表示命令进入管道；必须等 Pi response success 才能提交 stopping。
    let response
    try {
      response = await record.runner.abort(id)
    } finally {
      if (record.pendingRpcCommand?.type === 'abort' && record.pendingRpcCommand.id === id) {
        record.pendingRpcCommand = undefined
      }
    }
    if (!response.success) throw new Error(response.error ?? 'Pi rejected abort')
    if (!this.ownsRecord(record) || !record.runner.isRunning()) {
      throw new Error('Pi runner exited while abort was pending')
    }
    if (pendingCommand.lifecycleSettled) return
    record.phase = 'stopping'
    record.lastActiveAt = Date.now()
    record.idleSince = undefined
    this.broadcastSnapshot(record)
    this.scheduleRetentionCheck()
  }

  setActiveConversation(clientId: string, conversationId: string | null): void {
    const previousConversationId = this.activeConversationsByClient.get(clientId) ?? null
    if (previousConversationId === conversationId) return
    const affectedConversationIds = new Set(
      [previousConversationId, conversationId].filter((id): id is string => Boolean(id)),
    )
    const wasActive = new Map(
      [...affectedConversationIds].map((id) => [id, this.isConversationActive(id)]),
    )

    if (conversationId) this.activeConversationsByClient.set(clientId, conversationId)
    else this.activeConversationsByClient.delete(clientId)

    const now = Date.now()
    for (const id of affectedConversationIds) {
      if (wasActive.get(id) === this.isConversationActive(id)) continue
      const record = this.runners.get(id)
      // 只有聚合后的前后台身份真正变化时才开启新窗口，单个客户端断线不能缩短其他窗口的保留期。
      if (record?.phase === 'idle') record.idleSince = now
    }
    this.scheduleRetentionCheck()
  }

  getState(conversationId: string): Promise<PiProcessState> {
    return this.recordFor(conversationId).runner.getState()
  }

  snapshot(conversationId: string): PiRunnerSnapshot | undefined {
    const record = this.runners.get(conversationId)
    return record ? this.toSnapshot(record) : undefined
  }

  list(): PiRunnerSnapshot[] {
    return [...this.runners.values()].map((record) => this.toSnapshot(record))
  }

  async shutdownConversation(conversationId: string): Promise<void> {
    const record = this.runners.get(conversationId)
    if (!record) return
    await this.ensureTerminated(record)
    if (!this.ownsRecord(record)) return
    this.runners.delete(conversationId)
    for (const [clientId, activeId] of this.activeConversationsByClient) {
      if (activeId === conversationId) this.activeConversationsByClient.delete(clientId)
    }
    this.scheduleRetentionCheck()
  }

  async shutdownWorkspace(workspacePath: string): Promise<number> {
    const workspaceKey = normalizeWorkspacePath(workspacePath)
    const conversationIds = [...this.runners.values()]
      .filter((record) => record.cwd && normalizeWorkspacePath(record.cwd) === workspaceKey)
      .map((record) => record.conversationId)

    for (const conversationId of conversationIds) {
      await this.shutdownConversation(conversationId)
    }

    return conversationIds.length
  }

  async shutdownAll(): Promise<void> {
    const conversationIds = [...this.runners.keys()]
    const results = await Promise.allSettled(
      conversationIds.map((conversationId) => this.shutdownConversation(conversationId)),
    )
    this.activeConversationsByClient.clear()
    this.clearRetentionTimer()
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failures.length > 0) {
      throw new AggregateError(failures.map((failure) => failure.reason), 'Failed to terminate all Pi processes')
    }
  }

  private recordFor(conversationId: string): RunnerRecord {
    const existing = this.runners.get(conversationId)
    if (existing) return existing

    let record: RunnerRecord
    const runner = this.createRunner(
      (payload) => {
        // runner 进程归属于 sessionPath；当历史刷新把 UI 会话 id 迁移时，
        // 后续事件必须投递到当前附着的 conversationId，避免旧 id 吃掉流式输出。
        this.applyRunnerEvent(record.conversationId, payload)
        this.broadcast(attachConversationId(record.conversationId, payload))
      },
      {
        onSpawn: (pid) => {
          if (!record.sessionPath) throw new Error('Runner spawned without a session lease')
          this.sessionLeases.setWriter(record.sessionPath, record.conversationId, pid)
          this.lifecycleLog.record({
            event: 'runner_spawned',
            conversationId: record.conversationId,
            sessionPath: record.sessionPath,
            pid,
          })
        },
        onExit: () => this.handleRunnerExit(record),
        onTerminationFailed: (error) => this.handleRunnerTerminationFailure(record, error),
      },
    )
    const now = Date.now()
    record = {
      runner,
      conversationId,
      phase: 'new',
      createdAt: now,
      lastActiveAt: now,
    }
    this.runners.set(conversationId, record)
    return record
  }

  private handleRunnerExit(record: RunnerRecord): void {
    // SIGTERM 的 exit 事件可能晚于同 conversationId 的新 runner 创建；旧 record 不再拥有该 id 时必须忽略。
    if (this.runners.get(record.conversationId) !== record) return
    if (record.pendingRpcCommand) record.pendingRpcCommand.lifecycleSettled = true
    record.lastActiveAt = Date.now()
    record.idleSince = undefined
    record.error = undefined
    try {
      this.releaseConversationLease(record.conversationId)
      record.phase = 'exited'
      this.lifecycleLog.record({
        event: 'runner_exited',
        conversationId: record.conversationId,
        sessionPath: record.sessionPath,
        phase: record.phase,
      })
    } catch (error) {
      record.phase = 'termination_failed'
      record.error = error instanceof Error ? error.message : String(error)
    }
    this.broadcastSnapshot(record)
    this.scheduleRetentionCheck()
  }

  private handleRunnerTerminationFailure(record: RunnerRecord, error: Error): void {
    if (!this.ownsRecord(record)) return
    if (record.pendingRpcCommand) record.pendingRpcCommand.lifecycleSettled = true
    record.phase = 'termination_failed'
    record.error = error.message
    record.idleSince = undefined
    this.lifecycleLog.record({
      event: 'runner_termination_failed',
      conversationId: record.conversationId,
      sessionPath: record.sessionPath,
      phase: record.phase,
      errorName: error.name,
    })
    this.broadcastSnapshot(record)
    this.scheduleRetentionCheck()
  }

  private releaseConversationLease(conversationId: string): void {
    const record = this.runners.get(conversationId)
    const sessionPath = record?.sessionPath
    if (!sessionPath) return
    this.sessionLeases.release(sessionPath, record.conversationId)
    const sessionKey = normalizeSessionPath(sessionPath)
    if (this.sessionRecords.get(sessionKey) === record) {
      this.sessionRecords.delete(sessionKey)
    }
  }

  private attachConversationToLiveSession(
    conversationId: string,
    record: RunnerRecord,
    input: { cwd: string; extraArgs?: string; sessionPath: string },
  ): Promise<void> {
    const sessionKey = normalizeSessionPath(input.sessionPath)
    const cwd = normalizeWorkspacePath(input.cwd)
    if (record.cwd && record.cwd !== cwd) {
      return Promise.reject(new Error('Session is already running with different workspace input'))
    }

    const previousConversationId = record.conversationId
    this.sessionLeases.transfer(sessionKey, previousConversationId, conversationId)
    this.runners.delete(previousConversationId)
    // 历史投影会把临时 conversationId 收敛为持久 id；runner 与前台身份必须一起迁移，
    // 否则用户仍在查看的 idle 会话会被误判为后台并提前回收。
    for (const [clientId, activeId] of this.activeConversationsByClient) {
      if (activeId === previousConversationId) this.activeConversationsByClient.set(clientId, conversationId)
    }
    record.conversationId = conversationId
    record.cwd = cwd
    record.lastActiveAt = Date.now()
    if (record.phase === 'idle') record.idleSince = record.lastActiveAt
    record.error = undefined
    this.runners.set(conversationId, record)
    this.sessionRecords.set(sessionKey, record)
    this.broadcastSnapshot(record)
    this.scheduleRetentionCheck()
    return record.startPromise ?? Promise.resolve()
  }

  private applyRunnerEvent(conversationId: string, payload: PiRpcEvent): void {
    const record = this.runners.get(conversationId)
    if (!record || record.phase === 'exited') return
    const previousPhase = record.phase
    const previousError = record.error
    record.lastActiveAt = Date.now()
    switch (payload.type) {
      case 'pi:agent_start':
      case 'pi:tool_start':
        // Pi 正常应先回 response 再发 lifecycle event；即使乱序，也不能在 ACK 前
        // 提交 running。事件本身仍会继续广播给目标 conversation。
        if (record.pendingRpcCommand?.type === 'prompt') return
        record.phase = 'running'
        record.idleSince = undefined
        record.error = undefined
        this.scheduleRetentionCheck()
        this.broadcastSnapshotIfChanged(record, previousPhase, previousError)
        return
      case 'pi:tool_end':
      case 'pi:turn_end':
        record.error = undefined
        this.broadcastSnapshotIfChanged(record, previousPhase, previousError)
        return
      case 'pi:agent_end':
        if (record.pendingRpcCommand) record.pendingRpcCommand.lifecycleSettled = true
        if (typeof payload.error === 'string' && payload.error) {
          record.phase = payload.willRetry ? 'running' : 'error'
          record.error = payload.error
        } else if (payload.willRetry) {
          record.phase = 'running'
          record.error = undefined
        } else {
          record.phase = 'idle'
          record.idleSince = Date.now()
          record.error = undefined
        }
        if (record.phase === 'idle') void this.enforceIdleCapacity()
        this.scheduleRetentionCheck()
        this.broadcastSnapshotIfChanged(record, previousPhase, previousError)
        return
      case 'pi:error':
        if (record.pendingRpcCommand) record.pendingRpcCommand.lifecycleSettled = true
        record.phase = 'error'
        record.idleSince = undefined
        record.error = typeof payload.message === 'string' ? payload.message : 'Pi process error'
        this.scheduleRetentionCheck()
        this.broadcastSnapshotIfChanged(record, previousPhase, previousError)
        return
    }
  }

  private broadcastSnapshotIfChanged(record: RunnerRecord, previousPhase: PiRunnerPhase, previousError?: string): void {
    if (record.phase === previousPhase && record.error === previousError) return
    this.broadcastSnapshot(record)
  }

  private broadcastSnapshot(record: RunnerRecord): void {
    this.lifecycleLog.record({
      event: 'runner_snapshot',
      conversationId: record.conversationId,
      sessionPath: record.sessionPath,
      phase: record.phase,
    })
    this.broadcast({ type: 'runner:snapshot', snapshot: this.toSnapshot(record) })
  }

  private async enforceIdleCapacity(): Promise<void> {
    const idle = this.idleRecords()
    while (idle.length > MAX_RETAINED_IDLE_RUNNERS) {
      try {
        await this.closeIdleRunner(idle.shift()!)
      } catch {
        // termination_failed 已由 ensureTerminated 提交；继续循环只会重复同一失败。
        break
      }
    }
  }

  private idleRecords(excludedConversationId?: string): RunnerRecord[] {
    return [...this.runners.values()]
      .filter((record) => record.phase === 'idle' && record.conversationId !== excludedConversationId)
      .sort((left, right) => (left.idleSince ?? left.lastActiveAt) - (right.idleSince ?? right.lastActiveAt))
  }

  private async closeIdleRunner(record: RunnerRecord): Promise<void> {
    if (record.phase !== 'idle') return
    await this.ensureTerminated(record)
  }

  private ensureTerminated(record: RunnerRecord): Promise<void> {
    if (record.phase === 'exited' && !record.runner.hasProcessHandle()) return Promise.resolve()
    if (record.terminationPromise) return record.terminationPromise

    record.phase = 'terminating'
    record.error = undefined
    record.idleSince = undefined
    this.broadcastSnapshot(record)
    const termination = (async () => {
      try {
        const result = await record.runner.terminate()
        this.lifecycleLog.record({
          event: 'runner_terminated',
          conversationId: record.conversationId,
          sessionPath: record.sessionPath,
          outcome: result.outcome,
          pid: result.pid,
        })
        if (!this.ownsRecord(record)) return
        this.releaseConversationLease(record.conversationId)
        record.phase = 'exited'
        this.broadcastSnapshot(record)
      } catch (error) {
        if (this.ownsRecord(record)) {
          record.phase = 'termination_failed'
          record.error = error instanceof Error ? error.message : String(error)
          this.broadcastSnapshot(record)
        }
        throw error
      } finally {
        record.terminationPromise = undefined
      }
    })()
    record.terminationPromise = termination
    return termination
  }

  private scheduleRetentionCheck(): void {
    this.clearRetentionTimer()
    const now = Date.now()
    const deadlines = this.idleRecords().map((record) =>
      (record.idleSince ?? now) + (
        this.isConversationActive(record.conversationId)
          ? ACTIVE_IDLE_TIMEOUT_MS
          : BACKGROUND_IDLE_TIMEOUT_MS
      ),
    )
    if (deadlines.length === 0) return

    this.retentionTimer = setTimeout(
      () => this.runRetentionCheck(),
      Math.max(0, Math.min(...deadlines) - now),
    )
    ;(this.retentionTimer as NodeJS.Timeout).unref?.()
  }

  private async runRetentionCheck(): Promise<void> {
    this.retentionTimer = null
    const now = Date.now()
    for (const record of this.idleRecords()) {
      const timeout = this.isConversationActive(record.conversationId)
        ? ACTIVE_IDLE_TIMEOUT_MS
        : BACKGROUND_IDLE_TIMEOUT_MS
      if (now - (record.idleSince ?? now) >= timeout) {
        try {
          await this.closeIdleRunner(record)
        } catch {
          // 单个 runner 清理失败不能阻止其他 idle runner 到期检查。
        }
      }
    }
    this.scheduleRetentionCheck()
  }

  private clearRetentionTimer(): void {
    if (this.retentionTimer == null) return
    clearTimeout(this.retentionTimer)
    this.retentionTimer = null
  }

  private isConversationActive(conversationId: string): boolean {
    for (const activeId of this.activeConversationsByClient.values()) {
      if (activeId === conversationId) return true
    }
    return false
  }

  private ownsRecord(record: RunnerRecord): boolean {
    return this.runners.get(record.conversationId) === record
  }

  private toSnapshot(record: RunnerRecord): PiRunnerSnapshot {
    return {
      conversationId: record.conversationId,
      phase: record.phase,
      ...(record.sessionPath ? { sessionPath: record.sessionPath } : {}),
      ...(record.cwd ? { cwd: record.cwd } : {}),
      createdAt: record.createdAt,
      ...(record.startedAt ? { startedAt: record.startedAt } : {}),
      lastActiveAt: record.lastActiveAt,
      ...(record.error ? { error: record.error } : {}),
      ...(record.runner.getDiagnostics() ? { diagnostics: record.runner.getDiagnostics() } : {}),
    }
  }
}

export function createPiProcessManager(
  broadcast: Broadcast,
  options: { runtimeLockDir?: string; lifecycleLogPath?: string; instanceId?: string } = {},
): PiProcessManagementApi {
  return new PiRunnerManager(
    broadcast,
    undefined,
    new SessionLeaseRegistry({
      runtimeDir: options.runtimeLockDir,
      instanceId: options.instanceId,
    }),
    options.lifecycleLogPath && options.instanceId
      ? new JsonlProcessLifecycleLog(options.lifecycleLogPath, options.instanceId)
      : noopProcessLifecycleLog,
  )
}

function attachConversationId(conversationId: string, payload: PiRpcEvent): BackendMessage {
  switch (payload.type) {
    case 'pi:text_delta':
    case 'pi:thinking_delta':
    case 'pi:thinking_end':
    case 'pi:tool_start':
    case 'pi:tool_update':
    case 'pi:tool_end':
    case 'pi:message_end':
    case 'pi:agent_start':
    case 'pi:agent_end':
    case 'pi:response':
    case 'pi:status':
    case 'pi:stderr':
    case 'pi:error':
    case 'pi:turn_end':
      return { ...payload, conversationId }
  }
}

function normalizeSessionPath(sessionPath: string): string {
  return canonicalizeSessionPath(sessionPath)
}

function reservesActiveCapacity(record: RunnerRecord): boolean {
  if (record.phase === 'idle' || record.phase === 'exited' || record.phase === 'new') return false
  return record.phase === 'starting' || record.runner.isRunning() || record.runner.hasProcessHandle()
}

function isTerminationPhase(phase: PiRunnerPhase): boolean {
  return phase === 'terminating' || phase === 'termination_failed' || phase === 'exited'
}

function buildStartInputKey(input: { cwd: string; extraArgs?: string; sessionPath: string }): string {
  return JSON.stringify({
    cwd: normalizeWorkspacePath(input.cwd),
    sessionPath: normalizeSessionPath(input.sessionPath),
    extraArgs: input.extraArgs ?? '',
  })
}
