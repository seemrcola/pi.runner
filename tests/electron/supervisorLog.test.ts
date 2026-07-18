import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BackendSupervisorLog } from '../../electron/supervisorLog.js'
import { createTemporaryDirectoryTracker } from '../helpers/temporaryDirectories.js'

const temporaryDirectories = createTemporaryDirectoryTracker()
afterEach(() => temporaryDirectories.cleanup())

describe('BackendSupervisorLog', () => {
  it('persists structured lifecycle facts without process output', () => {
    const directory = temporaryDirectories.create('backend-supervisor-log-')
    const filePath = join(directory, 'runtime', 'backend-supervisor.jsonl')
    const log = new BackendSupervisorLog(filePath)

    log.record({ event: 'spawned', instanceId: 'one', pid: 7001, groupId: 7001 })

    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toMatchObject({
      event: 'spawned',
      instanceId: 'one',
      pid: 7001,
      groupId: 7001,
    })
  })
})
