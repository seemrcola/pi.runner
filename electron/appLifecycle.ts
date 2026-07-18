export type TaskSummary = {
  known: boolean
  activeTaskCount: number
  hasUnsavedSettings: boolean
}

export type QuitConfirmation = {
  message: string
  detail: string
  buttons: [string, string, string]
  defaultId: number
  cancelId: number
}

export function normalizeTaskSummary(value: unknown): TaskSummary {
  if (!value || typeof value !== 'object') return unknownTaskSummary()
  const candidate = value as Partial<TaskSummary>
  if (candidate.known !== true || !Number.isInteger(candidate.activeTaskCount) || candidate.activeTaskCount! < 0) {
    return unknownTaskSummary()
  }
  return { known: true, activeTaskCount: candidate.activeTaskCount!, hasUnsavedSettings: candidate.hasUnsavedSettings === true }
}

export function taskStatusLabel(summary: TaskSummary): string {
  if (!summary.known) return '任务状态未知'
  if (summary.activeTaskCount === 0) return '当前没有运行中的任务'
  return `${summary.activeTaskCount} 个任务进行中`
}

export function quitConfirmationFor(summary: TaskSummary): QuitConfirmation | null {
  if (summary.known && summary.activeTaskCount === 0 && !summary.hasUnsavedSettings) return null
  const details: string[] = []
  if (summary.hasUnsavedSettings) details.push('有未保存的设置更改，退出会丢失这些更改。')
  if (summary.activeTaskCount > 0) details.push(`退出会停止 ${summary.activeTaskCount} 个正在执行的任务。`)
  if (!summary.known) details.push('无法确认任务状态，退出可能停止正在执行的任务。')
  const detail = summary.hasUnsavedSettings && summary.known && summary.activeTaskCount === 0
    ? details.join(' ')
    : `${details.join(' ')}关闭窗口不会停止任务。`
  return {
    message: '退出 Pi RUNNER？',
    detail,
    buttons: ['取消', '隐藏窗口', '退出并停止任务'],
    defaultId: 0,
    cancelId: 0,
  }
}

export function unknownTaskSummary(): TaskSummary {
  return { known: false, activeTaskCount: 0, hasUnsavedSettings: false }
}
