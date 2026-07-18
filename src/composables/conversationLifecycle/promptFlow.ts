import {
  addPendingSteer,
  clearConversationRuntimeRequests,
  drainPendingSteers,
  isRunnerBusy,
  isRunnerReady,
  removePendingSteer,
  resetConversationRuntime,
  shouldStartPi,
  type ConversationRuntime,
  type PendingSteer,
} from '@/lib/conversationRuntime'
import { createRequestId, type PromptStreamingBehavior } from '@shared/protocol'
import { DEFAULT_CONVERSATION_TITLE, MAX_PROMPT_IMAGES, type ImageContent } from '@shared/chat'
import type { UseConversationLifecycleOptions } from './types'

export function createPromptFlowActions(options: UseConversationLifecycleOptions) {
  let promptSeq = 0

  function startPi(conversationId: string): boolean {
    const conversation = options.conversationById(conversationId)
    if (!conversation) return false
    const runtime = options.runtimeFor(conversationId)
    if (!shouldStartPi(options.runnerSnapshotFor(conversationId))) return true
    if (conversation.kind === 'workspace' && !conversation.workspacePath) {
      options.pushMessage(conversationId, 'error', '工作区路径不可用')
      return false
    }
    const request = {
      requestId: createRequestId('start'),
      conversationId,
    }
    runtime.activeStartRequest = request
    const didSend = options.sendClientMessage({
      type: 'start',
      ...request,
      sessionPath: conversation.sessionPath ?? undefined,
      cwd: conversation.kind === 'session'
        ? options.homePath.value || undefined
        : conversation.workspacePath || options.defaultWorkspacePath.value || undefined,
      mode: conversation.kind === 'session' ? 'session' : 'workspace',
    })
    if (!didSend) {
      runtime.activeStartRequest = null
      options.pushMessage(conversationId, 'error', '后端连接已断开')
      return false
    }
    return true
  }

  function resetRuntimeState(conversationId: string) {
    const runtime = options.runtimeFor(conversationId)
    options.flushNow(conversationId)
    resetConversationRuntime(runtime)
  }

  function sendMessage() {
    const conversationId = options.activeId.value
    if (!conversationId) return
    const runtime = options.runtimeFor(conversationId)
    const text = runtime.draft.trim()
    const images = snapshotImages(runtime.draftImages)
    if (!text && images.length === 0) return

    const snapshot = options.runnerSnapshotFor(conversationId)
    if (isRunnerBusy(snapshot)) {
      addPendingSteer(runtime, text, images)
      runtime.draft = ''
      runtime.draftImages = []
      return
    }

    const requestId = `prompt-${Date.now()}-${++promptSeq}`
    if (shouldStartPi(snapshot)) {
      runtime.pendingStartPrompt = { id: requestId, text, ...(images.length ? { images } : {}) }
      runtime.draft = ''
      runtime.draftImages = []
      if (!startPi(conversationId)) {
        runtime.draft = text
        runtime.draftImages = images
        runtime.pendingStartPrompt = null
      }
      return
    }
    if (runtime.pendingPromptId) {
      options.pushMessage(conversationId, 'error', '已有任务正在运行')
      return
    }
    if (!isRunnerReady(snapshot)) {
      options.pushMessage(conversationId, 'error', 'Pi 正在启动')
      return
    }

    sendStartedPrompt(conversationId, requestId, text, undefined, images)
  }

  function removeSteer(pendingId: string) {
    const conversationId = options.activeId.value
    if (!conversationId) return
    removePendingSteer(options.runtimeFor(conversationId), pendingId)
  }

  function submitPendingSteer(pendingId: string) {
    const conversationId = options.activeId.value
    if (!conversationId) return
    const runtime = options.runtimeFor(conversationId)
    const pending = runtime.pendingSteers.find((item) => item.id === pendingId)
    if (!pending) return

    const snapshot = options.runnerSnapshotFor(conversationId)
    if (!isRunnerReady(snapshot) && !isRunnerBusy(snapshot)) {
      options.pushMessage(conversationId, 'error', 'Pi 尚未就绪')
      return
    }

    const requestId = pending.id
    const streamingBehavior = 'steer'
    const didSend = sendPromptMessage(conversationId, requestId, pending.text, streamingBehavior, pending.images)
    if (!didSend) {
      options.pushMessage(conversationId, 'error', '后端连接已断开')
      return
    }
    if (isRunnerReady(snapshot)) {
      runtime.pendingPromptId = requestId
    }
    options.pushMessage(conversationId, 'user', pending.text, { streamingBehavior }, requestId, pending.images)
    removePendingSteer(runtime, pendingId)
    options.forceScrollToBottom()
  }

  function sendPendingSteersAsFollowUp(conversationId: string, runtime: ConversationRuntime) {
    const pending = drainPendingSteers(runtime)
    if (pending.length === 0) return

    const { batch, remaining } = takePromptImageBatch(pending)
    runtime.pendingSteers = remaining

    const text = batch.map((item) => item.text).filter(Boolean).join('\n\n')
    const images = batch.flatMap((item) => item.images ?? [])
    const requestId = batch.length === 1 ? batch[0].id : createRequestId('follow-up')
    const streamingBehavior = 'followUp'
    const didSend = sendPromptMessage(conversationId, requestId, text, streamingBehavior, images)
    if (!didSend) {
      runtime.pendingSteers = pending
      options.pushMessage(conversationId, 'error', '后端连接已断开')
      return
    }

    runtime.pendingPromptId = requestId
    options.pushMessage(conversationId, 'user', text, { streamingBehavior }, requestId, images)
    options.forceScrollToBottom()
  }

  function cancelPi(targetConversationId = options.activeId.value ?? undefined) {
    const conversationId = targetConversationId
    if (!conversationId) return
    if (!options.sendClientMessage({ type: 'abort', conversationId })) {
      options.pushMessage(conversationId, 'error', '后端连接已断开')
      return
    }

    const runtime = options.runtimeFor(conversationId)
    clearConversationRuntimeRequests(runtime)
    runtime.pendingSteers = []
    options.finalizeAssistantTurn(conversationId, 'error')
  }

  function sendPromptMessage(
    conversationId: string,
    id: string,
    prompt: string,
    streamingBehavior?: PromptStreamingBehavior,
    images?: ImageContent[],
  ): boolean {
    return options.sendClientMessage({
      type: 'prompt',
      conversationId,
      id,
      prompt,
      ...(streamingBehavior ? { streamingBehavior } : {}),
      ...(images?.length ? { images } : {}),
    })
  }

  function sendStartedPrompt(
    conversationId: string,
    id: string,
    prompt: string,
    streamingBehavior?: PromptStreamingBehavior,
    images?: ImageContent[],
  ): boolean {
    const runtime = options.runtimeFor(conversationId)
    const didSend = sendPromptMessage(conversationId, id, prompt, streamingBehavior, images)
    if (!didSend) {
      options.pushMessage(conversationId, 'error', '后端连接已断开')
      return false
    }

    runtime.draft = ''
    runtime.draftImages = []
    runtime.pendingPromptId = id
    options.pushMessage(conversationId, 'user', prompt, streamingBehavior ? { streamingBehavior } : undefined, id, images)
    options.forceScrollToBottom()
    const conv = options.conversationById(conversationId)
    if (conv && conv.title === DEFAULT_CONVERSATION_TITLE) {
      const title = prompt || '[图片]'
      conv.title = title.length > 40 ? title.slice(0, 40) + '…' : title
    }
    return true
  }

  function sendPendingStartPrompt(conversationId: string) {
    const runtime = options.runtimeFor(conversationId)
    const pending = runtime.pendingStartPrompt
    if (!pending) return
    if (sendStartedPrompt(conversationId, pending.id, pending.text, undefined, pending.images)) {
      runtime.pendingStartPrompt = null
      return
    }
    runtime.draft = pending.text
    runtime.draftImages = snapshotImages(pending.images ?? [])
    runtime.pendingStartPrompt = null
  }

  return {
    cancelPi,
    removeSteer,
    resetRuntimeState,
    sendMessage,
    sendPendingStartPrompt,
    sendPendingSteersAsFollowUp,
    startPi,
    submitPendingSteer,
  }
}

function snapshotImages(images: ImageContent[]): ImageContent[] {
  return images.map((image) => ({ ...image }))
}

function takePromptImageBatch(pending: PendingSteer[]): { batch: PendingSteer[]; remaining: PendingSteer[] } {
  const batch: PendingSteer[] = []
  let imageCount = 0

  for (let index = 0; index < pending.length; index += 1) {
    const item = pending[index]
    const nextImageCount = item.images?.length ?? 0
    if (batch.length > 0 && imageCount + nextImageCount > MAX_PROMPT_IMAGES) {
      return { batch, remaining: pending.slice(index) }
    }
    batch.push(item)
    imageCount += nextImageCount
  }

  return { batch, remaining: [] }
}
