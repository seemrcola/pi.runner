import { describe, expect, it } from 'vitest'
import {
  normalizeTaskSummary,
  quitConfirmationFor,
  taskStatusLabel,
} from '../../electron/appLifecycle'

describe('macOS application lifecycle policy', () => {
  it('normalizes untrusted renderer task summaries', () => {
    expect(normalizeTaskSummary({ known: true, activeTaskCount: 2, hasUnsavedSettings: true })).toEqual({ known: true, activeTaskCount: 2, hasUnsavedSettings: true })
    expect(normalizeTaskSummary({ known: true, activeTaskCount: -1 })).toEqual({ known: false, activeTaskCount: 0, hasUnsavedSettings: false })
    expect(normalizeTaskSummary(null)).toEqual({ known: false, activeTaskCount: 0, hasUnsavedSettings: false })
  })

  it('uses honest menu status labels', () => {
    expect(taskStatusLabel({ known: false, activeTaskCount: 0 })).toBe('任务状态未知')
    expect(taskStatusLabel({ known: true, activeTaskCount: 0 })).toBe('当前没有运行中的任务')
    expect(taskStatusLabel({ known: true, activeTaskCount: 2 })).toBe('2 个任务进行中')
  })

  it('only asks before quitting when tasks are active or unknown', () => {
    expect(quitConfirmationFor({ known: true, activeTaskCount: 0, hasUnsavedSettings: false })).toBeNull()
    expect(quitConfirmationFor({ known: true, activeTaskCount: 2, hasUnsavedSettings: false })).toMatchObject({
      message: '退出 Pi RUNNER？',
      detail: '退出会停止 2 个正在执行的任务。关闭窗口不会停止任务。',
      buttons: ['取消', '隐藏窗口', '退出并停止任务'],
      defaultId: 0,
      cancelId: 0,
    })
    expect(quitConfirmationFor({ known: false, activeTaskCount: 0, hasUnsavedSettings: false })).toMatchObject({
      detail: '无法确认任务状态，退出可能停止正在执行的任务。关闭窗口不会停止任务。',
    })
    expect(quitConfirmationFor({ known: true, activeTaskCount: 0, hasUnsavedSettings: true })).toMatchObject({
      detail: '有未保存的设置更改，退出会丢失这些更改。',
    })
  })
})
