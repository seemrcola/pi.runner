import { z } from 'zod'

export const DEFAULT_CONVERSATION_TITLE = '新会话'
export const IMAGE_CONTENT_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export const MAX_PROMPT_IMAGES = 6
export const MAX_PROMPT_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_PROMPT_IMAGE_BASE64_CHARS = Math.ceil(MAX_PROMPT_IMAGE_BYTES / 3) * 4

const messageRoleSchema = z.enum(['user', 'assistant', 'system', 'error'])
const imageMimeTypeSchema = z.enum(IMAGE_CONTENT_MIME_TYPES)

export const imageContentSchema = z.object({
  type: z.literal('image'),
  data: z.string().min(1).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  mimeType: imageMimeTypeSchema,
}).strict()

export const toolMetaSchema = z.object({
  toolName: z.string(),
  toolCallId: z.string(),
  status: z.enum(['running', 'done', 'error']),
  args: z.unknown().optional(),
  result: z.unknown().optional(),
  output: z.string().optional(),
  diff: z.string().optional(),
  durationMs: z.number().optional(),
}).strict()

const userMetaSchema = z.object({
  streamingBehavior: z.enum(['steer', 'followUp']).optional(),
}).strict()

export const chatMessageSegmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thinking'), content: z.string() }).strict(),
  z.object({ type: z.literal('text'), content: z.string() }).strict(),
  z.object({
    type: z.literal('tool'),
    toolCallId: z.string(),
    tool: toolMetaSchema,
  }).strict(),
])

export const chatMessageSchema = z.object({
  id: z.string(),
  role: messageRoleSchema,
  text: z.string(),
  images: z.array(imageContentSchema).optional(),
  thinking: z.string().optional(),
  thinkingActive: z.boolean().optional(),
  tools: z.array(toolMetaSchema).optional(),
  segments: z.array(chatMessageSegmentSchema).optional(),
  status: z.enum(['streaming', 'done', 'error']).optional(),
  timestamp: z.number(),
  meta: z.union([toolMetaSchema, userMetaSchema]).optional(),
}).strict()

export const agentTurnSchema = z.object({
  id: z.string(),
  messageIds: z.array(z.string()),
}).strict()

export const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  messages: z.array(chatMessageSchema),
  turns: z.array(agentTurnSchema),
  sessionPath: z.string().nullable(),
  workspacePath: z.string().optional(),
  workspaceDirName: z.string().optional(),
  kind: z.enum(['session', 'workspace']).optional(),
  source: z.literal('pi').optional(),
  sourcePath: z.string().optional(),
  createdAt: z.number(),
}).strict()

export type MessageRole = z.infer<typeof messageRoleSchema>
export type ToolMeta = z.infer<typeof toolMetaSchema>
export type ChatMessageSegment = z.infer<typeof chatMessageSegmentSchema>
export type AgentTurn = z.infer<typeof agentTurnSchema>
export type UserMeta = z.infer<typeof userMetaSchema>
export type ChatMessageMeta = ToolMeta | UserMeta
export type ImageContentMimeType = z.infer<typeof imageMimeTypeSchema>
export type ImageContent = z.infer<typeof imageContentSchema>
export type ChatMessage = z.infer<typeof chatMessageSchema>
export type Conversation = z.infer<typeof conversationSchema>

export function isImageContentMimeType(value: string): value is ImageContentMimeType {
  return IMAGE_CONTENT_MIME_TYPES.includes(value as ImageContentMimeType)
}
