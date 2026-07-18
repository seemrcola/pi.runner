import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { StatementSync } from 'node:sqlite'
import { readParsedSession } from './sessionJsonlParser.js'
import type { SessionIndexSyncResult, SessionMetaRow, SourcePathRow } from './sessionIndexTypes.js'

const CURRENT_SESSION_PARSER_VERSION = 2

export type SessionIndexSyncStatements = {
  selectMeta: StatementSync
  selectSourcePaths: StatementSync
  deleteBySourcePath: StatementSync
  upsert: StatementSync
}

export function syncSessionIndex(sourceRoot: string, statements: SessionIndexSyncStatements): SessionIndexSyncResult {
  const result = emptySyncResult()
  const sourcePaths = listSessionFiles(sourceRoot)
  const sourcePathSet = new Set(sourcePaths)

  for (const row of statements.selectSourcePaths.all() as SourcePathRow[]) {
    if (sourcePathSet.has(row.sourcePath)) continue
    if (row.isPlaceholder) continue
    statements.deleteBySourcePath.run(row.sourcePath)
    result.removed += 1
  }

  for (const sourcePath of sourcePaths) {
    syncExistingSourcePath(sourcePath, statements, result)
  }

  return result
}

export function syncSingleSession(
  sourceRoot: string,
  sessionPath: string,
  statements: SessionIndexSyncStatements,
): SessionIndexSyncResult {
  const sourcePath = resolve(sessionPath)
  const result = emptySyncResult()
  try {
    assertSourceSessionPath(sourceRoot, sourcePath)
    const existing = statements.selectMeta.get(sourcePath) as SessionMetaRow | undefined
    if (!existsSync(sourcePath)) {
      if (existing?.isPlaceholder) {
        result.skipped += 1
      } else if (existing) {
        statements.deleteBySourcePath.run(sourcePath)
        result.removed += 1
      } else {
        result.skipped += 1
      }
      return result
    }

    syncExistingSourcePath(sourcePath, statements, result)
  } catch {
    result.failed += 1
  }
  return result
}

export function assertSourceSessionPath(sourceRoot: string, sessionPath: string): void {
  const rel = relative(resolve(sourceRoot), resolve(sessionPath))
  if (!rel || rel.startsWith('..') || rel.startsWith('/')) {
    throw new Error('Session path is not managed by Pi sessions')
  }
}

function syncExistingSourcePath(
  sourcePath: string,
  statements: SessionIndexSyncStatements,
  result: SessionIndexSyncResult,
): void {
  try {
    const info = statSync(sourcePath)
    const existing = statements.selectMeta.get(sourcePath) as SessionMetaRow | undefined
    if (
      existing?.sourceMtime === info.mtimeMs &&
      existing.sourceSize === info.size &&
      existing.parserVersion === CURRENT_SESSION_PARSER_VERSION &&
      !existing.isPlaceholder
    ) {
      result.skipped += 1
      return
    }

    const parsed = readParsedSession(sourcePath, info.mtimeMs, info.size)
    statements.upsert.run(
      parsed.id,
      parsed.sourcePath,
      parsed.sourceMtime,
      parsed.sourceSize,
      parsed.title,
      parsed.workspacePath ?? null,
      parsed.kind ?? 'session',
      parsed.createdAt,
      parsed.updatedAt,
      JSON.stringify(parsed.messages),
      Date.now(),
      CURRENT_SESSION_PARSER_VERSION,
    )
    result.indexed += 1
  } catch {
    result.failed += 1
  }
}

function emptySyncResult(): SessionIndexSyncResult {
  return { indexed: 0, removed: 0, skipped: 0, failed: 0 }
}

function listSessionFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listSessionFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [resolve(path)] : []
  })
}
