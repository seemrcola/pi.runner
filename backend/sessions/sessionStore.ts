import { mkdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export type SessionStore = {
  readonly rootDir: string
  newSessionPath(): string
  isSourceSessionPath(sessionPath: string): boolean
  resolveSessionPath(sessionPath?: string | null): string
}

export function createSessionStore(rootDir: string): SessionStore {
  const normalizedRoot = resolve(rootDir)
  mkdirSync(normalizedRoot, { recursive: true })

  function newSessionPath(): string {
    const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}_${randomUUID()}.jsonl`
    return join(normalizedRoot, filename)
  }

  function isSourceSessionPath(sessionPath: string): boolean {
    const rel = relative(normalizedRoot, resolve(sessionPath))
    return Boolean(rel) && !rel.startsWith('..') && !rel.startsWith('/')
  }

  return {
    rootDir: normalizedRoot,
    newSessionPath,
    isSourceSessionPath,
    resolveSessionPath(sessionPath) {
      const trimmed = sessionPath?.trim()
      if (!trimmed) return newSessionPath()
      if (!isSourceSessionPath(trimmed)) {
        throw new Error('Session path is outside the Pi source sessions directory')
      }
      return resolve(trimmed)
    },
  }
}
