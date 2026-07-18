export type ParentWatchdogOptions = {
  expectedParentPid?: string
  readParentPid?: () => number
  intervalMs?: number
  setInterval?: typeof setInterval
  clearInterval?: typeof clearInterval
  onOrphaned(): void
}

export function startParentWatchdog(options: ParentWatchdogOptions): () => void {
  const expectedParentPid = Number(options.expectedParentPid)
  if (!Number.isInteger(expectedParentPid) || expectedParentPid <= 1) return () => {}

  const readParentPid = options.readParentPid ?? (() => process.ppid)
  const schedule = options.setInterval ?? setInterval
  const cancel = options.clearInterval ?? clearInterval
  let orphaned = false
  const timer = schedule(() => {
    if (orphaned || readParentPid() === expectedParentPid) return
    orphaned = true
    // Electron main 异常退出后 detached backend 不会自动收到信号。watchdog 让 backend
    // 走正常 shutdown，先清理 Pi/installer，再释放端口供新 supervisor 重启。
    options.onOrphaned()
  }, options.intervalMs ?? 1_000)
  ;(timer as NodeJS.Timeout).unref?.()

  return () => cancel(timer)
}
