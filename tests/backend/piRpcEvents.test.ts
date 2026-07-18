import { describe, expect, it } from 'vitest'
import { parsePiRpcLine, serializeRpcCommand } from '../../backend/pi/rpcEvents.js'

describe('parsePiRpcLine', () => {
  it('extracts assistant text deltas from PI message_update events', () => {
    expect(
      parsePiRpcLine(
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
        }),
      ),
    ).toEqual({ type: 'pi:text_delta', delta: 'hello' })
  })

  it('extracts thinking deltas', () => {
    expect(
      parsePiRpcLine(
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' },
        }),
      ),
    ).toEqual({ type: 'pi:thinking_delta', delta: 'hmm' })
  })

  it('extracts thinking_end', () => {
    expect(
      parsePiRpcLine(
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_end', content: 'final thought' },
        }),
      ),
    ).toEqual({ type: 'pi:thinking_end', content: 'final thought' })
  })

  it('parses tool execution lifecycle', () => {
    expect(
      parsePiRpcLine(
        JSON.stringify({
          type: 'tool_execution_start',
          toolName: 'edit',
          toolCallId: 'tc-1',
          args: { path: 'a.ts' },
        }),
      ),
    ).toEqual({
      type: 'pi:tool_start',
      toolName: 'edit',
      toolCallId: 'tc-1',
      args: { path: 'a.ts' },
    })

    expect(
      parsePiRpcLine(
        JSON.stringify({ type: 'tool_execution_end', toolCallId: 'tc-1', isError: false }),
      ),
    ).toEqual({
      type: 'pi:tool_end',
      toolCallId: 'tc-1',
      isError: false,
    })
  })

  it('preserves edit tool diff details from execution end events', () => {
    expect(
      parsePiRpcLine(
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 'tc-1',
          result: 'Successfully replaced 1 block(s) in a.ts.',
          details: {
            diff: '- old\n+ new',
          },
          isError: false,
        }),
      ),
    ).toEqual({
      type: 'pi:tool_end',
      toolCallId: 'tc-1',
      result: 'Successfully replaced 1 block(s) in a.ts.',
      diff: '- old\n+ new',
      isError: false,
    })
  })

  it('extracts tool result text from nested message content on execution end events', () => {
    expect(
      parsePiRpcLine(
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 'tc-1',
          message: {
            content: [{ type: 'text', text: 'command output' }],
          },
          isError: false,
        }),
      ),
    ).toEqual({
      type: 'pi:tool_end',
      toolCallId: 'tc-1',
      result: 'command output',
      isError: false,
    })
  })

  it('parses response events with success and error', () => {
    expect(
      parsePiRpcLine(JSON.stringify({ type: 'response', id: 'p-1', success: true })),
    ).toEqual({ type: 'pi:response', id: 'p-1', success: true })

    expect(
      parsePiRpcLine(
        JSON.stringify({ type: 'response', id: 'p-2', success: false, error: 'busy' }),
      ),
    ).toEqual({ type: 'pi:response', id: 'p-2', success: false, error: 'busy' })
  })

  it('preserves response data for RPC request callers', () => {
    expect(
      parsePiRpcLine(
        JSON.stringify({
          type: 'response',
          id: 'state-1',
          success: true,
          data: { sessionFile: '/tmp/current.jsonl', sessionName: 'Current session' },
        }),
      ),
    ).toEqual({
      type: 'pi:response',
      id: 'state-1',
      success: true,
      data: { sessionFile: '/tmp/current.jsonl', sessionName: 'Current session' },
    })
  })

  it('extracts agent_end errors from top-level fields', () => {
    expect(
      parsePiRpcLine(
        JSON.stringify({ type: 'agent_end', errorMessage: 'rate limited' }),
      ),
    ).toEqual({ type: 'pi:agent_end', error: 'rate limited' })

    expect(
      parsePiRpcLine(JSON.stringify({ type: 'agent_end', error: 'crashed' })),
    ).toEqual({ type: 'pi:agent_end', error: 'crashed' })
  })

  it('extracts agent_end errors from messages array', () => {
    expect(
      parsePiRpcLine(
        JSON.stringify({
          type: 'agent_end',
          messages: [{ stopReason: 'error', errorMessage: 'api error' }],
        }),
      ),
    ).toEqual({ type: 'pi:agent_end', error: 'api error' })
  })

  it('preserves a top-level agent_end error when Pi omits error details', () => {
    expect(
      parsePiRpcLine(JSON.stringify({ type: 'agent_end', stopReason: 'error' })),
    ).toEqual({ type: 'pi:agent_end', error: 'Agent returned unknown error' })
  })

  it('preserves willRetry flag on agent_end', () => {
    expect(
      parsePiRpcLine(
        JSON.stringify({ type: 'agent_end', errorMessage: '5xx', willRetry: true }),
      ),
    ).toEqual({ type: 'pi:agent_end', error: '5xx', willRetry: true })
  })

  it('maps completion events', () => {
    expect(parsePiRpcLine(JSON.stringify({ type: 'agent_start' }))).toEqual({
      type: 'pi:agent_start',
    })
    expect(parsePiRpcLine(JSON.stringify({ type: 'turn_end' }))).toEqual({
      type: 'pi:turn_end',
    })
    expect(parsePiRpcLine(JSON.stringify({ type: 'message_end' }))).toEqual({
      type: 'pi:message_end',
    })
    expect(parsePiRpcLine(JSON.stringify({ type: 'agent_end' }))).toEqual({
      type: 'pi:agent_end',
    })
  })

  it('ignores non-renderable events', () => {
    expect(
      parsePiRpcLine(
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'message_start' },
        }),
      ),
    ).toBeNull()
  })

  it('returns null for empty lines', () => {
    expect(parsePiRpcLine('')).toBeNull()
    expect(parsePiRpcLine('   ')).toBeNull()
  })

  it('maps extension_error to pi:error', () => {
    expect(
      parsePiRpcLine(JSON.stringify({ type: 'extension_error', error: 'ext fail' })),
    ).toEqual({ type: 'pi:error', message: 'ext fail' })
  })
})

describe('serializeRpcCommand', () => {
  it('serializes commands as JSONL records', () => {
    expect(serializeRpcCommand({ id: '1', type: 'prompt', message: 'hello' })).toBe(
      '{"id":"1","type":"prompt","message":"hello"}\n',
    )
  })
})
