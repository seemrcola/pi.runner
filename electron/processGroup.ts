export type ProcessGroupPlatform = {
  signalGroup(processGroupId: number, signal: NodeJS.Signals): void
  isGroupAlive(processGroupId: number): boolean
  delay(ms: number): Promise<void>
}

const defaultPlatform: ProcessGroupPlatform = {
  signalGroup(processGroupId, signal) {
    process.kill(-processGroupId, signal)
  },
  isGroupAlive(processGroupId) {
    try {
      process.kill(-processGroupId, 0)
      return true
    } catch (error) {
      if (isNoSuchProcess(error)) return false
      throw error
    }
  },
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  },
}

export async function terminateProcessGroup(
  processGroupId: number,
  options: {
    graceMs?: number
    forceWaitMs?: number
    pollMs?: number
    platform?: ProcessGroupPlatform
  } = {},
): Promise<'already-exited' | 'graceful' | 'forced'> {
  const platform = options.platform ?? defaultPlatform
  if (!platform.isGroupAlive(processGroupId)) return 'already-exited'

  signalGroupIgnoringMissing(platform, processGroupId, 'SIGTERM')
  if (await waitForGroupExit(processGroupId, options.graceMs ?? 5_000, options.pollMs ?? 50, platform)) {
    return 'graceful'
  }

  signalGroupIgnoringMissing(platform, processGroupId, 'SIGKILL')
  if (await waitForGroupExit(processGroupId, options.forceWaitMs ?? 2_000, options.pollMs ?? 50, platform)) {
    return 'forced'
  }
  throw new Error(`Backend process group ${processGroupId} survived SIGKILL`)
}

async function waitForGroupExit(
  processGroupId: number,
  timeoutMs: number,
  pollMs: number,
  platform: ProcessGroupPlatform,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (platform.isGroupAlive(processGroupId)) {
    if (Date.now() >= deadline) return false
    await platform.delay(Math.min(pollMs, Math.max(0, deadline - Date.now())))
  }
  return true
}

function signalGroupIgnoringMissing(
  platform: ProcessGroupPlatform,
  processGroupId: number,
  signal: NodeJS.Signals,
): void {
  try {
    platform.signalGroup(processGroupId, signal)
  } catch (error) {
    if (!isNoSuchProcess(error)) throw error
  }
}

function isNoSuchProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}
