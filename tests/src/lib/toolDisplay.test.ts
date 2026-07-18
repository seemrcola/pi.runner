import { describe, expect, it } from 'vitest'
import type { ToolMeta } from '@shared/chat'
import {
  detailArgsForTool,
  extractWriteContent,
  shouldDefaultExpandTool,
} from '../../../src/lib/toolDisplay'

function tool(patch: Partial<ToolMeta>): ToolMeta {
  return {
    toolName: 'bash',
    toolCallId: 'tool-1',
    status: 'done',
    ...patch,
  }
}

describe('tool display helpers', () => {
  it('defaults edit tools with diff open', () => {
    expect(shouldDefaultExpandTool(tool({ toolName: 'edit', diff: '- old\n+ new' }))).toBe(true)
    expect(shouldDefaultExpandTool(tool({ toolName: 'edit' }))).toBe(false)
  })

  it('defaults write tools open and extracts Pi write content', () => {
    const writeTool = tool({
      toolName: 'write',
      args: {
        path: '/tmp/random-utils.js',
        content: 'console.log("hello")\n',
      },
    })

    expect(shouldDefaultExpandTool(writeTool)).toBe(true)
    expect(extractWriteContent(writeTool)).toBe('console.log("hello")\n')
  })

  it('shows write path args without duplicating the content body', () => {
    expect(detailArgsForTool(tool({
      toolName: 'write',
      args: {
        path: '/tmp/random-utils.js',
        content: 'console.log("hello")\n',
      },
    }))).toEqual({ path: '/tmp/random-utils.js' })
  })

  it('keeps ordinary tools collapsed by default', () => {
    expect(shouldDefaultExpandTool(tool({
      toolName: 'bash',
      output: 'hello',
    }))).toBe(false)
  })
})
