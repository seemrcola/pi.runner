export type SessionIndexSyncResult = {
  indexed: number
  removed: number
  skipped: number
  failed: number
}

export type SessionRow = {
  id: string
  title: string
  sourcePath: string
  sourceMtime: number
  sourceSize: number
  workspacePath: string | null
  kind: 'session' | 'workspace'
  createdAt: number
  updatedAt: number
  messagesJson: string
}

export type SourcePathRow = {
  sourcePath: string
  isPlaceholder: number
}

export type SessionMetaRow = {
  sourceMtime: number
  sourceSize: number
  isPlaceholder: number
  parserVersion: number
  id: string
}
