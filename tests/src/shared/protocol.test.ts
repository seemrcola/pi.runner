import { describe, expect, it } from 'vitest'
import {
  backendMessageSchema,
  clientMessageSchema,
  createRequestId,
  isPiStartedForRequest,
  parseBackendMessage,
  parseClientMessage,
} from '../../../shared/protocol.js'

describe('renderer/backend protocol helpers', () => {
  it('parses only known client messages at the websocket boundary', () => {
    expect(parseClientMessage('{"type":"ping"}')).toEqual({ type: 'ping' })
    expect(parseClientMessage('{"type":"sync_source_sessions","requestId":"sync-1"}')).toEqual({
      type: 'sync_source_sessions',
      requestId: 'sync-1',
    })
    expect(parseClientMessage('{"type":"sync_source_sessions"}')).toBeNull()
    expect(parseClientMessage('{"type":"list_workspace_view_states"}')).toEqual({ type: 'list_workspace_view_states' })
    expect(parseClientMessage('not-json')).toBeNull()
    expect(parseClientMessage('{}')).toBeNull()
    expect(parseClientMessage('{"type":"unknown"}')).toBeNull()
    expect(parseClientMessage('{"type":42}')).toBeNull()
  })

  it('uses a strict schema as the websocket boundary contract', () => {
    expect(clientMessageSchema.safeParse({ type: 'ping' }).success).toBe(true)
    expect(clientMessageSchema.safeParse({ type: 'ping', extra: true }).success).toBe(false)
    expect(parseClientMessage('{"type":"prompt","conversationId":"c1","prompt":"guide","extra":true}')).toBeNull()
  })

  it('parses only known backend messages at the websocket boundary', () => {
    expect(parseBackendMessage('{"type":"backend:pong"}')).toEqual({ type: 'backend:pong' })
    expect(parseBackendMessage('{"type":"runner:snapshot","snapshot":{"conversationId":"c1","phase":"running","createdAt":1,"lastActiveAt":2}}')).toEqual({
      type: 'runner:snapshot',
      snapshot: {
        conversationId: 'c1',
        phase: 'running',
        createdAt: 1,
        lastActiveAt: 2,
      },
    })
    expect(parseBackendMessage('not-json')).toBeNull()
    expect(parseBackendMessage('{"type":"runner:snapshot","snapshot":{"conversationId":"c1","phase":"bad","createdAt":1,"lastActiveAt":2}}')).toBeNull()
    expect(parseBackendMessage('{"type":"pi:text_delta","delta":"missing conversation"}')).toBeNull()
    expect(parseBackendMessage('{"type":"conversation:deleted","sessionPath":"/tmp/a","extra":true}')).toBeNull()
  })

  it('uses a strict schema for backend event payloads that mutate renderer state', () => {
    expect(backendMessageSchema.safeParse({ type: 'workspace:deleted', workspacePath: '/tmp/project', deletedCount: 1 }).success).toBe(true)
    expect(backendMessageSchema.safeParse({ type: 'workspace:deleted', workspacePath: '/tmp/project' }).success).toBe(false)
    expect(backendMessageSchema.safeParse({ type: 'pi:error', conversationId: 'c1', message: 'failed' }).success).toBe(true)
    expect(backendMessageSchema.safeParse({ type: 'pi:error', conversationId: 1, message: 'failed' }).success).toBe(false)
  })

  it('correlates manual source-session sync results and failures', () => {
    expect(backendMessageSchema.safeParse({
      type: 'source_sessions:synced',
      requestId: 'sync-1',
      result: { indexed: 2, removed: 0, skipped: 3, failed: 0 },
    }).success).toBe(true)
    expect(backendMessageSchema.safeParse({
      type: 'source_sessions:synced',
      result: { indexed: 1, removed: 0, skipped: 0, failed: 0 },
    }).success).toBe(true)
    expect(backendMessageSchema.safeParse({
      type: 'source_sessions:error',
      requestId: 'sync-1',
      message: '任务运行中，暂时无法刷新历史',
    }).success).toBe(true)
  })

  it('validates required conversation fields at the websocket boundary', () => {
    const valid = {
      id: 'c1',
      title: '会话',
      messages: [],
      turns: [],
      sessionPath: null,
      createdAt: 1,
    }

    expect(parseBackendMessage(JSON.stringify({ type: 'conversations:list', conversations: [valid] }))).toEqual({
      type: 'conversations:list',
      conversations: [valid],
    })
    expect(parseBackendMessage(JSON.stringify({
      type: 'conversations:list',
      conversations: [{ id: 'c1', title: '会话' }],
    }))).toBeNull()
  })

  it('rejects malformed nested conversation messages and segments', () => {
    const conversation = {
      id: 'c1',
      title: '会话',
      messages: [{
        id: 'm1',
        role: 'assistant',
        text: '完成',
        timestamp: 1,
        segments: [{ type: 'text', content: '完成', extra: true }],
      }],
      turns: [{ id: 'm1', messageIds: ['m1'] }],
      sessionPath: null,
      createdAt: 1,
    }

    expect(parseBackendMessage(JSON.stringify({ type: 'conversations:list', conversations: [conversation] }))).toBeNull()
    delete (conversation.messages[0] as { timestamp?: number }).timestamp
    expect(parseBackendMessage(JSON.stringify({ type: 'conversations:list', conversations: [conversation] }))).toBeNull()
  })

  it('does not apply prompt input limits to historical conversation images', () => {
    const images = Array.from({ length: 7 }, () => ({
      type: 'image',
      data: 'abc123',
      mimeType: 'image/png',
    }))
    const conversation = {
      id: 'c1',
      title: '会话',
      messages: [{ id: 'm1', role: 'user', text: '图片', images, timestamp: 1 }],
      turns: [{ id: 'm1', messageIds: ['m1'] }],
      sessionPath: '/tmp/c1.jsonl',
      createdAt: 1,
    }

    expect(parseBackendMessage(JSON.stringify({ type: 'conversations:list', conversations: [conversation] }))).not.toBeNull()
  })

  it('requires both models.json and settings.json in settings snapshots', () => {
    const snapshot = {
      pi: { installed: true, executablePath: '/usr/local/bin/pi' },
      models: { path: '/tmp/models.json', exists: true, content: '{}\n' },
      settings: { path: '/tmp/settings.json', exists: true, content: '{"skills":[]}\n' },
      skills: [],
      install: { phase: 'idle' },
    }

    expect(backendMessageSchema.safeParse({ type: 'settings:snapshot', snapshot }).success).toBe(true)
    expect(backendMessageSchema.safeParse({
      type: 'settings:snapshot',
      snapshot: {
        pi: snapshot.pi,
        models: snapshot.models,
        skills: [],
      },
    }).success).toBe(false)
  })

  it('rejects malformed client message payloads for request-shaped messages', () => {
    expect(parseClientMessage('{"type":"start","requestId":1,"conversationId":"c1"}')).toBeNull()
    expect(parseClientMessage('{"type":"clone_session","requestId":"r1","conversationId":"c1"}')).toBeNull()
    expect(parseClientMessage('{"type":"rpc_command","conversationId":"c1","command":{"type":"bad"}}')).toBeNull()
    expect(parseClientMessage('{"type":"delete_workspace","workspacePath":"/tmp","conversationIds":["c1"]}')).toBeNull()
    expect(parseClientMessage('{"type":"update_workspace_view_state","workspacePath":"","isPinned":true}')).toBeNull()
    expect(parseClientMessage('{"type":"update_workspace_view_state","workspacePath":"/tmp","isPinned":"yes"}')).toBeNull()
    expect(parseClientMessage('{"type":"update_workspace_view_state","workspacePath":"/tmp","isCollapsed":0}')).toBeNull()
  })

  it('keeps workspace deletion scoped to the workspace path only', () => {
    expect(parseClientMessage('{"type":"delete_workspace","requestId":"delete-1","workspacePath":"/tmp/project"}')).toEqual({
      type: 'delete_workspace',
      requestId: 'delete-1',
      workspacePath: '/tmp/project',
    })
  })

  it('accepts request-correlated logical restore messages and confirmations', () => {
    expect(parseClientMessage('{"type":"restore_conversation","requestId":"restore-1","conversationId":"c1","sessionPath":null}')).toEqual({
      type: 'restore_conversation',
      requestId: 'restore-1',
      conversationId: 'c1',
      sessionPath: null,
    })
    expect(parseClientMessage('{"type":"restore_workspace","requestId":"restore-2","workspacePath":"/tmp/project"}')).toEqual({
      type: 'restore_workspace',
      requestId: 'restore-2',
      workspacePath: '/tmp/project',
    })
    expect(backendMessageSchema.safeParse({
      type: 'conversation:restored',
      requestId: 'restore-1',
      conversationId: 'c1',
    }).success).toBe(true)
    expect(backendMessageSchema.safeParse({
      type: 'workspace:restored',
      requestId: 'restore-2',
      workspacePath: '/tmp/project',
    }).success).toBe(true)
  })

  it('accepts combined settings saves', () => {
    expect(parseClientMessage(JSON.stringify({
      type: 'settings:save_all',
      models: '{}',
      settings: '{"skills":[]}',
    }))).toEqual({
      type: 'settings:save_all',
      models: '{}',
      settings: '{"skills":[]}',
    })
  })

  it('accepts workspace view state updates with pinned or collapsed fields', () => {
    expect(parseClientMessage('{"type":"update_workspace_view_state","workspacePath":"/tmp/project","isPinned":true}')).toEqual({
      type: 'update_workspace_view_state',
      workspacePath: '/tmp/project',
      isPinned: true,
    })
    expect(parseClientMessage('{"type":"update_workspace_view_state","workspacePath":"/tmp/project","isCollapsed":false}')).toEqual({
      type: 'update_workspace_view_state',
      workspacePath: '/tmp/project',
      isCollapsed: false,
    })
    expect(parseClientMessage('{"type":"update_workspace_view_state","workspacePath":"/tmp/project"}')).toBeNull()
  })

  it('scopes runtime client messages to a conversation', () => {
    expect(parseClientMessage('{"type":"set_active_conversation","conversationId":"c1"}')).toEqual({
      type: 'set_active_conversation',
      conversationId: 'c1',
    })
    expect(parseClientMessage('{"type":"set_active_conversation","conversationId":null}')).toEqual({
      type: 'set_active_conversation',
      conversationId: null,
    })
    expect(parseClientMessage('{"type":"set_active_conversation"}')).toBeNull()
    expect(parseClientMessage('{"type":"prompt","conversationId":"c1","prompt":"guide","streamingBehavior":"steer"}')).toEqual({
      type: 'prompt',
      conversationId: 'c1',
      prompt: 'guide',
      streamingBehavior: 'steer',
    })
    expect(parseClientMessage('{"type":"prompt","conversationId":"c1","prompt":"look","images":[{"type":"image","data":"abc123","mimeType":"image/png"}]}')).toEqual({
      type: 'prompt',
      conversationId: 'c1',
      prompt: 'look',
      images: [{ type: 'image', data: 'abc123', mimeType: 'image/png' }],
    })
    expect(parseClientMessage('{"type":"prompt","conversationId":"c1","prompt":"look","images":[{"type":"file","data":"abc123","mimeType":"image/png"}]}')).toBeNull()
    expect(parseClientMessage('{"type":"prompt","conversationId":"c1","prompt":"look","images":[{"type":"image","data":"abc123","mimeType":"image/svg+xml"}]}')).toBeNull()
    expect(parseClientMessage(`{"type":"prompt","conversationId":"c1","prompt":"look","images":[{"type":"image","data":"${'a'.repeat(14 * 1024 * 1024)}","mimeType":"image/png"}]}`)).toBeNull()
    expect(parseClientMessage(`{"type":"prompt","conversationId":"c1","prompt":"look","images":${JSON.stringify(Array.from({ length: 7 }, () => ({ type: 'image', data: 'abc123', mimeType: 'image/png' })))}}`)).toBeNull()
    expect(parseClientMessage(`{"type":"prompt","conversationId":"c1","prompt":"look","images":[{"type":"image","data":"${'a'.repeat(Math.ceil((10 * 1024 * 1024) / 3) * 4)}","mimeType":"image/png"}]}`)).not.toBeNull()
    expect(parseClientMessage('{"type":"prompt","prompt":"guide"}')).toBeNull()
    expect(parseClientMessage('{"type":"prompt","conversationId":"c1","prompt":"guide","streamingBehavior":"invalid"}')).toBeNull()
    expect(parseClientMessage('{"type":"abort","conversationId":"c1","id":"a1"}')).toEqual({
      type: 'abort',
      conversationId: 'c1',
      id: 'a1',
    })
    expect(parseClientMessage('{"type":"abort","id":"a1"}')).toBeNull()
  })

  it('creates request ids with stable prefixes', () => {
    expect(createRequestId('start')).toMatch(/^start-\d+-[a-f0-9-]+$/)
  })

  it('matches pi started events by request and conversation', () => {
    expect(
      isPiStartedForRequest(
        { type: 'pi:started', requestId: 'r1', conversationId: 'c1', sessionPath: '/tmp/a' },
        { requestId: 'r1', conversationId: 'c1' },
      ),
    ).toBe(true)

    expect(
      isPiStartedForRequest(
        { type: 'pi:started', requestId: 'r2', conversationId: 'c1', sessionPath: '/tmp/a' },
        { requestId: 'r1', conversationId: 'c1' },
      ),
    ).toBe(false)
  })

})
