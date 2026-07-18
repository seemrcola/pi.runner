import { describe, expect, it, vi } from 'vitest'
import { terminateProcessGroup, type ProcessGroupPlatform } from '../../electron/processGroup.js'

describe('terminateProcessGroup', () => {
  it('returns after a process group exits from SIGTERM', async () => {
    let alive = true
    const signalGroup = vi.fn((_groupId: number, signal: NodeJS.Signals) => {
      if (signal === 'SIGTERM') alive = false
    })
    const platform: ProcessGroupPlatform = {
      signalGroup,
      isGroupAlive: () => alive,
      delay: async () => {},
    }

    await expect(terminateProcessGroup(81, { platform })).resolves.toBe('graceful')
    expect(signalGroup).toHaveBeenCalledWith(81, 'SIGTERM')
    expect(signalGroup).not.toHaveBeenCalledWith(81, 'SIGKILL')
  })

  it('escalates to SIGKILL after the grace deadline', async () => {
    let alive = true
    const signalGroup = vi.fn((_groupId: number, signal: NodeJS.Signals) => {
      if (signal === 'SIGKILL') alive = false
    })
    const platform: ProcessGroupPlatform = {
      signalGroup,
      isGroupAlive: () => alive,
      delay: async () => {},
    }

    await expect(terminateProcessGroup(82, { platform, graceMs: 0 })).resolves.toBe('forced')
    expect(signalGroup.mock.calls).toEqual([
      [82, 'SIGTERM'],
      [82, 'SIGKILL'],
    ])
  })
})
