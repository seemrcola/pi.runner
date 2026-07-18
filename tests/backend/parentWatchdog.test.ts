import { describe, expect, it, vi } from 'vitest'
import { startParentWatchdog } from '../../backend/process/parentWatchdog.js'

describe('backend parent watchdog', () => {
  it('requests shutdown once when the Electron parent disappears', () => {
    let callback: (() => void) | undefined
    let parentPid = 7001
    const timer = { unref: vi.fn() }
    const onOrphaned = vi.fn()
    const stop = startParentWatchdog({
      expectedParentPid: '7001',
      readParentPid: () => parentPid,
      onOrphaned,
      setInterval: ((next: () => void) => {
        callback = next
        return timer
      }) as never,
      clearInterval: vi.fn() as never,
    })

    callback?.()
    expect(onOrphaned).not.toHaveBeenCalled()
    parentPid = 1
    callback?.()
    callback?.()

    expect(onOrphaned).toHaveBeenCalledOnce()
    expect(timer.unref).toHaveBeenCalledOnce()
    stop()
  })

  it('stays disabled when no trusted supervisor PID is configured', () => {
    const schedule = vi.fn()
    const stop = startParentWatchdog({
      onOrphaned: vi.fn(),
      setInterval: schedule as never,
    })

    expect(schedule).not.toHaveBeenCalled()
    expect(stop).not.toThrow()
  })
})
