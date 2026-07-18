import { readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionLeaseRegistry } from '../../../backend/pi/sessionLeaseRegistry.js'
import type { ProcessIdentity } from '../../../backend/process/processIdentity.js'
import { createTemporaryDirectoryTracker } from '../../helpers/temporaryDirectories.js'

const temporaryDirectories = createTemporaryDirectoryTracker()
afterEach(() => temporaryDirectories.cleanup())

describe('SessionLeaseRegistry runtime locks', () => {
  it('treats a symlink alias as the same live session across registries', () => {
    const { root, runtimeDir, sessionPath } = createRuntimeLockFixture()
    const aliasPath = join(root, 'alias.jsonl')
    symlinkSync(sessionPath, aliasPath)
    const identities = identityReader(new Map([
      [process.pid, identity(process.pid, 'backend')],
      [9001, identity(9001, 'pi')],
    ]))
    const first = new SessionLeaseRegistry({ runtimeDir, instanceId: 'one', readProcessIdentity: identities })
    const second = new SessionLeaseRegistry({ runtimeDir, instanceId: 'two', readProcessIdentity: identities })

    first.claim(sessionPath, 'conversation-a')
    first.setWriter(sessionPath, 'conversation-a', 9001)

    expect(() => second.claim(aliasPath, 'conversation-b')).toThrow('held by another live process')
    first.release(sessionPath, 'conversation-a')
    expect(() => second.claim(aliasPath, 'conversation-b')).not.toThrow()
  })

  it('recovers a complete stale lock only after owner and writer are both absent', () => {
    const { runtimeDir, sessionPath } = createRuntimeLockFixture()
    const live = new Map([
      [process.pid, identity(process.pid, 'backend')],
      [9002, identity(9002, 'pi')],
    ])
    const first = new SessionLeaseRegistry({
      runtimeDir,
      instanceId: 'one',
      readProcessIdentity: identityReader(live),
    })
    first.claim(sessionPath, 'conversation-a')
    first.setWriter(sessionPath, 'conversation-a', 9002)
    live.delete(9002)
    live.set(process.pid, identity(process.pid, 'new-backend'))

    const second = new SessionLeaseRegistry({
      runtimeDir,
      instanceId: 'two',
      readProcessIdentity: identityReader(live),
    })
    expect(() => second.claim(sessionPath, 'conversation-b')).not.toThrow()
    expect(second.ownerOf(sessionPath)).toBe('conversation-b')
  })

  it('fails closed when existing lock metadata is damaged', () => {
    const { runtimeDir, sessionPath } = createRuntimeLockFixture()
    const registry = new SessionLeaseRegistry({
      runtimeDir,
      instanceId: 'one',
      readProcessIdentity: identityReader(new Map([[process.pid, identity(process.pid, 'backend')]])),
    })
    registry.claim(sessionPath, 'conversation-a')
    const lockDirectory = join(runtimeDir, readdirSync(runtimeDir)[0])
    writeFileSync(join(lockDirectory, 'owner.json'), '{broken')

    const next = new SessionLeaseRegistry({
      runtimeDir,
      instanceId: 'two',
      readProcessIdentity: () => null,
    })
    expect(() => next.claim(sessionPath, 'conversation-b')).toThrow()
    expect(readFileSync(join(lockDirectory, 'owner.json'), 'utf8')).toBe('{broken')
  })

  it('fails closed when an unverified owner PID is still visible', () => {
    const { runtimeDir, sessionPath } = createRuntimeLockFixture()
    let ownerIdentityAvailable = false
    let writerAlive = true
    const identities = (pid: number) => {
      if (pid === process.pid) return ownerIdentityAvailable ? identity(pid, 'backend') : null
      if (pid === 9003 && writerAlive) return identity(pid, 'pi')
      return null
    }
    const first = new SessionLeaseRegistry({
      runtimeDir,
      instanceId: 'one',
      readProcessIdentity: identities,
    })
    first.claim(sessionPath, 'conversation-a')
    first.setWriter(sessionPath, 'conversation-a', 9003)
    ownerIdentityAvailable = true
    writerAlive = false

    const second = new SessionLeaseRegistry({
      runtimeDir,
      instanceId: 'two',
      readProcessIdentity: identities,
    })
    expect(() => second.claim(sessionPath, 'conversation-b')).toThrow(
      'Cannot verify existing session runtime lock owner',
    )
  })
})

function createRuntimeLockFixture() {
  const root = temporaryDirectories.create('pi-runner-lock-')
  const sessionPath = join(root, 'one.jsonl')
  writeFileSync(sessionPath, '')
  return { root, sessionPath, runtimeDir: join(root, 'runtime') }
}

function identity(pid: number, command: string): ProcessIdentity {
  return { pid, startedAt: `start-${pid}`, command }
}

function identityReader(identities: Map<number, ProcessIdentity>) {
  return (pid: number) => identities.get(pid) ?? null
}
