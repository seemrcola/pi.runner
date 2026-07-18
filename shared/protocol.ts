import {
  conversationSchema,
  imageContentSchema,
  MAX_PROMPT_IMAGE_BASE64_CHARS,
  MAX_PROMPT_IMAGES,
} from './chat.js'
import { z } from 'zod'

export type PromptStreamingBehavior = 'steer' | 'followUp'
const promptStreamingBehaviorSchema = z.enum(['steer', 'followUp'])
export type PiRunnerPhase =
  | 'new'
  | 'starting'
  | 'idle'
  | 'running'
  | 'stopping'
  | 'terminating'
  | 'termination_failed'
  | 'exited'
  | 'error'
const piRunnerPhaseSchema = z.enum([
  'new',
  'starting',
  'idle',
  'running',
  'stopping',
  'terminating',
  'termination_failed',
  'exited',
  'error',
])
export type PiRunnerSnapshot = {
  conversationId: string
  phase: PiRunnerPhase
  sessionPath?: string
  cwd?: string
  createdAt: number
  startedAt?: number
  lastActiveAt: number
  error?: string
  diagnostics?: unknown
}

export type WorkspaceViewState = {
  workspacePath: string
  isPinned: boolean
  isCollapsed: boolean
  pinnedAt: number | null
  updatedAt: number
}

export type PiSkillInfo = {
  name: string
  path: string
  description?: string
  source: 'pi' | 'agent' | 'user' | 'configured'
}

export type PiSettingsConfigFile = {
  path: string
  exists: boolean
  content: string
}

export type PiSettingsSnapshot = {
  pi: {
    installed: boolean
    executablePath?: string
  }
  models: PiSettingsConfigFile
  settings: PiSettingsConfigFile
  skills: PiSkillInfo[]
  install?: {
    phase: 'idle' | 'running' | 'succeeded' | 'failed'
    output?: string
    error?: string
  }
}

const emptyMessageSchema = <T extends string>(type: T) => z.object({ type: z.literal(type) }).strict()
const promptImageContentSchema = imageContentSchema.extend({
  data: z.string().min(1).max(MAX_PROMPT_IMAGE_BASE64_CHARS).regex(/^[A-Za-z0-9+/]+={0,2}$/),
})
const piRunnerSnapshotSchema = z.object({
  conversationId: z.string(),
  phase: piRunnerPhaseSchema,
  sessionPath: z.string().optional(),
  cwd: z.string().optional(),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  lastActiveAt: z.number(),
  error: z.string().optional(),
  diagnostics: z.unknown().optional(),
}).strict()
const workspaceViewStateSchema = z.object({
  workspacePath: z.string(),
  isPinned: z.boolean(),
  isCollapsed: z.boolean(),
  pinnedAt: z.number().nullable(),
  updatedAt: z.number(),
}).strict()
const piSkillInfoSchema = z.object({
  name: z.string(),
  path: z.string(),
  description: z.string().optional(),
  source: z.enum(['pi', 'agent', 'user', 'configured']),
}).strict()
const piSettingsSnapshotSchema = z.object({
  pi: z.object({
    installed: z.boolean(),
    executablePath: z.string().optional(),
  }).strict(),
  models: z.object({
    path: z.string(),
    exists: z.boolean(),
    content: z.string(),
  }).strict(),
  settings: z.object({
    path: z.string(),
    exists: z.boolean(),
    content: z.string(),
  }).strict(),
  skills: z.array(piSkillInfoSchema),
  install: z.object({
    phase: z.enum(['idle', 'running', 'succeeded', 'failed']),
    output: z.string().optional(),
    error: z.string().optional(),
  }).strict().optional(),
}).strict()
const workspaceViewStateUpdateSchema = z.object({
  type: z.literal('update_workspace_view_state'),
  workspacePath: z.string().trim().min(1),
  isPinned: z.boolean().optional(),
  isCollapsed: z.boolean().optional(),
}).strict().refine(
  (message) => message.isPinned !== undefined || message.isCollapsed !== undefined,
  { message: 'workspace view state update requires at least one field' },
)

export const clientMessageSchema = z.discriminatedUnion('type', [
  emptyMessageSchema('ping'),
  emptyMessageSchema('list_conversations'),
  emptyMessageSchema('list_runners'),
  z.object({
    type: z.literal('set_active_conversation'),
    conversationId: z.string().trim().min(1).nullable(),
  }).strict(),
  emptyMessageSchema('list_workspace_view_states'),
  emptyMessageSchema('settings:get'),
  emptyMessageSchema('settings:install_pi'),
  z.object({
    type: z.literal('sync_source_sessions'),
    requestId: z.string().trim().min(1),
  }).strict(),
  workspaceViewStateUpdateSchema,
  z.object({
    type: z.literal('settings:save_models'),
    content: z.string(),
  }).strict(),
  z.object({
    type: z.literal('settings:save_settings'),
    content: z.string(),
  }).strict(),
  z.object({
    type: z.literal('settings:save_all'),
    models: z.string(),
    settings: z.string(),
  }).strict(),
  z.object({
    type: z.literal('delete_conversation'),
    requestId: z.string().optional(),
    conversationId: z.string().nullable().optional(),
    sessionPath: z.string().nullable().optional(),
  }).strict(),
  z.object({
    type: z.literal('delete_workspace'),
    requestId: z.string().optional(),
    workspacePath: z.string().nullable().optional(),
  }).strict(),
  z.object({
    type: z.literal('restore_conversation'),
    requestId: z.string().trim().min(1),
    conversationId: z.string().trim().min(1),
    sessionPath: z.string().nullable().optional(),
  }).strict(),
  z.object({
    type: z.literal('restore_workspace'),
    requestId: z.string().trim().min(1),
    workspacePath: z.string().trim().min(1),
  }).strict(),
  z.object({
    type: z.literal('start'),
    requestId: z.string(),
    conversationId: z.string(),
    sessionPath: z.string().nullable().optional(),
    cwd: z.string().optional(),
    mode: z.enum(['session', 'workspace']).nullable().optional(),
    extraArgs: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal('prompt'),
    conversationId: z.string(),
    id: z.string().optional(),
    prompt: z.string().optional(),
    images: z.array(promptImageContentSchema).max(MAX_PROMPT_IMAGES).optional(),
    streamingBehavior: promptStreamingBehaviorSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal('abort'),
    conversationId: z.string(),
    id: z.string().optional(),
  }).strict(),
])

export type ClientMessage = z.infer<typeof clientMessageSchema>

export const backendMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('backend:ready'), port: z.number() }).strict(),
  emptyMessageSchema('backend:pong'),
  z.object({ type: z.literal('conversations:list'), conversations: z.array(conversationSchema) }).strict(),
  z.object({ type: z.literal('settings:snapshot'), snapshot: piSettingsSnapshotSchema }).strict(),
  z.object({ type: z.literal('settings:error'), message: z.string() }).strict(),
  z.object({ type: z.literal('runner:list'), runners: z.array(piRunnerSnapshotSchema) }).strict(),
  z.object({ type: z.literal('runner:snapshot'), snapshot: piRunnerSnapshotSchema }).strict(),
  z.object({ type: z.literal('workspace_view_states:list'), states: z.array(workspaceViewStateSchema) }).strict(),
  z.object({ type: z.literal('workspace_view_state:updated'), state: workspaceViewStateSchema }).strict(),
  z.object({
    type: z.literal('source_sessions:synced'),
    requestId: z.string().optional(),
    result: z.object({
      indexed: z.number(),
      removed: z.number(),
      skipped: z.number(),
      failed: z.number(),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal('source_sessions:error'),
    requestId: z.string(),
    message: z.string(),
  }).strict(),
  z.object({
    type: z.literal('conversation:deleted'),
    requestId: z.string().optional(),
    sessionPath: z.string(),
  }).strict(),
  z.object({
    type: z.literal('workspace:deleted'),
    requestId: z.string().optional(),
    workspacePath: z.string(),
    deletedCount: z.number(),
  }).strict(),
  z.object({
    type: z.literal('conversation:restored'),
    requestId: z.string(),
    conversationId: z.string(),
  }).strict(),
  z.object({
    type: z.literal('workspace:restored'),
    requestId: z.string(),
    workspacePath: z.string(),
  }).strict(),
  z.object({
    type: z.literal('pi:started'),
    requestId: z.string(),
    conversationId: z.string(),
    sessionPath: z.string(),
    sessionName: z.string().optional(),
  }).strict(),
  z.object({ type: z.literal('pi:text_delta'), conversationId: z.string(), delta: z.string() }).strict(),
  z.object({ type: z.literal('pi:thinking_delta'), conversationId: z.string(), delta: z.string() }).strict(),
  z.object({ type: z.literal('pi:thinking_end'), conversationId: z.string(), content: z.string() }).strict(),
  z.object({
    type: z.literal('pi:tool_start'),
    conversationId: z.string(),
    toolName: z.string(),
    toolCallId: z.string(),
    args: z.unknown().optional(),
  }).strict(),
  z.object({
    type: z.literal('pi:tool_update'),
    conversationId: z.string(),
    toolCallId: z.string(),
    output: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal('pi:tool_end'),
    conversationId: z.string(),
    toolCallId: z.string(),
    result: z.unknown().optional(),
    diff: z.string().optional(),
    isError: z.boolean(),
  }).strict(),
  z.object({ type: z.literal('pi:message_end'), conversationId: z.string() }).strict(),
  z.object({ type: z.literal('pi:agent_start'), conversationId: z.string() }).strict(),
  z.object({
    type: z.literal('pi:agent_end'),
    conversationId: z.string(),
    error: z.string().optional(),
    willRetry: z.boolean().optional(),
  }).strict(),
  z.object({
    type: z.literal('pi:response'),
    conversationId: z.string(),
    id: z.string(),
    success: z.boolean(),
    error: z.string().optional(),
    data: z.unknown().optional(),
  }).strict(),
  z.object({ type: z.literal('pi:status'), conversationId: z.string().optional(), message: z.string() }).strict(),
  z.object({ type: z.literal('pi:stderr'), conversationId: z.string(), data: z.string() }).strict(),
  z.object({
    type: z.literal('pi:error'),
    requestId: z.string().optional(),
    conversationId: z.string().optional(),
    message: z.string(),
  }).strict(),
  z.object({ type: z.literal('pi:turn_end'), conversationId: z.string() }).strict(),
])

export type BackendMessage = z.infer<typeof backendMessageSchema>

export type StartRequestRef = {
  requestId: string
  conversationId: string
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const result = clientMessageSchema.safeParse(parsed)
  return result.success ? result.data : null
}

export function parseBackendMessage(raw: string): BackendMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const result = backendMessageSchema.safeParse(parsed)
  return result.success ? result.data : null
}

export function createRequestId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)
  return `${prefix}-${Date.now()}-${uuid}`
}

export function isPiStartedForRequest(
  message: Extract<BackendMessage, { type: 'pi:started' }>,
  request: StartRequestRef | null,
): boolean {
  return Boolean(
    request &&
      message.requestId === request.requestId &&
      message.conversationId === request.conversationId,
  )
}
