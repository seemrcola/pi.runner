import type { ChatMessage, Conversation, MessageRole } from '@shared/chat'

const exportableRoleLabels: Partial<Record<MessageRole, string>> = {
  user: '用户',
  assistant: '助手',
  system: '系统',
}

export function buildConversationExport(conversation: Conversation): string {
  const sections = conversation.messages
    .filter(isExportableMessage)
    .map((message) => {
      const label = exportableRoleLabels[message.role]
      return `## ${label}\n\n${message.text.trimEnd()}`
    })

  const title = normalizeMarkdownTitle(conversation.title) || 'Conversation'
  return [`# ${title}`, ...sections].join('\n\n') + '\n'
}

export function getConversationExportFilename(conversation: Conversation): string {
  const date = new Date(conversation.createdAt).toISOString().slice(0, 10)
  const title = slugify(conversation.title) || conversation.id
  return `pi-conversation-${date}-${title}.md`
}

export function removeConversationById(
  conversations: Conversation[],
  id: string,
  activeId: string | null,
): { conversations: Conversation[]; activeId: string | null } {
  const index = conversations.findIndex((conversation) => conversation.id === id)
  if (index === -1) return { conversations, activeId }

  const nextConversations = conversations.filter((conversation) => conversation.id !== id)
  if (activeId !== id) return { conversations: nextConversations, activeId }

  return {
    conversations: nextConversations,
    activeId: nextConversations[index]?.id ?? nextConversations[index - 1]?.id ?? null,
  }
}

export function mergeConversationHistory(
  currentConversations: Conversation[],
  history: Conversation[],
): Conversation[] {
  const historyIds = new Set(history.map((conversation) => conversation.id))
  const localOnly = currentConversations.filter(
    (conversation) => !conversation.sessionPath && !historyIds.has(conversation.id),
  )

  return [...localOnly, ...history.map((conversation) => preserveLocalConversationId(conversation, currentConversations))]
}

function preserveLocalConversationId(conversation: Conversation, currentConversations: Conversation[]): Conversation {
  const current = findCurrentConversation(conversation, currentConversations)
  if (!current) return conversation

  return {
    ...conversation,
    // 运行中会话的 runner snapshot、draft 和 pending prompt 都按本地 id 绑定；
    // 历史索引刷新只能替换内容，不能把同一 sessionPath 分裂成另一个可发送会话。
    id: current.id,
  }
}

function findCurrentConversation(conversation: Conversation, currentConversations: Conversation[]): Conversation | undefined {
  const byId = currentConversations.find((item) => item.id === conversation.id)
  if (byId) return byId
  if (!conversation.sessionPath) return undefined
  return currentConversations.find((item) => item.sessionPath === conversation.sessionPath)
}

function isExportableMessage(message: ChatMessage): boolean {
  // 导出面向用户阅读，只保留正常对话文本；thinking、工具调用和错误属于运行细节。
  return Boolean(exportableRoleLabels[message.role] && message.text.trim())
}

function normalizeMarkdownTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
