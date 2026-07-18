import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonlProcessLifecycleLog } from '../../../backend/pi/lifecycleLog.js'
import { createTemporaryDirectoryTracker } from '../../helpers/temporaryDirectories.js'

const temporaryDirectories = createTemporaryDirectoryTracker()
afterEach(() => temporaryDirectories.cleanup())

describe('JsonlProcessLifecycleLog', () => {
  it('persists lifecycle facts without writing the raw session path', () => {
    const root = temporaryDirectories.create('pi-runner-log-')
    const filePath = join(root, 'runtime', 'process-lifecycle.jsonl')
    const log = new JsonlProcessLifecycleLog(filePath, 'backend-a')

    log.record({
      event: 'runner_spawned',
      conversationId: 'conversation-a',
      sessionPath: '/Users/example/private/session.jsonl',
      pid: 42,
    })

    const content = readFileSync(filePath, 'utf8')
    expect(content).toContain('"instanceId":"backend-a"')
    expect(content).toContain('"event":"runner_spawned"')
    expect(content).toContain('"pid":42')
    expect(content).not.toContain('/Users/example/private/session.jsonl')
  })
})
