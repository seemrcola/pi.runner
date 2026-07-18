import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDesktopDataDir } from '../../backend/config/paths.js'

describe('backend paths', () => {
  it('stores local sqlite data under the pi.runner home directory by default', () => {
    expect(resolveDesktopDataDir({})).toBe(join(homedir(), 'pi.runner', 'data'))
  })

  it('allows the sqlite data directory to be overridden for tests and dev runs', () => {
    expect(resolveDesktopDataDir({ PI_DESKTOP_DATA_DIR: '/tmp/pi-runner-data' })).toBe('/tmp/pi-runner-data')
  })
})
