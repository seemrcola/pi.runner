export type BackendRestartState = {
  intentionalStop: boolean
  appQuitting: boolean
}

export type BackendProcessRef = {
  killed: boolean
} | null

export function shouldRestartBackendProcess(state: BackendRestartState): boolean {
  return !state.intentionalStop && !state.appQuitting
}

export function shouldStartBackendProcess(process: BackendProcessRef): boolean {
  return process === null
}

export function getBackendRestartDelayMs(attempt: number): number {
  return Math.min(10_000, 500 * 2 ** Math.max(0, attempt))
}

export function createBackendProcessEnv(
  baseEnv: NodeJS.ProcessEnv,
  port: number,
  token: string,
  instanceId?: string,
  supervisorPid = process.pid,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    // 打包后 process.execPath 指向 Electron App；Node 模式可避免子进程递归启动整套桌面应用。
    ELECTRON_RUN_AS_NODE: '1',
    PI_DESKTOP_BACKEND_PORT: String(port),
    PI_DESKTOP_BACKEND_TOKEN: token,
    PI_DESKTOP_SUPERVISOR_PID: String(supervisorPid),
    ...(instanceId ? { PI_DESKTOP_BACKEND_INSTANCE_ID: instanceId } : {}),
  }
}
