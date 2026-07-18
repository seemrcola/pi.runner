import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  listDescendantsLeafFirst,
  terminateChildProcess,
  type ProcessTreePlatform,
} from '../../../backend/process/processTree.js'
import { createFakeChildProcess } from '../../helpers/fakeChildProcess.js'

describe('process tree termination', () => {
  it('lists descendants from leaves to the root child', async () => {
    const platform: ProcessTreePlatform = {
      listProcesses: async () => [
        { pid: 11, ppid: 10 },
        { pid: 12, ppid: 10 },
        { pid: 13, ppid: 11 },
      ],
      signal: vi.fn(),
    }

    await expect(listDescendantsLeafFirst(10, platform)).resolves.toEqual([13, 11, 12])
  })

  it('uses TERM first and does not force kill a child that closes', async () => {
    const child = createFakeChildProcess(41)
    child.kill.mockImplementation(() => {
      queueMicrotask(() => child.emit('close', 0, 'SIGTERM'))
      return true
    })
    const signal = vi.fn()

    await expect(terminateChildProcess(child as never, {
      graceMs: 100,
      platform: { listProcesses: async () => [], signal },
    })).resolves.toMatchObject({ outcome: 'graceful', pid: 41 })
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(signal).not.toHaveBeenCalled()
  })

  it('does not treat exit as terminal before stdio close', async () => {
    const child = createFakeChildProcess(44)
    child.exitCode = 0
    const termination = terminateChildProcess(child as never, {
      forceWaitMs: 100,
      platform: { listProcesses: async () => [], signal: vi.fn() },
    })
    let settled = false
    void termination.finally(() => { settled = true })
    await Promise.resolve()

    expect(settled).toBe(false)
    child.emit('close', 0, null)
    await expect(termination).resolves.toMatchObject({ outcome: 'already-exited', pid: 44 })
  })

  it('does not enumerate or kill a reused root PID after the TERM grace period', async () => {
    const child = createFakeChildProcess(42)
    const originalRoot = { pid: 42, startedAt: 'original', command: 'pi' }
    const originalDescendant = { pid: 43, startedAt: 'tool', command: 'tool' }
    let descendantAlive = true
    const listProcesses = vi.fn(async () => [
      { pid: 43, ppid: 42, identity: originalDescendant },
    ])
    const signal = vi.fn((pid: number, sentSignal: NodeJS.Signals) => {
      if (pid === 43 && sentSignal === 'SIGKILL') {
        descendantAlive = false
        child.exitCode = 0
        queueMicrotask(() => child.emit('close', 0, null))
      }
    })
    const platform: ProcessTreePlatform = {
      listProcesses,
      signal,
      readIdentity: () => originalRoot,
      isSameProcess: (identity) => identity.pid === 43 && descendantAlive,
    }

    await expect(terminateChildProcess(child as never, {
      graceMs: 1,
      forceWaitMs: 100,
      platform,
    })).resolves.toMatchObject({ outcome: 'forced', forcedPids: [43] })

    expect(listProcesses).toHaveBeenCalledOnce()
    expect(signal).not.toHaveBeenCalledWith(42, 'SIGKILL')
  })

  it.runIf(process.platform !== 'win32')('kills an uncooperative detached grandchild in a real process tree', async () => {
    const script = `
      const { spawn } = require('node:child_process')
      const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], {
        detached: true,
        stdio: 'ignore',
      })
      process.stdout.write(String(child.pid) + '\\n')
      process.on('SIGTERM', () => {})
      setInterval(() => {}, 1000)
    `
    const root = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
    const [chunk] = await once(root.stdout!, 'data') as [Buffer]
    const detachedPid = Number(chunk.toString().trim())

    try {
      const result = await terminateChildProcess(root, { graceMs: 50, forceWaitMs: 2_000 })
      expect(result.outcome).toBe('forced')
      expect(result.forcedPids).toContain(detachedPid)
      expect(isProcessAlive(detachedPid)).toBe(false)
    } finally {
      try { process.kill(detachedPid, 'SIGKILL') } catch {}
      try { root.kill('SIGKILL') } catch {}
    }
  })
})

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
