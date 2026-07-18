import { nextTick } from 'vue'
import { mergeConversationHistory } from '@/lib/conversations'
import { ensureWorkspaceExpanded } from '@/lib/sidebarGroups'
import { createRequestId } from '@shared/protocol'
import { normalizeWorkspacePath } from '@shared/workspacePaths'
import { DEFAULT_CONVERSATION_TITLE, type Conversation } from '@shared/chat'
import type { UseConversationLifecycleOptions } from './types'

export function createConversationCreationActions(options: UseConversationLifecycleOptions) {
  function createConversation(kind: 'session' | 'workspace', workspacePath?: string) {
    const normalizedWorkspacePath = workspacePath ? normalizeWorkspacePath(workspacePath) : undefined
    const conv: Conversation = {
      id: createRequestId('conversation'),
      title: DEFAULT_CONVERSATION_TITLE,
      messages: [],
      turns: [],
      sessionPath: null,
      kind,
      ...(normalizedWorkspacePath ? { workspacePath: normalizedWorkspacePath } : {}),
      createdAt: Date.now(),
    }
    options.conversations.value.unshift(conv)
    options.activeId.value = conv.id
    options.runtimeFor(conv.id)
    revealWorkspace(normalizedWorkspacePath)
    nextTick(() => options.inputRef.value?.focus())
  }

  async function chooseWorkspaceFolder() {
    if (!options.isConnected.value) return
    if (!window.piDesktop) return
    const path = await window.piDesktop.selectWorkspaceFolder()
    if (!path) return
    options.showAddDialog.value = false
    createConversation('workspace', path)
  }

  function startSessionOnly() {
    if (!options.isConnected.value) return
    options.showAddDialog.value = false
    createConversation('session')
  }

  function addWorkspaceConversation(workspacePath: string) {
    if (!options.isConnected.value) return
    createConversation('workspace', normalizeWorkspacePath(workspacePath))
  }

  function requestConversationHistory() {
    options.sendClientMessage({ type: 'list_conversations' })
  }

  function restoreConversations(history: Conversation[]) {
    const previousActiveId = options.activeId.value
    options.conversations.value = mergeConversationHistory(options.conversations.value, history)
    for (const conversation of options.conversations.value) options.runtimeFor(conversation.id)
    options.activeId.value = previousActiveId && options.conversations.value.some((item) => item.id === previousActiveId)
      ? previousActiveId
      : options.conversations.value[0]?.id ?? null
    const activeConversation = options.activeId.value ? options.conversationById(options.activeId.value) : null
    revealWorkspace(activeConversation?.workspacePath)
    nextTick(() => {
      options.forceScrollToBottom()
      options.inputRef.value?.focus()
    })
  }

  function switchConversation(id: string) {
    if (id === options.activeId.value) return
    const conversation = options.conversations.value.find((item) => item.id === id)
    if (options.activeId.value) options.flushNow(options.activeId.value)
    options.activeId.value = id
    if (conversation) revealWorkspace(conversation.workspacePath)
    options.forceScrollToBottom()
  }

  function revealWorkspace(workspacePath?: string) {
    const normalizedWorkspacePath = workspacePath ? normalizeWorkspacePath(workspacePath) : ''
    if (!normalizedWorkspacePath) return
    options.expandedWorkspaces.value = ensureWorkspaceExpanded(options.expandedWorkspaces.value, normalizedWorkspacePath)
  }

  return {
    addWorkspaceConversation,
    chooseWorkspaceFolder,
    createConversation,
    requestConversationHistory,
    restoreConversations,
    startSessionOnly,
    switchConversation,
  }
}
