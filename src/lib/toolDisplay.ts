import type { ToolMeta } from '@shared/chat'

export function shouldDefaultExpandTool(tool: ToolMeta): boolean {
  const name = normalizedToolName(tool)
  if (name === 'edit') return Boolean(tool.diff)
  if (name === 'write') return true
  return false
}

export function extractWriteContent(tool: ToolMeta): string | null {
  if (normalizedToolName(tool) !== 'write') return null
  const args = recordArgs(tool)
  const content = args?.content
  return typeof content === 'string' ? content : null
}

export function detailArgsForTool(tool: ToolMeta): unknown {
  const args = recordArgs(tool)
  if (!args) return tool.args
  if (normalizedToolName(tool) !== 'write' || typeof args.content !== 'string') return tool.args

  const { content: _content, ...rest } = args
  return Object.keys(rest).length > 0 ? rest : undefined
}

function normalizedToolName(tool: ToolMeta): string {
  return tool.toolName.trim().toLowerCase()
}

function recordArgs(tool: ToolMeta): Record<string, unknown> | null {
  if (!tool.args || typeof tool.args !== 'object' || Array.isArray(tool.args)) return null
  return tool.args as Record<string, unknown>
}
