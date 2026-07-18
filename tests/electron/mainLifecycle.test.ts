import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const main = readFileSync(fileURLToPath(new URL('../../electron/main.ts', import.meta.url)), 'utf8')
const preload = readFileSync(fileURLToPath(new URL('../../electron/preload.ts', import.meta.url)), 'utf8')
const petPreload = readFileSync(fileURLToPath(new URL('../../electron/petPreload.ts', import.meta.url)), 'utf8')
const windowManager = readFileSync(fileURLToPath(new URL('../../electron/windowManager.ts', import.meta.url)), 'utf8')
const shell = readFileSync(fileURLToPath(new URL('../../src/composables/useAppSessionShell.ts', import.meta.url)), 'utf8')

describe('macOS resident app wiring', () => {
  it('hides the main window on close and restores it from Dock or Tray', () => {
    expect(windowManager).toContain("window.on('close'")
    expect(windowManager).toContain('event.preventDefault()')
    expect(windowManager).toContain('window.hide()')
    expect(main).toContain('function showMainWindow()')
    expect(main).toContain("label: '显示 Pi RUNNER'")
    expect(main).toContain("app.on('activate', showMainWindow)")
  })

  it('owns a template Tray and only stops backend during true app quit', () => {
    expect(main).toContain('new Tray(')
    expect(main).toContain('setTemplateImage(true)')
    expect(main).toContain("label: '退出 Pi RUNNER…'")
    expect(main).not.toContain("app.on('window-all-closed', () => {\n  stopBackend()")
    expect(main).toContain("app.on('before-quit'")
    expect(main).toContain('mainWindow?.isVisible()')
    expect(main).toContain('app.requestSingleInstanceLock()')
    expect(main).toContain("app.on('second-instance', showMainWindow)")
    expect(main).toContain('new BackendProcessSupervisor({')
    expect(main).toContain("detached: process.platform !== 'win32'")
  })

  it('syncs backend-derived active task state through narrow IPC', () => {
    expect(preload).toContain("ipcRenderer.send('runtime:update-task-summary'")
    expect(main).toContain("ipcMain.on('runtime:update-task-summary'")
    expect(shell).toContain('updateTaskSummary')
    expect(shell).toContain('activeTaskCount')
    expect(shell).toContain('isModelsDirty || isSettingsDirty')
  })

  it('splits main and pet preload capabilities and validates IPC senders', () => {
    expect(preload).toContain("ipcRenderer.send('pet:show')")
    expect(preload).not.toContain("ipcRenderer.send('pet:hide')")
    expect(preload).not.toContain("ipcRenderer.send('pet:update-state', state)")
    expect(petPreload).toContain("exposeInMainWorld('piPet'")
    expect(petPreload).toContain("ipcRenderer.send('pet:hide')")
    expect(petPreload).toContain("ipcRenderer.send('pet:drag-start')")
    expect(petPreload).toContain("ipcRenderer.send('pet:drag-move', deltaX, deltaY)")
    expect(petPreload).toContain("ipcRenderer.send('pet:update-state', state)")
    expect(petPreload).not.toContain('backend:get-url')
    expect(petPreload).not.toContain('workspace:')
    expect(petPreload).not.toContain('runtime:update-task-summary')
    expect(main).toContain("ipcMain.on('pet:show'")
    expect(main).toContain("ipcMain.on('pet:hide'")
    expect(main).toContain("ipcMain.on('pet:drag-start'")
    expect(main).toContain("ipcMain.on('pet:drag-move'")
    expect(main).toContain("ipcMain.on('pet:update-state'")
    expect(main).toContain("isTrustedSender('main', event.sender")
    expect(main).toContain("isTrustedSender('pet', event.sender")
    expect(main).toContain('if (!isMainWindowSender(event)) return')
    expect(main).toContain('if (!isPetWindowSender(event)) return')
    expect(main).toContain('assertMainWindowSender(event)')
    expect(windowManager).toContain("url.searchParams.set('window', 'pet')")
    expect(windowManager).toContain("query: { window: 'pet' }")
  })
})
