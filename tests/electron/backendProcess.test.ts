import { describe, expect, it } from 'vitest'
import {
  createBackendProcessEnv,
  getBackendRestartDelayMs,
  shouldRestartBackendProcess,
  shouldStartBackendProcess,
} from '../../electron/backendProcess'

describe('backend process recovery policy', () => {
  it('runs the packaged Electron executable in Node mode for the backend child', () => {
    expect(createBackendProcessEnv({ PATH: '/usr/bin' }, 47831, 'secret')).toMatchObject({
      PATH: '/usr/bin',
      ELECTRON_RUN_AS_NODE: '1',
      PI_DESKTOP_BACKEND_PORT: '47831',
      PI_DESKTOP_BACKEND_TOKEN: 'secret',
      PI_DESKTOP_SUPERVISOR_PID: String(process.pid),
    })
  })

  it('restarts unexpected exits while the app is active', () => {
    expect(shouldRestartBackendProcess({ intentionalStop: false, appQuitting: false })).toBe(true)
  })

  it('does not restart intentional stops or app quit shutdown', () => {
    expect(shouldRestartBackendProcess({ intentionalStop: true, appQuitting: false })).toBe(false)
    expect(shouldRestartBackendProcess({ intentionalStop: false, appQuitting: true })).toBe(false)
  })

  it('uses capped backend restart backoff', () => {
    expect(getBackendRestartDelayMs(0)).toBe(500)
    expect(getBackendRestartDelayMs(1)).toBe(1000)
    expect(getBackendRestartDelayMs(4)).toBe(8000)
    expect(getBackendRestartDelayMs(10)).toBe(10000)
  })

  it('waits for the previous backend process to exit before starting another one', () => {
    expect(shouldStartBackendProcess(null)).toBe(true)
    expect(shouldStartBackendProcess({ killed: false })).toBe(false)
    expect(shouldStartBackendProcess({ killed: true })).toBe(false)
  })
})
