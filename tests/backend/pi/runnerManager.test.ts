import { afterEach, describe, expect, it, vi } from 'vitest'
import { PiRunnerManager } from '../../../backend/pi/runnerManager.js'

type FakeRunner = {
  isRunning: ReturnType<typeof vi.fn>
  hasProcessHandle: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  writePrompt: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  terminate: ReturnType<typeof vi.fn>
  getState: ReturnType<typeof vi.fn>
  getDiagnostics: ReturnType<typeof vi.fn>
}

type Lifecycle = {
  onExit(): void
  onTerminationFailed(error: Error): void
}

afterEach(() => {
  vi.useRealTimers()
})

function createFakeRunner(_broadcast?: (payload: Record<string, unknown>) => void, lifecycle?: Lifecycle) {
  return {
    isRunning: vi.fn(() => false),
    hasProcessHandle: vi.fn(() => false),
    start: vi.fn(async () => {}),
    writePrompt: vi.fn(async () => ({ id: 'prompt', success: true })),
    abort: vi.fn(async () => ({ id: 'abort', success: true })),
    terminate: vi.fn(async () => ({ outcome: 'graceful', forcedPids: [] })),
    getState: vi.fn(),
    getDiagnostics: vi.fn(),
    emitExit: () => lifecycle?.onExit(),
  }
}

describe('PiRunnerManager', () => {
  it('closes a background idle runner after ten minutes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'))
    const runner = { ...createFakeRunner(), isRunning: vi.fn(() => true) }
    const manager = new PiRunnerManager(() => {}, () => runner)

    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-a.jsonl',
    })
    manager.setActiveConversation('renderer-a', 'conversation-b')

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

    expect(runner.terminate).toHaveBeenCalledTimes(1)
    expect(manager.snapshot('conversation-a')).toMatchObject({ phase: 'exited' })
    vi.useRealTimers()
  })

  it('ignores runner events that arrive after idle retention closes it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'))
    let runnerBroadcast: ((payload: Record<string, unknown>) => void) | undefined
    const runner = { ...createFakeRunner(), isRunning: vi.fn(() => true) }
    const manager = new PiRunnerManager(
      () => {},
      (broadcast) => {
        runnerBroadcast = broadcast
        return runner
      },
    )

    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-a.jsonl',
    })
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    runnerBroadcast?.({ type: 'pi:agent_start' })

    expect(manager.snapshot('conversation-a')).toMatchObject({ phase: 'exited' })
    expect(runner.terminate).toHaveBeenCalledTimes(1)
  })

  it('keeps an active idle runner for thirty minutes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'))
    const runner = { ...createFakeRunner(), isRunning: vi.fn(() => true) }
    const manager = new PiRunnerManager(() => {}, () => runner)

    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-a.jsonl',
    })
    manager.setActiveConversation('renderer-a', 'conversation-a')

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(runner.terminate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(20 * 60 * 1000)
    expect(runner.terminate).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('does not start the background idle timer until a running agent becomes idle', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'))
    const runnerBroadcasts: Array<(payload: Record<string, unknown>) => void> = []
    const runner = { ...createFakeRunner(), isRunning: vi.fn(() => true) }
    const manager = new PiRunnerManager(
      () => {},
      (broadcast) => {
        runnerBroadcasts.push(broadcast)
        return runner
      },
    )

    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-a.jsonl',
    })
    await manager.prompt('conversation-a', 'prompt-1', 'work')
    manager.setActiveConversation('renderer-a', 'conversation-b')

    await vi.advanceTimersByTimeAsync(20 * 60 * 1000)
    expect(runner.terminate).not.toHaveBeenCalled()

    runnerBroadcasts[0]({ type: 'pi:agent_end' })
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(runner.terminate).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('evicts the oldest idle runner before starting when three idle runners are retained', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'))
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        const runner = createFakeRunner(broadcast, lifecycle)
        created.push(runner)
        return runner
      },
    )

    for (const id of ['a', 'b', 'c']) {
      await manager.start(id, { cwd: '/tmp/project', sessionPath: `/tmp/${id}.jsonl` })
      await vi.advanceTimersByTimeAsync(1)
    }

    await manager.start('d', { cwd: '/tmp/project', sessionPath: '/tmp/d.jsonl' })

    expect(created[0].terminate).toHaveBeenCalledTimes(1)
    expect(created[1].terminate).not.toHaveBeenCalled()
    expect(created[2].terminate).not.toHaveBeenCalled()
    expect(manager.snapshot('a')).toMatchObject({ phase: 'exited' })
    vi.useRealTimers()
  })

  it('keeps a runner active until every viewing client disconnects', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'))
    const runner = { ...createFakeRunner(), isRunning: vi.fn(() => true) }
    const manager = new PiRunnerManager(() => {}, () => runner)

    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-a.jsonl',
    })
    manager.setActiveConversation('renderer-a', 'conversation-a')
    manager.setActiveConversation('renderer-b', 'conversation-a')
    manager.setActiveConversation('renderer-a', null)

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(runner.terminate).not.toHaveBeenCalled()

    manager.setActiveConversation('renderer-b', null)
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(runner.terminate).toHaveBeenCalledTimes(1)
  })

  it('keeps one runner instance per conversation', async () => {
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        const runner = createFakeRunner(broadcast, lifecycle)
        created.push(runner)
        return runner
      },
    )

    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-a.jsonl',
    })
    created[0].emitExit()
    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-a-replacement.jsonl',
    })
    await manager.start('conversation-b', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-b.jsonl',
    })

    expect(created).toHaveLength(2)
    expect(created[0].start).toHaveBeenCalledTimes(2)
    expect(created[1].start).toHaveBeenCalledTimes(1)
  })

  it('wraps runner broadcasts with the conversation id', async () => {
    const broadcasts: Record<string, unknown>[] = []
    const runnerBroadcasts: Array<(payload: Record<string, unknown>) => void> = []
    const manager = new PiRunnerManager(
      (payload) => broadcasts.push(payload),
      (broadcast) => {
        runnerBroadcasts.push(broadcast)
        return createFakeRunner()
      },
    )

    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })
    runnerBroadcasts[0]({ type: 'pi:text_delta', delta: 'hello' })

    expect(broadcasts).toContainEqual(
      { type: 'pi:text_delta', delta: 'hello', conversationId: 'conversation-a' },
    )
  })

  it('broadcasts runner snapshots when process-table state changes', async () => {
    const broadcasts: Record<string, unknown>[] = []
    const runnerBroadcasts: Array<(payload: Record<string, unknown>) => void> = []
    const manager = new PiRunnerManager(
      (payload) => broadcasts.push(payload),
      (broadcast) => {
        runnerBroadcasts.push(broadcast)
        return { ...createFakeRunner(), isRunning: vi.fn(() => true) }
      },
    )

    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })
    await manager.prompt('conversation-a', 'prompt-1', 'hello')
    runnerBroadcasts[0]({ type: 'pi:agent_end' })

    expect(broadcasts).toContainEqual({
      type: 'runner:snapshot',
      snapshot: expect.objectContaining({
        conversationId: 'conversation-a',
        phase: 'starting',
        cwd: '/tmp/project',
        sessionPath: '/tmp/pi-session.jsonl',
      }),
    })
    expect(broadcasts).toContainEqual({
      type: 'runner:snapshot',
      snapshot: expect.objectContaining({
        conversationId: 'conversation-a',
        phase: 'running',
      }),
    })
    expect(broadcasts).toContainEqual({
      type: 'runner:snapshot',
      snapshot: expect.objectContaining({
        conversationId: 'conversation-a',
        phase: 'idle',
      }),
    })
  })

  it('shuts down a single conversation runner', async () => {
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        const runner = createFakeRunner(broadcast, lifecycle)
        created.push(runner)
        return runner
      },
    )
    void manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-a.jsonl',
    })
    void manager.start('conversation-b', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-b.jsonl',
    })
    const runnerA = created[0]
    const runnerB = created[1]

    await manager.shutdownConversation('conversation-a')

    expect(runnerA.terminate).toHaveBeenCalledTimes(1)
    expect(runnerB.terminate).not.toHaveBeenCalled()
    expect(manager.snapshot('conversation-a')).toBeUndefined()
  })

  it('ignores a late exit callback from a replaced runner record', async () => {
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        const runner = createFakeRunner(broadcast, lifecycle)
        created.push(runner)
        return runner
      },
    )

    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-old.jsonl',
    })
    await manager.shutdownConversation('conversation-a')
    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-new.jsonl',
    })

    created[0].emitExit()

    expect(manager.snapshot('conversation-a')).toMatchObject({
      phase: 'idle',
      sessionPath: '/tmp/session-new.jsonl',
    })
  })

  it('shuts down all runners', async () => {
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        const runner = createFakeRunner(broadcast, lifecycle)
        created.push(runner)
        return runner
      },
    )
    void manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-a.jsonl',
    })
    void manager.start('conversation-b', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-b.jsonl',
    })
    const runnerA = created[0]
    const runnerB = created[1]

    await manager.shutdownAll()

    expect(runnerA.terminate).toHaveBeenCalledTimes(1)
    expect(runnerB.terminate).toHaveBeenCalledTimes(1)
  })

  it('shuts down every runner owned by a workspace path', async () => {
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        const runner = createFakeRunner(broadcast, lifecycle)
        created.push(runner)
        return runner
      },
    )

    await manager.start('workspace-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/project-a.jsonl',
    })
    await manager.start('workspace-b', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/project-b.jsonl',
    })
    await manager.start('other-workspace', {
      cwd: '/tmp/other',
      sessionPath: '/tmp/other.jsonl',
    })
    const runnerA = created[0]
    const runnerB = created[1]
    const otherRunner = created[2]

    const deletedCount = await manager.shutdownWorkspace('/tmp/project')

    expect(deletedCount).toBe(2)
    expect(runnerA.terminate).toHaveBeenCalledTimes(1)
    expect(runnerB.terminate).toHaveBeenCalledTimes(1)
    expect(otherRunner.terminate).not.toHaveBeenCalled()
    expect(manager.snapshot('workspace-a')).toBeUndefined()
    expect(manager.snapshot('workspace-b')).toBeUndefined()
    expect(manager.snapshot('other-workspace')).toMatchObject({ cwd: '/tmp/other' })
  })

  it('deduplicates concurrent starts for the same conversation', async () => {
    let resolveStart: (() => void) | undefined
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      () => {
        const runner = {
          ...createFakeRunner(),
          start: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                resolveStart = resolve
              }),
          ),
        }
        created.push(runner)
        return runner
      },
    )

    const first = manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })
    const second = manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })

    expect(second).toBe(first)
    expect(created[0].start).toHaveBeenCalledTimes(1)
    resolveStart?.()
    await first
  })

  it('rejects concurrent starts for the same conversation when the start input changes', async () => {
    let resolveStart: (() => void) | undefined
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      () => {
        const runner = {
          ...createFakeRunner(),
          start: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                resolveStart = resolve
              }),
          ),
        }
        created.push(runner)
        return runner
      },
    )

    const first = manager.start('conversation-a', {
      cwd: '/tmp/project-a',
      sessionPath: '/tmp/session-a.jsonl',
      extraArgs: '--one',
    })

    const second = manager.start('conversation-a', {
      cwd: '/tmp/project-b',
      sessionPath: '/tmp/session-b.jsonl',
      extraArgs: '--two',
    })
    const secondExpectation = expect(second).rejects.toThrow(
      'Conversation is already starting with different session input',
    )

    expect(created[0].start).toHaveBeenCalledTimes(1)
    resolveStart?.()
    await first
    await secondExpectation
  })

  it('attaches another conversation to a live session path instead of opening a second runner', async () => {
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const runnerBroadcasts: Array<(payload: Record<string, unknown>) => void> = []
    const broadcasts: Record<string, unknown>[] = []
    const manager = new PiRunnerManager(
      (payload) => broadcasts.push(payload),
      (broadcast, lifecycle) => {
        runnerBroadcasts.push(broadcast)
        const runner = { ...createFakeRunner(broadcast, lifecycle), isRunning: vi.fn(() => true) }
        created.push(runner)
        return runner
      },
    )

    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })
    await manager.start('conversation-b', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })
    await manager.prompt('conversation-b', 'prompt-1', 'hello')
    runnerBroadcasts[0]({ type: 'pi:text_delta', delta: 'attached' })

    expect(created).toHaveLength(1)
    expect(created[0].start).toHaveBeenCalledTimes(1)
    expect(created[0].writePrompt).toHaveBeenCalledWith('prompt-1', 'hello', undefined)
    expect(manager.snapshot('conversation-a')).toBeUndefined()
    expect(manager.snapshot('conversation-b')).toMatchObject({
      conversationId: 'conversation-b',
      sessionPath: '/tmp/pi-session.jsonl',
    })
    expect(broadcasts).toContainEqual({
      type: 'pi:text_delta',
      conversationId: 'conversation-b',
      delta: 'attached',
    })
  })

  it('keeps the active identity when a live session moves to another conversation id', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'))
    const runner = { ...createFakeRunner(), isRunning: vi.fn(() => true) }
    const manager = new PiRunnerManager(() => {}, () => runner)

    await manager.start('temporary-id', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-a.jsonl',
    })
    manager.setActiveConversation('renderer-a', 'temporary-id')

    await manager.start('persisted-id', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-a.jsonl',
    })
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

    expect(runner.terminate).not.toHaveBeenCalled()
    expect(manager.snapshot('persisted-id')).toMatchObject({ phase: 'idle' })
  })

  it('rejects attaching a live session over another conversation runner', async () => {
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        const runner = { ...createFakeRunner(broadcast, lifecycle), isRunning: vi.fn(() => true) }
        created.push(runner)
        return runner
      },
    )

    await manager.start('conversation-a', { cwd: '/tmp/project', sessionPath: '/tmp/session-a.jsonl' })
    await manager.start('conversation-b', { cwd: '/tmp/project', sessionPath: '/tmp/session-b.jsonl' })

    await expect(
      manager.start('conversation-b', { cwd: '/tmp/project', sessionPath: '/tmp/session-a.jsonl' }),
    ).rejects.toThrow('Conversation already owns another runner')
    expect(created[0].terminate).not.toHaveBeenCalled()
    expect(created[1].terminate).not.toHaveBeenCalled()
    expect(manager.snapshot('conversation-b')).toMatchObject({ sessionPath: '/tmp/session-b.jsonl' })
  })

  it('replaces an exited target record when a live session migrates back to its id', async () => {
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        const runner = { ...createFakeRunner(broadcast, lifecycle), isRunning: vi.fn(() => true) }
        created.push(runner)
        return runner
      },
    )

    await manager.start('persisted-id', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/old-session.jsonl',
    })
    created[0].emitExit()
    await manager.start('temporary-id', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/current-session.jsonl',
    })

    await expect(
      manager.start('persisted-id', {
        cwd: '/tmp/project',
        sessionPath: '/tmp/current-session.jsonl',
      }),
    ).resolves.toBeUndefined()
    expect(manager.snapshot('temporary-id')).toBeUndefined()
    expect(manager.snapshot('persisted-id')).toMatchObject({
      phase: 'idle',
      sessionPath: '/tmp/current-session.jsonl',
    })
  })

  it('releases the migrated session lease when a pending start fails', async () => {
    let rejectStart: ((error: Error) => void) | undefined
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        const isInitialRunner = created.length === 0
        const runner = {
          ...createFakeRunner(broadcast, lifecycle),
          start: vi.fn(() => isInitialRunner
            ? new Promise<void>((_resolve, reject) => { rejectStart = reject })
            : Promise.resolve()),
        }
        created.push(runner)
        return runner
      },
    )

    const initialStart = manager.start('temporary-id', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-a.jsonl',
    })
    const attachedStart = manager.start('persisted-id', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/session-a.jsonl',
    })
    rejectStart?.(new Error('start failed'))

    await expect(initialStart).rejects.toThrow('start failed')
    await expect(attachedStart).rejects.toThrow('start failed')
    await expect(
      manager.start('retry-id', { cwd: '/tmp/project', sessionPath: '/tmp/session-a.jsonl' }),
    ).resolves.toBeUndefined()
    expect(created).toHaveLength(2)
  })

  it('releases the session lease when the runner exits', async () => {
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        const runner = createFakeRunner(broadcast, lifecycle)
        created.push(runner)
        return runner
      },
    )

    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })
    created[0].emitExit()

    await expect(
      manager.start('conversation-b', {
        cwd: '/tmp/project',
        sessionPath: '/tmp/pi-session.jsonl',
      }),
    ).resolves.toBeUndefined()
  })

  it('releases the previous session lease when a conversation starts a replacement session', async () => {
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        const runner = createFakeRunner(broadcast, lifecycle)
        created.push(runner)
        return runner
      },
    )

    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/old-session.jsonl',
    })
    created[0].emitExit()
    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/new-session.jsonl',
    })

    await expect(
      manager.start('conversation-b', {
        cwd: '/tmp/project',
        sessionPath: '/tmp/old-session.jsonl',
      }),
    ).resolves.toBeUndefined()
  })

  it('exposes process-table snapshots for managed runners', async () => {
    const manager = new PiRunnerManager(() => {}, createFakeRunner)

    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })

    expect(manager.snapshot('conversation-a')).toMatchObject({
      conversationId: 'conversation-a',
      phase: 'idle',
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })
    expect(manager.list()).toHaveLength(1)
  })

  it('exposes runner state through the manager API', async () => {
    const manager = new PiRunnerManager(
      () => {},
      () => ({
        ...createFakeRunner(),
        getState: vi.fn(async () => ({
          sessionPath: '/tmp/pi-session.jsonl',
          sessionName: 'Project Session',
        })),
      }),
    )

    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })

    await expect(manager.getState('conversation-a')).resolves.toEqual({
      sessionPath: '/tmp/pi-session.jsonl',
      sessionName: 'Project Session',
    })
  })

  it('routes prompt and abort through manager syscalls while tracking phase', async () => {
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        const runner = {
          ...createFakeRunner(broadcast, lifecycle),
          isRunning: vi.fn(() => true),
        }
        created.push(runner)
        return runner
      },
    )
    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })
    const runner = created[0]

    await manager.prompt('conversation-a', 'prompt-1', 'hello', 'steer')

    expect(runner.writePrompt).toHaveBeenCalledWith('prompt-1', 'hello', 'steer')
    expect(manager.snapshot('conversation-a')).toMatchObject({ phase: 'running' })

    await manager.abort('conversation-a', 'abort-1')

    expect(runner.abort).toHaveBeenCalledWith('abort-1')
    expect(manager.snapshot('conversation-a')).toMatchObject({ phase: 'stopping' })
  })

  it('rejects abort for missing, idle, and exited runners without creating a stopping record', async () => {
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        const runner = {
          ...createFakeRunner(broadcast, lifecycle),
          isRunning: vi.fn(() => true),
        }
        created.push(runner)
        return runner
      },
    )

    await expect(manager.abort('missing', 'abort-missing')).rejects.toThrow('Pi runner is not running')
    expect(manager.snapshot('missing')).toBeUndefined()
    expect(created).toHaveLength(0)

    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })
    await expect(manager.abort('conversation-a', 'abort-idle')).rejects.toThrow('Pi runner is not running')
    expect(manager.snapshot('conversation-a')).toMatchObject({ phase: 'idle' })

    created[0].emitExit()
    await expect(manager.abort('conversation-a', 'abort-exited')).rejects.toThrow('Pi runner is not running')
    expect(created[0].abort).not.toHaveBeenCalled()
    expect(manager.snapshot('conversation-a')).toMatchObject({ phase: 'exited' })
  })

  it('keeps a running snapshot when the abort syscall fails', async () => {
    const runner = {
      ...createFakeRunner(),
      isRunning: vi.fn(() => true),
      abort: vi.fn(() => {
        throw new Error('stdin closed')
      }),
    }
    const manager = new PiRunnerManager(() => {}, () => runner)
    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })
    await manager.prompt('conversation-a', 'prompt-1', 'hello')

    await expect(manager.abort('conversation-a', 'abort-1')).rejects.toThrow('stdin closed')
    expect(manager.snapshot('conversation-a')).toMatchObject({ phase: 'running' })
  })

  it('defaults busy prompts to steer when the renderer omits streaming behavior', async () => {
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        const runner = {
          ...createFakeRunner(broadcast, lifecycle),
          isRunning: vi.fn(() => true),
        }
        created.push(runner)
        return runner
      },
    )
    await manager.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })
    const runner = created[0]

    await manager.prompt('conversation-a', 'prompt-1', 'first')
    await manager.prompt('conversation-a', 'prompt-2', 'while busy')

    expect(runner.writePrompt).toHaveBeenNthCalledWith(1, 'prompt-1', 'first', undefined)
    expect(runner.writePrompt).toHaveBeenNthCalledWith(2, 'prompt-2', 'while busy', 'steer')
  })

  it('keeps a runner busy across inner turn_end events', async () => {
    const runnerBroadcasts: Array<(payload: Record<string, unknown>) => void> = []
    const observed = new PiRunnerManager(
      () => {},
      (broadcast) => {
        runnerBroadcasts.push(broadcast)
        return { ...createFakeRunner(), isRunning: vi.fn(() => true) }
      },
    )
    await observed.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })
    await observed.prompt('conversation-a', 'prompt-1', 'hello')
    runnerBroadcasts[0]({ type: 'pi:turn_end' })

    expect(observed.snapshot('conversation-a')).toMatchObject({ phase: 'running' })
  })

  it('moves a runner back to idle when the outer agent loop ends', async () => {
    const runnerBroadcasts: Array<(payload: Record<string, unknown>) => void> = []
    const observed = new PiRunnerManager(
      () => {},
      (broadcast) => {
        runnerBroadcasts.push(broadcast)
        return { ...createFakeRunner(), isRunning: vi.fn(() => true) }
      },
    )
    await observed.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })
    await observed.prompt('conversation-a', 'prompt-1', 'hello')

    runnerBroadcasts[0]({ type: 'pi:agent_end' })

    expect(observed.snapshot('conversation-a')).toMatchObject({ phase: 'idle' })
  })

  it('uses the outer agent lifecycle to decide whether prompts should steer', async () => {
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const runnerBroadcasts: Array<(payload: Record<string, unknown>) => void> = []
    const observed = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        runnerBroadcasts.push(broadcast)
        const runner = { ...createFakeRunner(broadcast, lifecycle), isRunning: vi.fn(() => true) }
        created.push(runner)
        return runner
      },
    )
    await observed.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })
    const runner = created[0]

    runnerBroadcasts[0]({ type: 'pi:agent_start' })
    runnerBroadcasts[0]({ type: 'pi:turn_end' })
    await observed.prompt('conversation-a', 'prompt-1', 'guide while agent is still running')

    expect(runner.writePrompt).toHaveBeenCalledWith(
      'prompt-1',
      'guide while agent is still running',
      'steer',
    )

    runnerBroadcasts[0]({ type: 'pi:agent_end' })
    await observed.prompt('conversation-a', 'prompt-2', 'new normal prompt')

    expect(runner.writePrompt).toHaveBeenCalledWith('prompt-2', 'new normal prompt', undefined)
  })

  it('does not capture or broadcast git turn summaries around prompts', async () => {
    const broadcasts: Record<string, unknown>[] = []
    const runnerBroadcasts: Array<(payload: Record<string, unknown>) => void> = []
    const observed = new PiRunnerManager(
      (payload) => broadcasts.push(payload),
      (broadcast) => {
        runnerBroadcasts.push(broadcast)
        return { ...createFakeRunner(), isRunning: vi.fn(() => true) }
      },
    )
    await observed.start('conversation-a', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/pi-session.jsonl',
    })

    await observed.prompt('conversation-a', 'prompt-1', 'hello')
    runnerBroadcasts[0]({ type: 'pi:agent_end' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(broadcasts).not.toContainEqual(expect.objectContaining({ type: 'turn:change_summary' }))
  })

  it('does not release or migrate a session until process termination finishes', async () => {
    let finishTermination: (() => void) | undefined
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        const runner = {
          ...createFakeRunner(broadcast, lifecycle),
          isRunning: vi.fn(() => true),
          terminate: vi.fn(() => new Promise<{ outcome: 'graceful'; forcedPids: number[] }>((resolve) => {
            finishTermination = () => resolve({ outcome: 'graceful', forcedPids: [] })
          })),
        }
        created.push(runner)
        return runner
      },
    )
    await manager.start('conversation-a', { cwd: '/tmp/project', sessionPath: '/tmp/shared.jsonl' })

    const shutdown = manager.shutdownConversation('conversation-a')
    const duplicateShutdown = manager.shutdownConversation('conversation-a')
    expect(manager.snapshot('conversation-a')).toMatchObject({ phase: 'terminating' })
    expect(created[0].terminate).toHaveBeenCalledOnce()
    await expect(
      manager.start('conversation-b', { cwd: '/tmp/project', sessionPath: '/tmp/shared.jsonl' }),
    ).rejects.toThrow('ownership is not safely released')

    finishTermination?.()
    await Promise.all([shutdown, duplicateShutdown])
    await expect(
      manager.start('conversation-b', { cwd: '/tmp/project', sessionPath: '/tmp/shared.jsonl' }),
    ).resolves.toBeUndefined()
    expect(created).toHaveLength(2)
  })

  it('does not restart during the child exit-to-close drain window', async () => {
    let running = true
    let hasHandle = true
    const runner = {
      ...createFakeRunner(),
      isRunning: vi.fn(() => running),
      hasProcessHandle: vi.fn(() => hasHandle),
    }
    const manager = new PiRunnerManager(() => {}, (_broadcast, lifecycle) => {
      runner.emitExit = () => lifecycle.onExit()
      return runner
    })
    await manager.start('conversation-a', { cwd: '/tmp/project', sessionPath: '/tmp/session.jsonl' })
    running = false

    await expect(
      manager.start('conversation-a', { cwd: '/tmp/project', sessionPath: '/tmp/session.jsonl' }),
    ).rejects.toThrow('has not reached a terminal state')

    hasHandle = false
    runner.emitExit()
    await expect(
      manager.start('conversation-a', { cwd: '/tmp/project', sessionPath: '/tmp/session.jsonl' }),
    ).resolves.toBeUndefined()
  })

  it('keeps a failed termination record and blocks the session', async () => {
    const runner = {
      ...createFakeRunner(),
      isRunning: vi.fn(() => true),
      terminate: vi.fn(async () => { throw new Error('process survived SIGKILL') }),
    }
    const manager = new PiRunnerManager(() => {}, () => runner)
    await manager.start('conversation-a', { cwd: '/tmp/project', sessionPath: '/tmp/shared.jsonl' })

    await expect(manager.shutdownConversation('conversation-a')).rejects.toThrow('survived SIGKILL')
    expect(manager.snapshot('conversation-a')).toMatchObject({
      phase: 'termination_failed',
      error: 'process survived SIGKILL',
    })
    await expect(
      manager.start('conversation-b', { cwd: '/tmp/project', sessionPath: '/tmp/shared.jsonl' }),
    ).rejects.toThrow('ownership is not safely released')
  })

  it('does not commit running or stopping before Pi accepts the RPC command', async () => {
    const runner = {
      ...createFakeRunner(),
      isRunning: vi.fn(() => true),
      writePrompt: vi.fn(async () => ({ id: 'prompt-1', success: false, error: 'prompt rejected' })),
      abort: vi.fn(async () => ({ id: 'abort-1', success: false, error: 'abort rejected' })),
    }
    const manager = new PiRunnerManager(() => {}, () => runner)
    await manager.start('conversation-a', { cwd: '/tmp/project', sessionPath: '/tmp/session.jsonl' })

    await expect(manager.prompt('conversation-a', 'prompt-1', 'hello')).rejects.toThrow('prompt rejected')
    expect(manager.snapshot('conversation-a')).toMatchObject({ phase: 'idle', error: 'prompt rejected' })

    runner.writePrompt.mockResolvedValueOnce({ id: 'prompt-2', success: true })
    await manager.prompt('conversation-a', 'prompt-2', 'hello again')
    await expect(manager.abort('conversation-a', 'abort-1')).rejects.toThrow('abort rejected')
    expect(manager.snapshot('conversation-a')).toMatchObject({ phase: 'running' })
  })

  it('does not let a pending prompt rejection overwrite a child close terminal state', async () => {
    let rejectPrompt: ((error: Error) => void) | undefined
    let lifecycle: Lifecycle | undefined
    const runner = {
      ...createFakeRunner(),
      isRunning: vi.fn(() => true),
      hasProcessHandle: vi.fn(() => true),
      writePrompt: vi.fn(() => new Promise((_, reject) => { rejectPrompt = reject })),
    }
    const manager = new PiRunnerManager(() => {}, (_broadcast, nextLifecycle) => {
      lifecycle = nextLifecycle
      return runner
    })
    await manager.start('conversation-a', { cwd: '/tmp/project', sessionPath: '/tmp/session.jsonl' })

    const prompt = manager.prompt('conversation-a', 'prompt-1', 'hello')
    runner.isRunning.mockReturnValue(false)
    runner.hasProcessHandle.mockReturnValue(false)
    lifecycle?.onExit()
    rejectPrompt?.(new Error('process closed'))

    await expect(prompt).rejects.toThrow('process closed')
    expect(manager.snapshot('conversation-a')).toMatchObject({ phase: 'exited' })
  })

  it('preserves agent_end when it arrives before the prompt acknowledgement', async () => {
    let acceptPrompt: (() => void) | undefined
    let runnerBroadcast: ((payload: Record<string, unknown>) => void) | undefined
    const runner = {
      ...createFakeRunner(),
      isRunning: vi.fn(() => true),
      writePrompt: vi.fn(() => new Promise<{ id: string; success: boolean }>((resolve) => {
        acceptPrompt = () => resolve({ id: 'prompt-1', success: true })
      })),
    }
    const manager = new PiRunnerManager(() => {}, (broadcast) => {
      runnerBroadcast = broadcast
      return runner
    })
    await manager.start('conversation-a', { cwd: '/tmp/project', sessionPath: '/tmp/session.jsonl' })

    const prompt = manager.prompt('conversation-a', 'prompt-1', 'hello')
    runnerBroadcast?.({ type: 'pi:agent_start' })
    expect(manager.snapshot('conversation-a')).toMatchObject({ phase: 'idle' })
    runnerBroadcast?.({ type: 'pi:agent_end' })
    acceptPrompt?.()
    await prompt

    expect(manager.snapshot('conversation-a')).toMatchObject({ phase: 'idle' })
  })

  it('serializes RPC commands while the previous Pi acknowledgement is pending', async () => {
    let acceptPrompt: (() => void) | undefined
    const runner = {
      ...createFakeRunner(),
      isRunning: vi.fn(() => true),
      writePrompt: vi.fn(() => new Promise<{ id: string; success: boolean }>((resolve) => {
        acceptPrompt = () => resolve({ id: 'prompt-1', success: true })
      })),
    }
    const manager = new PiRunnerManager(() => {}, () => runner)
    await manager.start('conversation-a', { cwd: '/tmp/project', sessionPath: '/tmp/session.jsonl' })

    const first = manager.prompt('conversation-a', 'prompt-1', 'first')
    await vi.waitFor(() => expect(runner.writePrompt).toHaveBeenCalledOnce())
    await expect(manager.prompt('conversation-a', 'prompt-2', 'second')).rejects.toThrow(
      'Pi RPC command is already pending: prompt',
    )
    acceptPrompt?.()
    await first
    expect(manager.snapshot('conversation-a')).toMatchObject({ phase: 'running' })
  })

  it('rejects a fifth active runner without killing existing tasks', async () => {
    const created: Array<ReturnType<typeof createFakeRunner>> = []
    const manager = new PiRunnerManager(
      () => {},
      (broadcast, lifecycle) => {
        const runner = { ...createFakeRunner(broadcast, lifecycle), isRunning: vi.fn(() => true) }
        created.push(runner)
        return runner
      },
    )
    for (const id of ['a', 'b', 'c', 'd']) {
      await manager.start(id, { cwd: '/tmp/project', sessionPath: `/tmp/${id}.jsonl` })
      await manager.prompt(id, `prompt-${id}`, 'work')
    }

    await expect(
      manager.start('e', { cwd: '/tmp/project', sessionPath: '/tmp/e.jsonl' }),
    ).rejects.toThrow('Active Pi runner limit reached (4)')
    expect(created).toHaveLength(4)
    expect(created.slice(0, 4).every((runner) => runner.terminate.mock.calls.length === 0)).toBe(true)
    expect(manager.snapshot('e')).toBeUndefined()
  })

  it('reserves active capacity while concurrent runners are still starting', async () => {
    const finishStarts: Array<() => void> = []
    const manager = new PiRunnerManager(
      () => {},
      () => ({
        ...createFakeRunner(),
        start: vi.fn(() => new Promise<void>((resolve) => finishStarts.push(resolve))),
      }),
    )
    const starts = ['a', 'b', 'c', 'd'].map((id) => manager.start(id, {
      cwd: '/tmp/project',
      sessionPath: `/tmp/${id}.jsonl`,
    }))

    await expect(manager.start('e', {
      cwd: '/tmp/project',
      sessionPath: '/tmp/e.jsonl',
    })).rejects.toThrow('Active Pi runner limit reached (4)')

    for (const finish of finishStarts) finish()
    await Promise.all(starts)
  })
})
