import { createConversationCreationActions } from './conversationLifecycle/creation'
import { createPromptFlowActions } from './conversationLifecycle/promptFlow'
import { createVisibilityActions } from './conversationLifecycle/visibilityActions'
import type { UseConversationLifecycleOptions } from './conversationLifecycle/types'

export type { UseConversationLifecycleOptions } from './conversationLifecycle/types'

export function useConversationLifecycle(options: UseConversationLifecycleOptions) {
  const creationActions = createConversationCreationActions(options)
  const promptFlowActions = createPromptFlowActions(options)
  const visibilityActions = createVisibilityActions(options)

  return {
    ...creationActions,
    ...promptFlowActions,
    ...visibilityActions,
  }
}
