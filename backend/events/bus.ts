import type { BackendMessage } from '../../shared/protocol.js'

export type BackendEvent = BackendMessage
export type BackendEventSubscriber = (payload: BackendEvent, emit: (payload: BackendEvent) => void) => void
export type BackendEventErrorHandler = (error: Error) => void

export function createBackendEventBus(
  subscribers: BackendEventSubscriber[],
  onSubscriberError: BackendEventErrorHandler = (error) => console.error('Backend event subscriber failed', error),
) {
  function emit(payload: BackendEvent): void {
    for (const subscriber of subscribers) {
      try {
        subscriber(payload, emit)
      } catch (error) {
        // Transport 和投影副作用彼此独立，一个出口失败不能阻断其他 subscriber。
        onSubscriberError(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  return { emit }
}
