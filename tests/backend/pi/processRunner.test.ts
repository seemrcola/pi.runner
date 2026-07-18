import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { PiProcessRunner } from '../../../backend/pi/processRunner.js'
import { createFakeChildProcess } from '../../helpers/fakeChildProcess.js'

const resolveProcessEnv = async () => ({ PATH: '/usr/bin:/bin' })

describe('PiProcessRunner RPC requests', () => {
  it('does not spawn after terminate cancels an in-flight start', async () => {
    let resolveExecutable: ((executable: string) => void) | undefined
    const spawnProcess = vi.fn()
    const runner = new PiProcessRunner(
      () => undefined,
      {},
      {
        resolveExecutable: () => new Promise<string>((resolve) => { resolveExecutable = resolve }),
        resolveProcessEnv,
        supportsApprove: async () => true,
        spawnProcess,
      },
    )

    const start = runner.start({ cwd: '/tmp/project', sessionPath: '/tmp/session.jsonl' })
    await runner.terminate()
    resolveExecutable?.('pi')

    await expect(start).rejects.toThrow('Pi process start cancelled')
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('rejects startup when the child process emits an asynchronous spawn error', async () => {
    const child = createFakeChildProcess(1001)
    const broadcasts: Array<Record<string, unknown>> = []
    const onExit = vi.fn()
    const spawnProcess = vi.fn(() => child)
    const runner = new PiProcessRunner(
      (event) => broadcasts.push(event),
      { onExit },
      {
        resolveExecutable: async () => '/missing/pi',
        resolveProcessEnv,
        supportsApprove: async () => false,
        spawnProcess: spawnProcess as never,
      },
    )

    const start = runner.start({ cwd: '/tmp/project', sessionPath: '/tmp/session.jsonl' })
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce())
    child.stdin.emit('error', new Error('write EPIPE'))
    child.emit('error', new Error('spawn /missing/pi ENOENT'))
    child.emit('close', 1, null)

    await expect(start).rejects.toThrow('spawn /missing/pi ENOENT')
    expect(runner.isRunning()).toBe(false)
    expect(onExit).not.toHaveBeenCalled()
    expect(broadcasts).toEqual([
      expect.objectContaining({ type: 'pi:status' }),
    ])
  })

  it('waits for child cleanup when runtime writer registration fails at spawn', async () => {
    const child = createFakeChildProcess(1010)
    let finishTermination: (() => void) | undefined
    const terminateProcess = vi.fn(() => new Promise<{ outcome: 'graceful'; forcedPids: number[] }>((resolve) => {
      finishTermination = () => resolve({ outcome: 'graceful', forcedPids: [] })
    }))
    const runner = new PiProcessRunner(
      () => {},
      { onSpawn: () => { throw new Error('runtime lock write failed') } },
      {
        resolveExecutable: async () => 'pi',
        resolveProcessEnv,
        supportsApprove: async () => false,
        spawnProcess: vi.fn(() => child) as never,
        terminateProcess,
      },
    )

    const start = runner.start({ cwd: '/tmp/project', sessionPath: '/tmp/session.jsonl' })
    const rejection = expect(start).rejects.toThrow('runtime lock write failed')
    await vi.waitFor(() => expect(child.listenerCount('spawn')).toBeGreaterThan(0))
    child.emit('spawn')
    await vi.waitFor(() => expect(terminateProcess).toHaveBeenCalledWith(child))

    let settled = false
    void start.catch(() => {}).finally(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    finishTermination?.()
    await rejection
  })

  it('retains the previous process handle when replacement cleanup fails', async () => {
    const child = createFakeChildProcess(1013)
    const terminateProcess = vi.fn(async () => { throw new Error('cleanup failed') })
    const runner = new PiProcessRunner(
      () => {},
      {},
      {
        resolveExecutable: async () => 'pi',
        resolveProcessEnv,
        supportsApprove: async () => false,
        spawnProcess: vi.fn(() => child) as never,
        terminateProcess,
      },
    )
    const firstStart = runner.start({ cwd: '/tmp/project', sessionPath: '/tmp/one.jsonl' })
    await vi.waitFor(() => expect(child.listenerCount('spawn')).toBeGreaterThan(0))
    child.emit('spawn')
    await firstStart

    await expect(runner.start({ cwd: '/tmp/project', sessionPath: '/tmp/two.jsonl' }))
      .rejects.toThrow('cleanup failed')
    expect(runner.hasProcessHandle()).toBe(true)
  })

  it('turns stdin stream errors into one managed runner exit', async () => {
    const child = createFakeChildProcess(1002)
    const broadcasts: Array<Record<string, unknown>> = []
    const onExit = vi.fn()
    const runner = new PiProcessRunner(
      (event) => broadcasts.push(event),
      { onExit },
      {
        resolveExecutable: async () => 'pi',
        resolveProcessEnv,
        supportsApprove: async () => false,
        spawnProcess: vi.fn(() => child) as never,
      },
    )
    const start = runner.start({ cwd: '/tmp/project', sessionPath: '/tmp/session.jsonl' })
    await vi.waitFor(() => expect(child.listenerCount('spawn')).toBeGreaterThan(0))
    child.emit('spawn')
    await start

    child.stdin.emit('error', new Error('write EPIPE'))
    child.emit('close', 1, null)

    await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce())
    expect(runner.isRunning()).toBe(false)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(onExit).toHaveBeenCalledOnce()
    expect(broadcasts).toContainEqual(expect.objectContaining({
      type: 'pi:error',
      message: expect.stringContaining('write EPIPE'),
    }))
  })

  it('submits one managed exit when a spawned child emits error before exit', async () => {
    const child = createFakeChildProcess(1003)
    const broadcasts: Array<Record<string, unknown>> = []
    const onExit = vi.fn()
    const runner = new PiProcessRunner(
      (event) => broadcasts.push(event),
      { onExit },
      {
        resolveExecutable: async () => 'pi',
        resolveProcessEnv,
        supportsApprove: async () => false,
        spawnProcess: vi.fn(() => child) as never,
      },
    )
    const start = runner.start({ cwd: '/tmp/project', sessionPath: '/tmp/session.jsonl' })
    await vi.waitFor(() => expect(child.listenerCount('spawn')).toBeGreaterThan(0))
    child.emit('spawn')
    await start

    child.emit('error', new Error('runtime child failure'))
    child.emit('close', 1, null)

    await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce())
    expect(runner.isRunning()).toBe(false)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(onExit).toHaveBeenCalledOnce()
    expect(broadcasts.filter((event) => event.type === 'pi:error')).toHaveLength(1)
    expect(broadcasts.filter((event) => event.type === 'pi:status')).toHaveLength(1)
  })

  it('retains a failed termination handle, allows retry, and waits for a later real close', async () => {
    const child = createFakeChildProcess(1011)
    const onExit = vi.fn()
    const terminateProcess = vi.fn(async () => { throw new Error('process survived SIGKILL') })
    const runner = new PiProcessRunner(
      () => {},
      { onExit },
      {
        resolveExecutable: async () => 'pi',
        resolveProcessEnv,
        supportsApprove: async () => false,
        spawnProcess: vi.fn(() => child) as never,
        terminateProcess,
      },
    )
    const start = runner.start({ cwd: '/tmp/project', sessionPath: '/tmp/session.jsonl' })
    await vi.waitFor(() => expect(child.listenerCount('spawn')).toBeGreaterThan(0))
    child.emit('spawn')
    await start

    await expect(runner.terminate()).rejects.toThrow('process survived SIGKILL')
    expect(runner.hasProcessHandle()).toBe(true)
    await expect(runner.terminate()).rejects.toThrow('process survived SIGKILL')
    expect(terminateProcess).toHaveBeenCalledTimes(2)

    child.exitCode = 1
    child.emit('close', 1, 'SIGKILL')
    expect(runner.hasProcessHandle()).toBe(false)
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('waits for close instead of releasing an exited child with pending stdio', async () => {
    const child = createFakeChildProcess(1012)
    const terminateProcess = vi.fn()
    const onExit = vi.fn()
    const runner = new PiProcessRunner(
      () => {},
      { onExit },
      {
        resolveExecutable: async () => 'pi',
        resolveProcessEnv,
        supportsApprove: async () => false,
        spawnProcess: vi.fn(() => child) as never,
        terminateProcess,
      },
    )
    const start = runner.start({ cwd: '/tmp/project', sessionPath: '/tmp/session.jsonl' })
    await vi.waitFor(() => expect(child.listenerCount('spawn')).toBeGreaterThan(0))
    child.emit('spawn')
    await start

    child.exitCode = 0
    child.emit('exit', 0, null)
    const termination = runner.terminate()
    let settled = false
    void termination.finally(() => { settled = true })
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(terminateProcess).not.toHaveBeenCalled()
    expect(runner.hasProcessHandle()).toBe(true)

    child.emit('close', 0, null)
    await expect(termination).resolves.toMatchObject({ outcome: 'already-exited', pid: 1012 })
    expect(runner.hasProcessHandle()).toBe(false)
    expect(onExit).not.toHaveBeenCalled()
  })

  it('drains stdout after exit before submitting the terminal lifecycle', async () => {
    const child = createFakeChildProcess(1004)
    const broadcasts: Array<Record<string, unknown>> = []
    const onExit = vi.fn()
    const runner = new PiProcessRunner(
      (event) => broadcasts.push(event),
      { onExit },
      {
        resolveExecutable: async () => 'pi',
        resolveProcessEnv,
        supportsApprove: async () => false,
        spawnProcess: vi.fn(() => child) as never,
      },
    )
    const start = runner.start({ cwd: '/tmp/project', sessionPath: '/tmp/session.jsonl' })
    await vi.waitFor(() => expect(child.listenerCount('spawn')).toBeGreaterThan(0))
    child.emit('spawn')
    await start

    child.exitCode = 1
    child.emit('exit', 1, null)
    child.stdout.write(`${JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'final buffered text' },
    })}\n`)

    expect(runner.isRunning()).toBe(false)
    expect(runner.hasProcessHandle()).toBe(true)
    expect(onExit).not.toHaveBeenCalled()
    expect(broadcasts.at(-1)).toEqual({ type: 'pi:text_delta', delta: 'final buffered text' })

    child.emit('close', 1, null)

    expect(onExit).toHaveBeenCalledOnce()
    expect(runner.hasProcessHandle()).toBe(false)
    expect(broadcasts.at(-1)).toEqual({
      type: 'pi:status',
      message: 'pi exited code=1 signal=',
    })
  })

  it('stops close finalization when the final stdout event shuts down the runner', async () => {
    const child = createFakeChildProcess(1005)
    const broadcasts: Array<Record<string, unknown>> = []
    const onExit = vi.fn()
    let runner!: PiProcessRunner
    runner = new PiProcessRunner(
      (event) => {
        broadcasts.push(event)
        if (event.type === 'pi:agent_end') void runner.terminate()
      },
      { onExit },
      {
        resolveExecutable: async () => 'pi',
        resolveProcessEnv,
        supportsApprove: async () => false,
        spawnProcess: vi.fn(() => child) as never,
      },
    )
    const start = runner.start({ cwd: '/tmp/project', sessionPath: '/tmp/session.jsonl' })
    await vi.waitFor(() => expect(child.listenerCount('spawn')).toBeGreaterThan(0))
    child.emit('spawn')
    await start

    child.stdout.write(JSON.stringify({ type: 'agent_end' }))
    child.emit('exit', 0, null)
    child.emit('close', 0, null)

    expect(broadcasts.at(-1)).toEqual({ type: 'pi:agent_end', error: undefined, willRetry: undefined })
    expect(broadcasts).not.toContainEqual(expect.objectContaining({
      type: 'pi:status',
      message: expect.stringContaining('pi exited'),
    }))
    expect(onExit).not.toHaveBeenCalled()
  })

  it('writes streaming behavior on prompt commands and waits for acknowledgement', async () => {
    const runner = new PiProcessRunner(() => undefined)
    const writes = attachFakeRunningProcess(runner)

    const response = runner.writePrompt('prompt-1', 'guide the current run', 'steer')

    expect(writes).toEqual([
      '{"id":"prompt-1","type":"prompt","message":"guide the current run","streamingBehavior":"steer"}\n',
    ])
    consumeStdout(runner, '{"type":"response","id":"prompt-1","success":true}\n')
    await expect(response).resolves.toMatchObject({ id: 'prompt-1', success: true })
  })

  it('writes images on prompt commands and waits for acknowledgement', async () => {
    const runner = new PiProcessRunner(() => undefined)
    const writes = attachFakeRunningProcess(runner)

    const response = runner.writePrompt('prompt-1', 'describe it', undefined, [
      { type: 'image', data: 'abc123', mimeType: 'image/png' },
    ])

    expect(writes).toEqual([
      '{"id":"prompt-1","type":"prompt","message":"describe it","images":[{"type":"image","data":"abc123","mimeType":"image/png"}]}\n',
    ])
    consumeStdout(runner, '{"type":"response","id":"prompt-1","success":true}\n')
    await expect(response).resolves.toMatchObject({ id: 'prompt-1', success: true })
  })

  it('resolves a request with the matching response data', async () => {
    const runner = new PiProcessRunner(() => undefined)
    const writes = attachFakeRunningProcess(runner)

    const response = runner.request('state-1', { type: 'get_state' }, 100)
    expect(writes).toEqual(['{"id":"state-1","type":"get_state"}\n'])

    consumeStdout(
      runner,
      '{"type":"response","id":"state-1","success":true,"data":{"sessionFile":"/tmp/current.jsonl","sessionName":"Current session"}}\n',
    )

    await expect(response).resolves.toEqual({
      id: 'state-1',
      success: true,
      data: {
        sessionFile: '/tmp/current.jsonl',
        sessionName: 'Current session',
      },
    })
  })

  it('reads the current PI state through get_state', async () => {
    const runner = new PiProcessRunner(() => undefined)
    const writes = attachFakeRunningProcess(runner)

    const state = runner.getState(100)
    expect(writes[0]).toMatch(/"type":"get_state"/)
    const stateId = JSON.parse(writes[0]).id

    consumeStdout(
      runner,
      JSON.stringify({
        type: 'response',
        id: stateId,
        success: true,
        data: {
          sessionFile: '/tmp/current.jsonl',
          sessionName: 'Current session',
        },
      }) + '\n',
    )

    await expect(state).resolves.toEqual({
      sessionPath: '/tmp/current.jsonl',
      sessionName: 'Current session',
    })
  })

  it('keeps startup diagnostics for command, args, cwd, stderr and exit status', async () => {
    const runner = new PiProcessRunner(() => undefined)
    ;(runner as unknown as {
      diagnostics: {
        command: string
        args: string[]
        cwd: string
        stderr: string[]
        exitCode: number | null
        exitSignal: string | null
      }
    }).diagnostics = {
      command: 'pi',
      args: ['--mode', 'rpc'],
      cwd: '/Users/example',
      stderr: ['failed'],
      exitCode: 1,
      exitSignal: null,
    }

    expect(runner.getDiagnostics()).toEqual({
      command: 'pi',
      args: ['--mode', 'rpc'],
      cwd: '/Users/example',
      stderr: ['failed'],
      exitCode: 1,
      exitSignal: null,
    })
  })

  it('keeps concurrent internal requests isolated by unique ids', async () => {
    const runner = new PiProcessRunner(() => undefined)
    const writes = attachFakeRunningProcess(runner)

    const first = runner.request('req-1', { type: 'get_state' }, 100)
    const second = runner.request('req-2', { type: 'get_state' }, 100)

    expect(writes).toEqual([
      '{"id":"req-1","type":"get_state"}\n',
      '{"id":"req-2","type":"get_state"}\n',
    ])

    consumeStdout(
      runner,
      '{"type":"response","id":"req-1","success":true,"data":{"sessionFile":"/tmp/one.jsonl"}}\n',
    )
    consumeStdout(
      runner,
      '{"type":"response","id":"req-2","success":true,"data":{"sessionFile":"/tmp/two.jsonl"}}\n',
    )

    await expect(first).resolves.toEqual({
      id: 'req-1',
      success: true,
      data: { sessionFile: '/tmp/one.jsonl' },
    })
    await expect(second).resolves.toEqual({
      id: 'req-2',
      success: true,
      data: { sessionFile: '/tmp/two.jsonl' },
    })
  })
})

function attachFakeRunningProcess(runner: PiProcessRunner): string[] {
  const stdin = new PassThrough()
  const writes: string[] = []
  stdin.on('data', (chunk) => writes.push(chunk.toString()))
  ;(runner as unknown as {
    piProcess: { stdin: PassThrough; killed: boolean; exitCode: null; signalCode: null }
  }).piProcess = {
    stdin,
    killed: false,
    exitCode: null,
    signalCode: null,
  }
  return writes
}

function consumeStdout(runner: PiProcessRunner, chunk: string): void {
  ;(runner as unknown as { consumeStdout(value: string): void }).consumeStdout(chunk)
}
