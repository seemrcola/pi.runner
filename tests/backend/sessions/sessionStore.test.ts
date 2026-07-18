import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createSessionStore } from '../../../backend/sessions/sessionStore.js'

describe('session store', () => {
  it('allocates new runtime session paths inside the Pi source sessions directory', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const store = createSessionStore(sourceRoot)

    const path = store.resolveSessionPath(null)

    expect(path.startsWith(`${sourceRoot}/`)).toBe(true)
    expect(path.endsWith('.jsonl')).toBe(true)
  })

  it('reuses existing Pi source session paths', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const store = createSessionStore(sourceRoot)
    const sourcePath = join(sourceRoot, 'session-existing.jsonl')

    expect(store.resolveSessionPath(sourcePath)).toBe(sourcePath)
  })

  it('rejects paths outside the Pi source sessions directory', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const store = createSessionStore(sourceRoot)

    expect(() => store.resolveSessionPath('/tmp/outside.jsonl')).toThrow(
      'Session path is outside the Pi source sessions directory',
    )
  })
})
