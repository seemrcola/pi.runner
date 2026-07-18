import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readParsedSession } from '../../../backend/sessions/sessionJsonlParser.js'

describe('session jsonl parser', () => {
  it('attaches edit tool result text and diff details to the assistant turn', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-session-jsonl-'))
    const path = join(dir, 'session.jsonl')
    const lines = [
      {
        type: 'message',
        id: 'assistant-1',
        timestamp: '2026-07-02T08:46:22.195Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'call-1',
              name: 'edit',
              arguments: { path: '/tmp/a.ts' },
            },
          ],
        },
      },
      {
        type: 'message',
        id: 'tool-1',
        timestamp: '2026-07-02T08:46:22.204Z',
        message: {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'edit',
          content: [{ type: 'text', text: 'Successfully replaced 1 block(s) in /tmp/a.ts.' }],
          details: {
            diff: '- old\n+ new',
          },
          isError: false,
        },
      },
    ]
    writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)

    const parsed = readParsedSession(path, statSync(path).mtimeMs, statSync(path).size)

    expect(parsed.messages[0].tools?.[0]).toMatchObject({
      toolName: 'edit',
      toolCallId: 'call-1',
      status: 'done',
      result: 'Successfully replaced 1 block(s) in /tmp/a.ts.',
      diff: '- old\n+ new',
    })
  })

  it('preserves user images that are already present in pi jsonl history', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-session-jsonl-'))
    const path = join(dir, 'session.jsonl')
    const lines = [
      {
        type: 'message',
        id: 'user-with-image',
        timestamp: '2026-07-02T08:46:22.195Z',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '看这张图' },
            { type: 'image', data: 'abc123', mimeType: 'image/png' },
          ],
        },
      },
      {
        type: 'message',
        id: 'image-only-user',
        timestamp: '2026-07-02T08:47:22.195Z',
        message: {
          role: 'user',
          content: [
            { type: 'image', data: 'def456', mimeType: 'image/jpeg' },
          ],
        },
      },
    ]
    writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)

    const parsed = readParsedSession(path, statSync(path).mtimeMs, statSync(path).size)

    expect(parsed.messages).toMatchObject([
      {
        id: 'user-with-image',
        text: '看这张图',
        images: [{ type: 'image', data: 'abc123', mimeType: 'image/png' }],
      },
      {
        id: 'image-only-user',
        text: '',
        images: [{ type: 'image', data: 'def456', mimeType: 'image/jpeg' }],
      },
    ])
  })

  it('keeps image content scoped to user messages', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-session-jsonl-'))
    const path = join(dir, 'session.jsonl')
    const lines = [
      {
        type: 'message',
        id: 'assistant-image-only',
        timestamp: '2026-07-02T08:46:22.195Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'image', data: 'abc123', mimeType: 'image/png' },
          ],
        },
      },
    ]
    writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)

    const parsed = readParsedSession(path, statSync(path).mtimeMs, statSync(path).size)

    expect(parsed.messages).toEqual([])
  })
})
