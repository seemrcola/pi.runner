import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { handleRunnerStateMessage } from '../../src/composables/backendEvents/runnerEvents'
import type { PiRunnerSnapshot } from '../../shared/protocol'

function snapshot(conversationId: string, phase: PiRunnerSnapshot['phase']): PiRunnerSnapshot {
  return {
    conversationId,
    phase,
    createdAt: 1,
    lastActiveAt: 1,
  }
}

describe('backend runner events', () => {
  it('replaces runner snapshots from list messages', () => {
    const runnerSnapshots = ref(new Map<string, PiRunnerSnapshot>([
      ['old', snapshot('old', 'running')],
    ]))

    const handled = handleRunnerStateMessage(
      { runnerSnapshots },
      {
        type: 'runner:list',
        runners: [snapshot('a', 'idle'), snapshot('b', 'running')],
      },
    )

    expect(handled).toBe(true)
    expect([...runnerSnapshots.value.keys()]).toEqual(['a', 'b'])
  })

  it('merges single runner snapshot updates', () => {
    const runnerSnapshots = ref(new Map<string, PiRunnerSnapshot>([
      ['a', snapshot('a', 'idle')],
    ]))

    const handled = handleRunnerStateMessage(
      { runnerSnapshots },
      {
        type: 'runner:snapshot',
        snapshot: snapshot('a', 'running'),
      },
    )

    expect(handled).toBe(true)
    expect(runnerSnapshots.value.get('a')).toMatchObject({ phase: 'running' })
  })
})
