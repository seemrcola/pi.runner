import type { Ref } from 'vue'
import type { BackendMessage, PiRunnerSnapshot } from '@shared/protocol'

export type RunnerEventsOptions = {
  runnerSnapshots: Ref<Map<string, PiRunnerSnapshot>>
}

export function handleRunnerStateMessage(
  options: RunnerEventsOptions,
  message: BackendMessage,
): boolean {
  switch (message.type) {
    case 'runner:list':
      options.runnerSnapshots.value = new Map(
        message.runners.map((snapshot) => [snapshot.conversationId, snapshot]),
      )
      return true

    case 'runner:snapshot':
      options.runnerSnapshots.value = new Map(options.runnerSnapshots.value).set(
        message.snapshot.conversationId,
        message.snapshot,
      )
      return true

    default:
      return false
  }
}
