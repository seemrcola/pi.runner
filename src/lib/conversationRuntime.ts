import type { ImageContent } from '@shared/chat'
import type { PiRunnerSnapshot } from '@shared/protocol'

export type ConversationRuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error'

export type PendingSteer = {
  id: string
  text: string
  images?: ImageContent[]
}

export type PendingStartPrompt = {
  id: string
  text: string
  images?: ImageContent[]
}

export type ActiveAssistantTurn = {
  agentTurnId: string
  messageId: string
  textBuffer: string
  thinkingActive: boolean
  toolStartedAt: Map<string, number>
  startedAt: number
}

export type ConversationRuntime = {
  draft: string
  draftImages: ImageContent[]
  activeTurn: ActiveAssistantTurn | null
  pendingPromptId: string | null
  pendingStartPrompt: PendingStartPrompt | null
  activeStartRequest: { requestId: string; conversationId: string } | null
  rafId: number | null
  pendingSteers: PendingSteer[]
}

export function createConversationRuntime(): ConversationRuntime {
  return {
    draft: '',
    draftImages: [],
    activeTurn: null,
    pendingPromptId: null,
    pendingStartPrompt: null,
    activeStartRequest: null,
    rafId: null,
    pendingSteers: [],
  }
}

export function shouldStartPi(snapshot: PiRunnerSnapshot | undefined): boolean {
  return !snapshot || snapshot.phase === 'error' || snapshot.phase === 'exited'
}

export function isRunnerBusy(snapshot: PiRunnerSnapshot | undefined): boolean {
  return snapshot?.phase === 'running'
    || snapshot?.phase === 'stopping'
    || snapshot?.phase === 'terminating'
}

export function isRunnerReady(snapshot: PiRunnerSnapshot | undefined): boolean {
  return snapshot?.phase === 'idle'
}

export function isRunnerStarting(snapshot: PiRunnerSnapshot | undefined): boolean {
  return snapshot?.phase === 'starting'
}

export function runnerError(snapshot: PiRunnerSnapshot | undefined): string {
  return snapshot?.phase === 'error' ? snapshot.error ?? 'Pi runtime error' : ''
}

export function clearConversationRuntimeRequests(runtime: ConversationRuntime): void {
  runtime.activeStartRequest = null
  runtime.pendingPromptId = null
  runtime.pendingStartPrompt = null
}

export function resetConversationRuntime(runtime: ConversationRuntime): void {
  runtime.activeTurn = null
  clearConversationRuntimeRequests(runtime)
  runtime.pendingSteers = []
  runtime.draftImages = []
}

export function addPendingSteer(runtime: ConversationRuntime, text: string, images?: ImageContent[]): PendingSteer {
  const pending: PendingSteer = {
    id: `steer-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text,
    ...(images?.length ? { images } : {}),
  }
  runtime.pendingSteers.push(pending)
  return pending
}

export function drainPendingSteers(runtime: ConversationRuntime): PendingSteer[] {
  const pending = runtime.pendingSteers
  runtime.pendingSteers = []
  return pending
}

export function removePendingSteer(runtime: ConversationRuntime, id: string): void {
  runtime.pendingSteers = runtime.pendingSteers.filter((item) => item.id !== id)
}

export function displayStatusForSnapshot(snapshot: PiRunnerSnapshot | undefined): ConversationRuntimeStatus {
  switch (snapshot?.phase) {
    case 'starting':
      return 'starting'
    case 'running':
      return 'running'
    case 'stopping':
    case 'terminating':
      return 'stopping'
    case 'error':
    case 'termination_failed':
      return 'error'
    case 'new':
    case 'idle':
    case 'exited':
    case undefined:
      return 'idle'
  }
}
