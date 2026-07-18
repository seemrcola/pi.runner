import type { Ref } from 'vue'
import type { ChatMessageMeta, Conversation, ImageContent, MessageRole } from '@shared/chat'
import type { ClientMessage, PiRunnerSnapshot } from '@shared/protocol'
import type { ConversationRuntime } from '@/lib/conversationRuntime'

export type FocusTarget = {
  focus(): void
}

export type UseConversationLifecycleOptions = {
  conversations: Ref<Conversation[]>
  activeId: Ref<string | null>
  expandedWorkspaces: Ref<Set<string>>
  runtimes: Ref<Map<string, ConversationRuntime>>
  showAddDialog: Ref<boolean>
  defaultWorkspacePath: Ref<string>
  homePath: Ref<string>
  isConnected: Ref<boolean>
  inputRef: Ref<FocusTarget | null>
  runtimeFor(conversationId: string): ConversationRuntime
  runnerSnapshotFor(conversationId: string): PiRunnerSnapshot | undefined
  conversationById(conversationId: string): Conversation | null
  flushNow(conversationId: string): void
  finalizeAssistantTurn(conversationId: string, status?: 'done' | 'error'): void
  pushMessage(
    conversationId: string,
    role: MessageRole,
    text: string,
    meta?: ChatMessageMeta,
    id?: string,
    images?: ImageContent[],
  ): void
  forceScrollToBottom(): void
  notify?: {
    success(message: string, options?: {
      duration?: number
      action?: { label: string; onClick(): void }
    }): void
    error(message: string): void
  }
  sendClientMessage(message: ClientMessage): boolean
}

export type OptimisticDelete = {
  kind: 'conversation' | 'workspace'
  conversations: Conversation[]
  activeId: string | null
  activeIdAfterDelete?: string | null
  runtimes: Map<string, ConversationRuntime>
  removedConversations: Conversation[]
  conversationId?: string
  sessionPath?: string | null
  workspacePath?: string
}
