import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createSessionIndexStore } from '../../../backend/sessions/sessionIndexStore.js'

function writePiSession(dir: string, name: string, lines: unknown[]): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
  return path
}

describe('session index store', () => {
  it('indexes pi source sessions into sqlite and lists conversations newest first', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const older = writePiSession(sourceRoot, 'older.jsonl', [
      {
        type: 'session',
        id: 'older-session',
        timestamp: '2026-06-30T01:00:00.000Z',
        cwd: '/Users/example/project-a',
      },
      {
        type: 'message',
        id: 'older-user',
        timestamp: '2026-06-30T01:01:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'older question' }],
        },
      },
    ])
    const newer = writePiSession(sourceRoot, 'newer.jsonl', [
      {
        type: 'session',
        id: 'newer-session',
        timestamp: '2026-06-30T02:00:00.000Z',
      },
      {
        type: 'message',
        id: 'newer-user',
        timestamp: '2026-06-30T02:01:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'newer question' }],
        },
      },
    ])

    const store = createSessionIndexStore(join(dataDir, 'session-index.sqlite'), sourceRoot)
    const result = store.sync()

    expect(existsSync(join(dataDir, 'session-index.sqlite'))).toBe(true)
    expect(result).toEqual({ indexed: 2, removed: 0, skipped: 0, failed: 0 })
    expect(store.listConversations()).toMatchObject([
      {
        id: 'newer-session',
        title: 'newer question',
        sessionPath: newer,
        kind: 'session',
      },
      {
        id: 'older-session',
        title: 'older question',
        sessionPath: older,
        workspacePath: '/Users/example/project-a',
        kind: 'workspace',
      },
    ])
  })

  it('skips unchanged files and removes sqlite rows for deleted source files', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const sourcePath = writePiSession(sourceRoot, 'session.jsonl', [
      {
        type: 'session',
        id: 'session-1',
        timestamp: '2026-06-30T01:00:00.000Z',
      },
    ])
    const store = createSessionIndexStore(join(dataDir, 'session-index.sqlite'), sourceRoot)

    expect(store.sync()).toEqual({ indexed: 1, removed: 0, skipped: 0, failed: 0 })
    expect(store.sync()).toEqual({ indexed: 0, removed: 0, skipped: 1, failed: 0 })

    rmSync(sourcePath)

    expect(store.sync()).toEqual({ indexed: 0, removed: 1, skipped: 0, failed: 0 })
    expect(store.listConversations()).toEqual([])
  })

  it('reindexes unchanged files when the cached parser version is stale', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const dbPath = join(dataDir, 'session-index.sqlite')
    writePiSession(sourceRoot, 'session.jsonl', [
      {
        type: 'session',
        id: 'session-with-image',
        timestamp: '2026-06-30T01:00:00.000Z',
      },
      {
        type: 'message',
        id: 'user-with-image',
        timestamp: '2026-06-30T01:01:00.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'look at this' },
            { type: 'image', data: 'abc123', mimeType: 'image/png' },
          ],
        },
      },
    ])
    const store = createSessionIndexStore(dbPath, sourceRoot)
    expect(store.sync()).toEqual({ indexed: 1, removed: 0, skipped: 0, failed: 0 })

    const db = new DatabaseSync(dbPath)
    db.prepare('update sessions set parser_version = 0, messages_json = ?').run(JSON.stringify([
      {
        id: 'user-with-image',
        role: 'user',
        text: 'look at this',
        timestamp: Date.now(),
      },
    ]))
    db.close()

    expect(store.sync()).toEqual({ indexed: 1, removed: 0, skipped: 0, failed: 0 })
    expect(store.listConversations()[0].messages[0]).toMatchObject({
      id: 'user-with-image',
      images: [{ type: 'image', data: 'abc123', mimeType: 'image/png' }],
    })
  })

  it('reindexes a source file when its mtime or size changes', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const sourcePath = writePiSession(sourceRoot, 'session.jsonl', [
      {
        type: 'session',
        id: 'session-1',
        timestamp: '2026-06-30T01:00:00.000Z',
      },
    ])
    const store = createSessionIndexStore(join(dataDir, 'session-index.sqlite'), sourceRoot)
    store.sync()

    writeFileSync(
      sourcePath,
      [
        JSON.stringify({
          type: 'session',
          id: 'session-1',
          timestamp: '2026-06-30T01:00:00.000Z',
        }),
        JSON.stringify({
          type: 'message',
          id: 'user-1',
          timestamp: '2026-06-30T01:01:00.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'updated question' }] },
        }),
      ].join('\n') + '\n',
    )

    expect(statSync(sourcePath).size).toBeGreaterThan(0)
    expect(store.sync()).toEqual({ indexed: 1, removed: 0, skipped: 0, failed: 0 })
    expect(store.listConversations()[0]).toMatchObject({
      id: 'session-1',
      title: 'updated question',
    })
  })

  it('keeps the previous projection when the source file ends with an incomplete JSONL record', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const sourcePath = writePiSession(sourceRoot, 'session.jsonl', [
      {
        type: 'session',
        id: 'session-1',
        timestamp: '2026-06-30T01:00:00.000Z',
      },
      {
        type: 'message',
        id: 'user-1',
        timestamp: '2026-06-30T01:01:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'complete question' }] },
      },
    ])
    const store = createSessionIndexStore(join(dataDir, 'session-index.sqlite'), sourceRoot)
    expect(store.sync()).toEqual({ indexed: 1, removed: 0, skipped: 0, failed: 0 })

    writeFileSync(sourcePath, '{"type":"session","id":"session-1"}\n{"type":"message","id":"partial"')

    expect(store.sync()).toEqual({ indexed: 0, removed: 0, skipped: 0, failed: 1 })
    expect(store.listConversations()[0].messages).toMatchObject([
      { id: 'user-1', text: 'complete question' },
    ])
  })

  it('syncs one changed session without reindexing other changed sessions', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const firstPath = writePiSession(sourceRoot, 'first.jsonl', [
      {
        type: 'session',
        id: 'first-session',
        timestamp: '2026-06-30T01:00:00.000Z',
      },
      {
        type: 'message',
        id: 'first-user',
        timestamp: '2026-06-30T01:01:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'first old' }] },
      },
    ])
    const secondPath = writePiSession(sourceRoot, 'second.jsonl', [
      {
        type: 'session',
        id: 'second-session',
        timestamp: '2026-06-30T02:00:00.000Z',
      },
      {
        type: 'message',
        id: 'second-user',
        timestamp: '2026-06-30T02:01:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'second old' }] },
      },
    ])
    const store = createSessionIndexStore(join(dataDir, 'session-index.sqlite'), sourceRoot)
    store.sync()

    writePiSession(sourceRoot, 'first.jsonl', [
      {
        type: 'session',
        id: 'first-session',
        timestamp: '2026-06-30T01:00:00.000Z',
      },
      {
        type: 'message',
        id: 'first-user-updated',
        timestamp: '2026-06-30T01:02:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'first updated' }] },
      },
    ])
    writePiSession(sourceRoot, 'second.jsonl', [
      {
        type: 'session',
        id: 'second-session',
        timestamp: '2026-06-30T02:00:00.000Z',
      },
      {
        type: 'message',
        id: 'second-user-updated',
        timestamp: '2026-06-30T02:02:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'second updated' }] },
      },
    ])

    expect(store.syncSession(firstPath)).toEqual({ indexed: 1, removed: 0, skipped: 0, failed: 0 })
    expect(store.listConversations()).toEqual([
      expect.objectContaining({
        id: 'second-session',
        title: 'second old',
        sessionPath: secondPath,
      }),
      expect.objectContaining({
        id: 'first-session',
        title: 'first updated',
        sessionPath: firstPath,
      }),
    ])
  })

  it('uses desktop view metadata instead of cwd alone for sidebar classification', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const home = '/Users/example'
    const sessionOnlyPath = writePiSession(sourceRoot, 'session-only.jsonl', [
      {
        type: 'session',
        id: 'session-only',
        timestamp: '2026-06-30T01:00:00.000Z',
        cwd: home,
      },
    ])
    const homeWorkspacePath = writePiSession(sourceRoot, 'home-workspace.jsonl', [
      {
        type: 'session',
        id: 'home-workspace',
        timestamp: '2026-06-30T02:00:00.000Z',
        cwd: home,
      },
    ])
    const store = createSessionIndexStore(join(dataDir, 'session-index.sqlite'), sourceRoot)

    store.recordViewOverride(sessionOnlyPath, 'session')
    store.recordViewOverride(homeWorkspacePath, 'workspace', home)
    store.sync()

    expect(store.listConversations()).toMatchObject([
      {
        id: 'home-workspace',
        kind: 'workspace',
        workspacePath: home,
      },
      {
        id: 'session-only',
        kind: 'session',
      },
    ])
    expect(store.listConversations()[1]).not.toHaveProperty('workspacePath')
  })

  it('keeps a placeholder row for a newly started session until pi writes the source file', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const sourcePath = join(sourceRoot, 'pending.jsonl')
    const store = createSessionIndexStore(join(dataDir, 'session-index.sqlite'), sourceRoot)

    store.recordSessionPlaceholder({
      id: 'conv-1',
      sessionPath: sourcePath,
      title: 'New conversation',
      viewKind: 'session',
      createdAt: 100,
    })

    expect(store.listConversations()).toMatchObject([
      {
        id: 'conv-1',
        title: 'New conversation',
        sessionPath: sourcePath,
        kind: 'session',
      },
    ])
    expect(store.sync()).toEqual({ indexed: 0, removed: 0, skipped: 0, failed: 0 })
    expect(store.listConversations()).toHaveLength(1)

    writePiSession(sourceRoot, 'pending.jsonl', [
      {
        type: 'session',
        id: 'pi-session-id',
        timestamp: '2026-06-30T01:00:00.000Z',
      },
      {
        type: 'message',
        id: 'user-1',
        timestamp: '2026-06-30T01:01:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'real prompt' }] },
      },
    ])

    expect(store.sync()).toEqual({ indexed: 1, removed: 0, skipped: 0, failed: 0 })
    expect(store.listConversations()[0]).toMatchObject({
      id: 'conv-1',
      title: 'real prompt',
      sessionPath: sourcePath,
      kind: 'session',
    })
  })

  it('persists desktop image attachments as projection metadata across store reloads', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const dbPath = join(dataDir, 'session-index.sqlite')
    const sourcePath = writePiSession(sourceRoot, 'image-session.jsonl', [
      {
        type: 'session',
        id: 'session-with-image',
        timestamp: '2026-06-30T01:00:00.000Z',
      },
      {
        type: 'message',
        id: 'prompt-1',
        timestamp: '2026-06-30T01:01:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'look at this' }] },
      },
    ])
    const store = createSessionIndexStore(dbPath, sourceRoot)
    store.sync()

    store.recordMessageImages({
      conversationId: 'session-with-image',
      messageId: 'prompt-1',
      promptText: 'look at this',
      images: [{ type: 'image', data: Buffer.from('fake image').toString('base64'), mimeType: 'image/png' }],
    })

    const reloaded = createSessionIndexStore(dbPath, sourceRoot)
    const conversation = reloaded.listConversations()[0]

    expect(conversation.sessionPath).toBe(sourcePath)
    expect(conversation.messages[0]).toMatchObject({
      id: 'prompt-1',
      images: [{ type: 'image', data: Buffer.from('fake image').toString('base64'), mimeType: 'image/png' }],
    })
    expect(existsSync(join(dataDir, 'attachments'))).toBe(true)
  })

  it('records desktop image attachments by session path when conversation id is only a renderer view id', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const dbPath = join(dataDir, 'session-index.sqlite')
    const sourcePath = writePiSession(sourceRoot, 'image-session.jsonl', [
      {
        type: 'session',
        id: 'pi-session-id',
        timestamp: '2026-06-30T01:00:00.000Z',
      },
      {
        type: 'message',
        id: 'prompt-1',
        timestamp: '2026-06-30T01:01:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'look at this' }] },
      },
    ])
    const store = createSessionIndexStore(dbPath, sourceRoot)
    store.sync()

    store.recordMessageImages({
      conversationId: 'renderer-view-id',
      sessionPath: sourcePath,
      messageId: 'prompt-1',
      promptText: 'look at this',
      images: [{ type: 'image', data: Buffer.from('fake image').toString('base64'), mimeType: 'image/png' }],
    })

    expect(createSessionIndexStore(dbPath, sourceRoot).listConversations()[0].messages[0]).toMatchObject({
      id: 'prompt-1',
      images: [{ type: 'image', data: Buffer.from('fake image').toString('base64'), mimeType: 'image/png' }],
    })
  })

  it('matches persisted image attachments to pi messages when rpc prompt ids differ from jsonl message ids', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const dbPath = join(dataDir, 'session-index.sqlite')
    writePiSession(sourceRoot, 'image-session.jsonl', [
      {
        type: 'session',
        id: 'session-with-image',
        timestamp: '2026-06-30T01:00:00.000Z',
      },
      {
        type: 'message',
        id: 'pi-user-1',
        timestamp: '2026-06-30T01:01:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'look at this' }] },
      },
    ])
    const store = createSessionIndexStore(dbPath, sourceRoot)
    store.sync()

    store.recordMessageImages({
      conversationId: 'session-with-image',
      messageId: 'prompt-1',
      promptText: 'look at this',
      images: [{ type: 'image', data: Buffer.from('fake image').toString('base64'), mimeType: 'image/png' }],
    })

    const [message] = createSessionIndexStore(dbPath, sourceRoot).listConversations()[0].messages

    expect(message).toMatchObject({
      id: 'pi-user-1',
      images: [{ type: 'image', data: Buffer.from('fake image').toString('base64'), mimeType: 'image/png' }],
    })
  })

  it('matches image-only persisted attachments by the actual prompt text instead of the first user message', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const dbPath = join(dataDir, 'session-index.sqlite')
    writePiSession(sourceRoot, 'image-session.jsonl', [
      {
        type: 'session',
        id: 'session-with-image',
        timestamp: '2026-06-30T01:00:00.000Z',
      },
      {
        type: 'message',
        id: 'pi-user-1',
        timestamp: '2026-06-30T01:01:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'earlier text prompt' }] },
      },
      {
        type: 'message',
        id: 'pi-user-2',
        timestamp: '2026-06-30T01:02:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Describe this image.' }] },
      },
    ])
    const store = createSessionIndexStore(dbPath, sourceRoot)
    store.sync()

    store.recordMessageImages({
      conversationId: 'session-with-image',
      messageId: 'prompt-1',
      promptText: 'Describe this image.',
      images: [{ type: 'image', data: Buffer.from('fake image').toString('base64'), mimeType: 'image/png' }],
    })

    const messages = createSessionIndexStore(dbPath, sourceRoot).listConversations()[0].messages

    expect(messages[0].images).toBeUndefined()
    expect(messages[1]).toMatchObject({
      id: 'pi-user-2',
      images: [{ type: 'image', data: Buffer.from('fake image').toString('base64'), mimeType: 'image/png' }],
    })
  })

  it('does not attach desktop image projections to non-user messages even when ids collide', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const dbPath = join(dataDir, 'session-index.sqlite')
    writePiSession(sourceRoot, 'image-session.jsonl', [
      {
        type: 'session',
        id: 'session-with-image',
        timestamp: '2026-06-30T01:00:00.000Z',
      },
      {
        type: 'message',
        id: 'prompt-1',
        timestamp: '2026-06-30T01:01:00.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'assistant response' }] },
      },
      {
        type: 'message',
        id: 'pi-user-1',
        timestamp: '2026-06-30T01:02:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'look at this' }] },
      },
    ])
    const store = createSessionIndexStore(dbPath, sourceRoot)
    store.sync()

    store.recordMessageImages({
      conversationId: 'session-with-image',
      messageId: 'prompt-1',
      promptText: 'look at this',
      images: [{ type: 'image', data: Buffer.from('fake image').toString('base64'), mimeType: 'image/png' }],
    })

    const messages = createSessionIndexStore(dbPath, sourceRoot).listConversations()[0].messages

    expect(messages[0].images).toBeUndefined()
    expect(messages[1]).toMatchObject({
      id: 'pi-user-1',
      images: [{ type: 'image', data: Buffer.from('fake image').toString('base64'), mimeType: 'image/png' }],
    })
  })

  it('does not duplicate a desktop image projection when pi history already contains images for the prompt text', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const dbPath = join(dataDir, 'session-index.sqlite')
    writePiSession(sourceRoot, 'image-session.jsonl', [
      {
        type: 'session',
        id: 'session-with-image',
        timestamp: '2026-06-30T01:00:00.000Z',
      },
      {
        type: 'message',
        id: 'earlier-user',
        timestamp: '2026-06-30T01:01:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'earlier text prompt' }] },
      },
      {
        type: 'message',
        id: 'pi-user-with-image',
        timestamp: '2026-06-30T01:02:00.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'look at this' },
            { type: 'image', data: 'pi-image', mimeType: 'image/png' },
          ],
        },
      },
    ])
    const store = createSessionIndexStore(dbPath, sourceRoot)
    store.sync()

    store.recordMessageImages({
      conversationId: 'session-with-image',
      messageId: 'prompt-1',
      promptText: 'look at this',
      images: [{ type: 'image', data: Buffer.from('desktop image').toString('base64'), mimeType: 'image/png' }],
    })

    const messages = createSessionIndexStore(dbPath, sourceRoot).listConversations()[0].messages

    expect(messages[0].images).toBeUndefined()
    expect(messages[1]).toMatchObject({
      id: 'pi-user-with-image',
      images: [{ type: 'image', data: 'pi-image', mimeType: 'image/png' }],
    })
  })

  it('hides deleted sessions and workspaces without deleting pi source files', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const sessionPath = writePiSession(sourceRoot, 'session.jsonl', [
      {
        type: 'session',
        id: 'session-1',
        timestamp: '2026-06-30T01:00:00.000Z',
      },
    ])
    writePiSession(sourceRoot, 'workspace-a.jsonl', [
      {
        type: 'session',
        id: 'workspace-a',
        timestamp: '2026-06-30T02:00:00.000Z',
        cwd: '/tmp/project',
      },
    ])
    writePiSession(sourceRoot, 'workspace-b.jsonl', [
      {
        type: 'session',
        id: 'workspace-b',
        timestamp: '2026-06-30T03:00:00.000Z',
        cwd: '/tmp/project',
      },
    ])
    const store = createSessionIndexStore(join(dataDir, 'session-index.sqlite'), sourceRoot)
    store.sync()

    expect(store.listConversations()).toHaveLength(3)

    store.hideSession(sessionPath)
    expect(existsSync(sessionPath)).toBe(true)
    expect(store.listConversations().map((conversation) => conversation.id)).toEqual([
      'workspace-b',
      'workspace-a',
    ])

    store.hideWorkspace('/tmp/project')
    expect(store.listConversations()).toEqual([])
    expect(store.sync()).toEqual({ indexed: 0, removed: 0, skipped: 3, failed: 0 })
    expect(store.listConversations()).toEqual([])
  })

  it('uses normalized workspace identity for view state and hidden workspace metadata', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    writePiSession(sourceRoot, 'workspace.jsonl', [
      {
        type: 'session',
        id: 'workspace-session',
        timestamp: '2026-06-30T02:00:00.000Z',
        cwd: '/tmp/project',
      },
    ])
    const store = createSessionIndexStore(join(dataDir, 'session-index.sqlite'), sourceRoot)
    store.sync()

    store.upsertWorkspaceViewState('/tmp/project/../project/', { isPinned: true })
    store.hideWorkspace('/tmp/project/')

    expect(store.listWorkspaceViewStates()).toEqual([
      {
        workspacePath: '/tmp/project',
        isPinned: true,
        isCollapsed: false,
        pinnedAt: expect.any(Number),
        updatedAt: expect.any(Number),
      },
    ])
    expect(store.listConversations()).toEqual([])
  })

  it('hides a placeholder by conversation id before the frontend receives a session path', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const sourcePath = join(sourceRoot, 'pending-delete.jsonl')
    const store = createSessionIndexStore(join(dataDir, 'session-index.sqlite'), sourceRoot)

    store.recordSessionPlaceholder({
      id: 'conv-pending',
      sessionPath: sourcePath,
      title: 'New conversation',
      viewKind: 'session',
    })

    store.hideConversation('conv-pending')

    expect(store.listConversations()).toEqual([])
  })

  it('persists workspace view state across sqlite store reloads', () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'pi-source-sessions-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'pi-desktop-data-'))
    const dbPath = join(dataDir, 'session-index.sqlite')
    const store = createSessionIndexStore(dbPath, sourceRoot)

    store.upsertWorkspaceViewState('/tmp/project-a', { isPinned: true, isCollapsed: false })
    store.upsertWorkspaceViewState('/tmp/project-b', { isPinned: false, isCollapsed: true })
    store.upsertWorkspaceViewState('/tmp/project-a', { isPinned: false, isCollapsed: true })

    expect(createSessionIndexStore(dbPath, sourceRoot).listWorkspaceViewStates()).toEqual([
      {
        workspacePath: '/tmp/project-a',
        isPinned: false,
        isCollapsed: true,
        pinnedAt: null,
        updatedAt: expect.any(Number),
      },
      {
        workspacePath: '/tmp/project-b',
        isPinned: false,
        isCollapsed: true,
        pinnedAt: null,
        updatedAt: expect.any(Number),
      },
    ])
  })

})
