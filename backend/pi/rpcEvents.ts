// Pi RPC JSONL 协议解析层。
// pi --mode rpc 通过 stdin/stdout 交换 JSONL：每条命令以 \n 结尾，
// stdout 上来的事件可能是 response（对应某次请求）或流式事件（message_update/tool_*/agent_end 等）。
// 这里把原始 JSON 归一化为 BackendEvent，供 server 转发给渲染进程。

export type PiRpcEvent =
  | { type: 'pi:text_delta'; delta: string }
  | { type: 'pi:thinking_delta'; delta: string }
  | { type: 'pi:thinking_end'; content: string }
  | { type: 'pi:tool_start'; toolName: string; toolCallId: string; args?: unknown }
  | { type: 'pi:tool_update'; toolCallId: string; output?: string }
  | {
      type: 'pi:tool_end'
      toolCallId: string
      result?: unknown
      diff?: string
      isError: boolean
    }
  | { type: 'pi:message_end' }
  | { type: 'pi:agent_start' }
  | { type: 'pi:agent_end'; error?: string; willRetry?: boolean }
  | { type: 'pi:response'; id: string; success: boolean; error?: string; data?: unknown }
  | { type: 'pi:status'; message: string }
  | { type: 'pi:stderr'; data: string }
  | { type: 'pi:error'; message: string }
  | { type: 'pi:turn_end' }

type UnknownRecord = Record<string, unknown>

export function parsePiRpcLine(line: string): PiRpcEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const payload = JSON.parse(trimmed) as UnknownRecord

  // response：对某次请求（prompt/abort/bash 等）的同步结果。
  // success:false 表示前置错误（如不支持图片、忙碌队列参数缺失），必须显式暴露给 UI。
  if (payload.type === 'response') {
    return {
      type: 'pi:response',
      id: String(payload.id ?? ''),
      success: payload.success !== false,
      ...(payload.error != null ? { error: String(payload.error) } : {}),
      ...(payload.data != null ? { data: payload.data } : {}),
    }
  }

  // 流式 assistant 消息更新：text_delta/thinking_delta/thinking_end 是高频事件。
  if (payload.type === 'message_update') {
    const evt = payload.assistantMessageEvent as UnknownRecord | undefined
    const eventType = evt?.type

    if (eventType === 'text_delta') {
      return { type: 'pi:text_delta', delta: String(evt?.delta ?? '') }
    }
    if (eventType === 'thinking_delta') {
      return { type: 'pi:thinking_delta', delta: String(evt?.delta ?? '') }
    }
    if (eventType === 'thinking_end') {
      return { type: 'pi:thinking_end', content: String(evt?.content ?? '') }
    }
    // message_start/text_start/text_end 等生命周期事件暂不单独暴露，
    // 渲染层靠 text_delta 自然创建 assistant 消息、靠 message_end 收尾即可。
    return null
  }

  // message_end：本轮 assistant 回答的最终状态，渲染层据此 flush 并结束当前流式消息。
  if (payload.type === 'message_end') {
    return { type: 'pi:message_end' }
  }

  // 工具调用生命周期：start/update/end 用 toolCallId 串成同一条 UI 记录。
  if (payload.type === 'tool_execution_start') {
    return {
      type: 'pi:tool_start',
      toolName: String(payload.toolName ?? 'tool'),
      toolCallId: String(payload.toolCallId ?? ''),
      ...(payload.args != null ? { args: payload.args } : {}),
    }
  }
  if (payload.type === 'tool_execution_update') {
    const output = payload.output ?? payload.partialResult
    return {
      type: 'pi:tool_update',
      toolCallId: String(payload.toolCallId ?? ''),
      ...(output != null ? { output: stringifyToolOutput(output) } : {}),
    }
  }
  if (payload.type === 'tool_execution_end') {
    const details = extractToolDetails(payload)
    const result = extractToolResult(payload)
    return {
      type: 'pi:tool_end',
      toolCallId: String(payload.toolCallId ?? ''),
      ...(result != null ? { result } : {}),
      ...details,
      isError: payload.isError === true,
    }
  }

  if (payload.type === 'agent_start') {
    return { type: 'pi:agent_start' }
  }

  // agent_end：外层 Agent 执行结束。错误信息可能藏在多个位置，需要逐级查找。
  if (payload.type === 'agent_end') {
    const error = extractAgentEndError(payload)
    return {
      type: 'pi:agent_end',
      ...(error != null ? { error } : {}),
      ...(payload.willRetry === true ? { willRetry: true } : {}),
    }
  }

  if (payload.type === 'turn_end') {
    return { type: 'pi:turn_end' }
  }

  if (payload.type === 'extension_ui_request') {
    return {
      type: 'pi:status',
      message: `Extension UI request: ${String(payload.method ?? 'unknown')}`,
    }
  }

  if (payload.type === 'extension_error') {
    return { type: 'pi:error', message: String(payload.error ?? 'Extension error') }
  }

  // 其他不渲染的事件忽略。
  return null
}

/**
 * agent_end 的错误信息在 pi 不同版本/错误类型下存放位置不同：
 *   1. 顶层 errorMessage
 *   2. 顶层 error
 *   3. messages 数组中 stopReason=error 的消息的 errorMessage
 *   4. 顶层 stopReason=error 但无显式 messages
 * 返回 undefined 表示本轮无错误。
 */
function extractAgentEndError(payload: UnknownRecord): string | undefined {
  if (typeof payload.errorMessage === 'string' && payload.errorMessage) {
    return payload.errorMessage
  }
  if (typeof payload.error === 'string' && payload.error) {
    return payload.error
  }
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const errorMessages = messages.filter(
    (m: unknown): m is UnknownRecord =>
      Boolean(m && typeof m === 'object' && (m as UnknownRecord).stopReason === 'error'),
  )
  const topMsg = errorMessages[errorMessages.length - 1]
  if (topMsg && typeof topMsg.errorMessage === 'string' && topMsg.errorMessage) {
    return topMsg.errorMessage
  }
  if (payload.stopReason === 'error') {
    return 'Agent returned unknown error'
  }
  return undefined
}

/** 工具输出可能是对象/字符串，统一成可展示文本。 */
function stringifyToolOutput(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function extractToolResult(payload: UnknownRecord): unknown {
  if (payload.result != null) return payload.result
  if (payload.output != null) return stringifyToolOutput(payload.output)
  if (payload.partialResult != null) return stringifyToolOutput(payload.partialResult)
  if (isRecord(payload.message)) return extractContentText(payload.message.content)
  return undefined
}

function extractContentText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const text = content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!isRecord(part)) return ''
      return typeof part.text === 'string' ? part.text : ''
    })
    .filter(Boolean)
    .join('\n\n')
  return text || undefined
}

function extractToolDetails(payload: UnknownRecord): Pick<Extract<PiRpcEvent, { type: 'pi:tool_end' }>, 'diff'> {
  const details = findDetailsRecord(payload)
  if (!details) return {}
  return {
    ...(typeof details.diff === 'string' ? { diff: details.diff } : {}),
  }
}

function findDetailsRecord(payload: UnknownRecord): UnknownRecord | null {
  if (isRecord(payload.details)) return payload.details
  if (isRecord(payload.result) && isRecord(payload.result.details)) return payload.result.details
  if (isRecord(payload.message) && isRecord(payload.message.details)) return payload.message.details
  return null
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function serializeRpcCommand(command: Record<string, unknown>): string {
  return `${JSON.stringify(command)}\n`
}
