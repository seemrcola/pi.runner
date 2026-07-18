import { describe, expect, it, vi } from 'vitest'
import { BackendProcessSupervisor } from '../../electron/backendSupervisor.js'
import { createFakeChildProcess } from '../helpers/fakeChildProcess.js'

describe('BackendProcessSupervisor', () => {
  it('cleans an unexpected backend group before scheduling restart', async () => {
    const child = createFakeChildProcess(7101)
    const terminateGroup = vi.fn(async () => {})
    const scheduled: Array<() => void> = []
    const events: Array<{ event: string; [key: string]: unknown }> = []
    const supervisor = new BackendProcessSupervisor({
      spawnBackend: () => ({ child: child as never, instanceId: 'backend-a' }),
      verifyReady: async () => {},
      terminateGroup,
      setTimeout: ((callback: () => void) => {
        scheduled.push(callback)
        return { unref() {} }
      }) as never,
      onEvent: (event) => events.push(event),
    })

    supervisor.start()
    child.exitCode = 1
    child.emit('close', 1, null)
    await vi.waitFor(() => expect(terminateGroup).toHaveBeenCalledWith(7101))
    expect(scheduled).toHaveLength(1)
    expect(events).toContainEqual(expect.objectContaining({ event: 'spawned', pid: 7101 }))
    expect(events).toContainEqual(expect.objectContaining({ event: 'cleanup_completed' }))
    expect(events).toContainEqual(expect.objectContaining({ event: 'restart_scheduled', attempt: 1 }))
  })

  it('cancels a pending restart during app stop', async () => {
    const child = createFakeChildProcess(7102)
    const clearTimeout = vi.fn()
    let scheduled: (() => void) | undefined
    const supervisor = new BackendProcessSupervisor({
      spawnBackend: () => ({ child: child as never, instanceId: 'backend-a' }),
      verifyReady: async () => {},
      terminateGroup: async () => {},
      setTimeout: ((callback: () => void) => {
        scheduled = callback
        return { unref() {} }
      }) as never,
      clearTimeout: clearTimeout as never,
    })

    supervisor.start()
    child.emit('close', 1, null)
    await vi.waitFor(() => expect(scheduled).toBeTypeOf('function'))
    await supervisor.stop()

    expect(clearTimeout).toHaveBeenCalledOnce()
  })

  it('sends TERM to backend first and awaits group cleanup without scheduling restart', async () => {
    const child = createFakeChildProcess(7103)
    child.kill.mockImplementation(() => {
      queueMicrotask(() => child.emit('close', 0, 'SIGTERM'))
      return true
    })
    const terminateGroup = vi.fn(async () => {})
    const schedule = vi.fn()
    const supervisor = new BackendProcessSupervisor({
      spawnBackend: () => ({ child: child as never, instanceId: 'backend-a' }),
      verifyReady: async () => {},
      terminateGroup,
      setTimeout: schedule as never,
    })

    supervisor.start()
    await supervisor.stop()

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(terminateGroup).toHaveBeenCalledWith(7103)
    expect(schedule).not.toHaveBeenCalled()
  })

  it('allows group cleanup to be retried after a synchronous failure', async () => {
    const child = createFakeChildProcess(7104)
    const terminateGroup = vi.fn()
      .mockImplementationOnce(() => { throw new Error('temporary process lookup failure') })
      .mockResolvedValueOnce('already-exited')
    const supervisor = new BackendProcessSupervisor({
      spawnBackend: () => ({ child: child as never, instanceId: 'backend-a' }),
      verifyReady: async () => {},
      terminateGroup,
      setTimeout: (() => ({ unref() {} })) as never,
      clearTimeout: vi.fn() as never,
    })

    supervisor.start()
    child.exitCode = 1
    child.emit('close', 1, null)
    await vi.waitFor(() => expect(terminateGroup).toHaveBeenCalledOnce())
    await supervisor.stop()

    expect(terminateGroup).toHaveBeenCalledTimes(2)
  })

  it('retries failed cleanup before it schedules a backend restart', async () => {
    const child = createFakeChildProcess(7105)
    child.exitCode = 1
    const terminateGroup = vi.fn()
      .mockRejectedValueOnce(new Error('temporary process lookup failure'))
      .mockResolvedValueOnce('already-exited')
    const scheduled: Array<() => void> = []
    const events: Array<{ event: string }> = []
    const supervisor = new BackendProcessSupervisor({
      spawnBackend: () => ({ child: child as never, instanceId: 'backend-a' }),
      verifyReady: async () => {},
      terminateGroup,
      setTimeout: ((callback: () => void) => {
        scheduled.push(callback)
        return { unref() {} }
      }) as never,
      onEvent: (event) => events.push(event),
    })

    supervisor.start()
    child.emit('close', 1, null)
    await vi.waitFor(() => expect(scheduled).toHaveLength(1))
    expect(events).toContainEqual(expect.objectContaining({ event: 'cleanup_retry_scheduled' }))
    expect(events).not.toContainEqual(expect.objectContaining({ event: 'restart_scheduled' }))

    scheduled.shift()?.()
    await vi.waitFor(() => expect(terminateGroup).toHaveBeenCalledTimes(2))
    expect(events).toContainEqual(expect.objectContaining({ event: 'cleanup_completed' }))
    expect(events).toContainEqual(expect.objectContaining({ event: 'restart_scheduled' }))
  })
})
