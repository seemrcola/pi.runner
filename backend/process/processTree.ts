import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ChildProcess } from 'node:child_process'
import { isSameLiveProcess, readProcessIdentity, type ProcessIdentity } from './processIdentity.js'

type ProcessNode = {
  pid: number
  ppid: number
  identity?: ProcessIdentity
}

const execFileAsync = promisify(execFile)

export type ProcessTerminationResult = {
  outcome: 'already-exited' | 'graceful' | 'forced'
  pid?: number
  forcedPids: number[]
}

export type ProcessTreePlatform = {
  listProcesses(): Promise<ProcessNode[]>
  signal(pid: number, signal: NodeJS.Signals): void
  readIdentity?(pid: number): ProcessIdentity | null
  isSameProcess?(identity: ProcessIdentity): boolean
}

const defaultPlatform: ProcessTreePlatform = {
  async listProcesses() {
    const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,state=,command='], {
      maxBuffer: 4 * 1024 * 1024,
      timeout: 3_000,
    })
    return stdout
      .split('\n')
      .map((line) => line.trim().match(
        /^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.+)$/,
      ))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => ({
        pid: Number(match[1]),
        ppid: Number(match[2]),
        identity: {
          pid: Number(match[1]),
          startedAt: match[3],
          state: match[4],
          command: match[5],
        },
      }))
  },
  signal(pid, signal) {
    process.kill(pid, signal)
  },
  readIdentity(pid) {
    return readProcessIdentity(pid)
  },
  isSameProcess(identity) {
    return isSameLiveProcess(identity)
  },
}

export async function terminateChildProcess(
  child: ChildProcess,
  options: {
    graceMs?: number
    forceWaitMs?: number
    terminateDescendantsFirst?: boolean
    platform?: ProcessTreePlatform
  } = {},
): Promise<ProcessTerminationResult> {
  const pid = child.pid
  const graceMs = options.graceMs ?? 5_000
  const forceWaitMs = options.forceWaitMs ?? 2_000
  const platform = options.platform ?? defaultPlatform
  const close = waitForClose(child)
  // TERM 之前先固定 root 身份和已存在后代。若 root 在宽限期内退出并且 PID
  // 被复用，后续绝不能沿着复用后的 PID 枚举或强杀无关进程。
  const rootIdentity = pid ? platform.readIdentity?.(pid) ?? undefined : undefined
  const descendantsBeforeTerm = pid ? await listDescendantNodesLeafFirst(pid, platform) : []

  if (hasExited(child)) {
    if (await settlesWithin(close, forceWaitMs)) {
      return { outcome: 'already-exited', ...(pid ? { pid } : {}), forcedPids: [] }
    }
    throw new Error(`Process ${pid ?? 'unknown'} exited but stdio did not close`)
  }

  if (options.terminateDescendantsFirst) {
    for (const descendant of descendantsBeforeTerm) {
      if (!descendant.identity || !platform.isSameProcess?.(descendant.identity)) continue
      try {
        platform.signal(descendant.pid, 'SIGTERM')
      } catch (error) {
        if (!isNoSuchProcess(error)) throw error
      }
    }
  }
  try {
    child.kill('SIGTERM')
  } catch (error) {
    if (!isNoSuchProcess(error)) throw error
  }

  if (await settlesWithin(close, graceMs)) {
    return { outcome: 'graceful', ...(pid ? { pid } : {}), forcedPids: [] }
  }

  // Pi 的正常 TERM handler 会清理它自己创建的 detached tool group。只有宽限期耗尽后
  // 才枚举后代并从叶到根强杀，避免先杀父进程后 PPID 关系丢失而留下孤儿工具进程。
  const rootIsStillSame = Boolean(rootIdentity && platform.isSameProcess?.(rootIdentity))
  const descendantsAfterTerm = pid && rootIsStillSame
    ? await listDescendantNodesLeafFirst(pid, platform)
    : []
  const descendants = mergeProcessNodes(descendantsBeforeTerm, descendantsAfterTerm)
  if (pid && !rootIdentity) {
    throw new Error(`Cannot verify process ${pid} identity before SIGKILL`)
  }
  if (!platform.isSameProcess || descendants.some((descendant) => !descendant.identity)) {
    throw new Error('Cannot verify descendant process identities before SIGKILL')
  }
  const targets: ProcessNode[] = [
    ...descendants,
    ...(pid && rootIdentity ? [{ pid, ppid: 0, identity: rootIdentity }] : []),
  ]
  const forcedPids: number[] = []
  for (const target of targets) {
    if (!target.identity || !platform.isSameProcess(target.identity)) continue
    try {
      platform.signal(target.pid, 'SIGKILL')
      forcedPids.push(target.pid)
    } catch (error) {
      if (!isNoSuchProcess(error)) throw error
    }
  }

  if (!await settlesWithin(close, forceWaitMs) && !hasExited(child)) {
    throw new Error(`Process ${pid ?? 'unknown'} did not close after SIGKILL`)
  }

  let survivingDescendants = liveDescendants(descendants, platform)
  const descendantDeadline = Date.now() + forceWaitMs
  while (survivingDescendants.length > 0 && Date.now() < descendantDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
    survivingDescendants = liveDescendants(descendants, platform)
  }
  if (survivingDescendants.length > 0) {
    throw new Error(`Descendant processes survived SIGKILL: ${survivingDescendants.map(({ pid }) => pid).join(', ')}`)
  }

  return { outcome: 'forced', ...(pid ? { pid } : {}), forcedPids }
}

function liveDescendants(descendants: ProcessNode[], platform: ProcessTreePlatform): ProcessNode[] {
  if (!platform.isSameProcess) return []
  return descendants.filter((descendant) => (
    descendant.identity && platform.isSameProcess?.(descendant.identity)
  ))
}

function mergeProcessNodes(first: ProcessNode[], second: ProcessNode[]): ProcessNode[] {
  const nodes = new Map<number, ProcessNode>()
  for (const node of [...first, ...second]) nodes.set(node.pid, node)
  return [...nodes.values()]
}

export async function listDescendantsLeafFirst(
  rootPid: number,
  platform: ProcessTreePlatform = defaultPlatform,
): Promise<number[]> {
  return (await listDescendantNodesLeafFirst(rootPid, platform)).map(({ pid }) => pid)
}

async function listDescendantNodesLeafFirst(
  rootPid: number,
  platform: ProcessTreePlatform,
): Promise<ProcessNode[]> {
  const processes = await platform.listProcesses()
  const children = new Map<number, ProcessNode[]>()
  for (const process of processes) {
    const siblings = children.get(process.ppid) ?? []
    siblings.push(process)
    children.set(process.ppid, siblings)
  }

  const result: ProcessNode[] = []
  const visited = new Set<number>()
  function visit(parentPid: number) {
    if (visited.has(parentPid)) return
    visited.add(parentPid)
    for (const child of children.get(parentPid) ?? []) {
      visit(child.pid)
      result.push(child)
    }
  }
  visit(rootPid)
  return result
}

function waitForClose(child: ChildProcess): Promise<void> {
  // 调用方只在仍持有受管 handle 时进入这里。即使 exitCode 已设置，也必须观察
  // 真实 close；否则 stdout/stderr 的最后数据尚未排空，所有权不能提前释放。
  return new Promise((resolve) => child.once('close', () => resolve()))
}

async function settlesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null && child.exitCode !== undefined
    || child.signalCode !== null && child.signalCode !== undefined
}

function isNoSuchProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}
