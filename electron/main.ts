import { app, dialog, ipcMain, Menu, nativeImage, powerMonitor, shell, Tray } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBackendProcessEnv } from './backendProcess.js'
import {
  normalizeTaskSummary,
  quitConfirmationFor,
  taskStatusLabel,
  unknownTaskSummary,
  type TaskSummary,
} from './appLifecycle.js'
import { createWindowManager, type WindowManager } from './windowManager.js'
import { BackendProcessSupervisor } from './backendSupervisor.js'
import { BackendSupervisorLog } from './supervisorLog.js'
import { resolveDesktopDataDir } from '../backend/config/paths.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendPort = Number(process.env.PI_DESKTOP_BACKEND_PORT ?? '47831')
const backendToken = process.env.PI_DESKTOP_BACKEND_TOKEN ?? randomUUID()
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

let windows: WindowManager | null = null
let tray: Tray | null = null
let isQuitting = false
let isSystemShutdown = false
let quitConfirmationOpen = false
let allowQuit = false
let taskSummary: TaskSummary = unknownTaskSummary()
const backendSupervisorLog = new BackendSupervisorLog(
  path.join(resolveDesktopDataDir(), 'runtime', 'backend-supervisor.jsonl'),
)

const backendSupervisor = new BackendProcessSupervisor({
  spawnBackend() {
    const instanceId = randomUUID()
    const backendEntry = path.join(__dirname, '../backend/backend/server.js')
    const child = spawn(process.execPath, [backendEntry], {
      cwd: app.getPath('home'),
      detached: process.platform !== 'win32',
      env: createBackendProcessEnv(process.env, backendPort, backendToken, instanceId),
      shell: false,
    })
    return { child, instanceId }
  },
  verifyReady: waitForBackendReady,
  onStdout(data) {
    console.log(`[backend] ${data.trimEnd()}`)
  },
  onStderr(data) {
    console.error(`[backend] ${data.trimEnd()}`)
  },
  onSupervisorError(error) {
    console.error('[backend-supervisor]', error)
  },
  onEvent(event) {
    backendSupervisorLog.record(event)
  },
})

function resolveAppIconPath() {
  const candidates = [
    path.join(__dirname, '../renderer/app-icon.png'),
    path.join(process.cwd(), 'dist/renderer/app-icon.png'),
    path.join(process.cwd(), 'public/app-icon.png'),
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

function showMainWindow() {
  windows?.showMainWindow()
}

function isMainWindowSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  return windows?.isTrustedSender('main', event.sender, event.senderFrame?.url ?? '') === true
}

function isPetWindowSender(event: Electron.IpcMainEvent) {
  return windows?.isTrustedSender('pet', event.sender, event.senderFrame?.url ?? '') === true
}

function assertMainWindowSender(event: Electron.IpcMainInvokeEvent) {
  if (!isMainWindowSender(event)) throw new Error('该 IPC 仅允许主窗口调用')
}

function createTray() {
  if (tray) return
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
      <path fill="black" d="M3 2h7a5 5 0 0 1 0 10H7v4H3V2Zm4 3v4h3a2 2 0 1 0 0-4H7Z"/>
    </svg>
  `).toString('base64')}`)
  image.setTemplateImage(true)
  tray = new Tray(image)
  tray.setToolTip('Pi RUNNER')
  updateTrayMenu()
}

function updateTrayMenu() {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Pi RUNNER', enabled: false },
    { label: taskStatusLabel(taskSummary), enabled: false },
    { type: 'separator' },
    { label: '显示 Pi RUNNER', click: showMainWindow },
    { label: '显示桌面宠物', click: () => windows?.showPetWindow() },
    { type: 'separator' },
    { label: '退出 Pi RUNNER…', click: () => app.quit() },
  ]))
}

async function confirmQuitIfNeeded(event: Electron.Event) {
  if (allowQuit) return
  if (isSystemShutdown) {
    isQuitting = true
    void backendSupervisor.stop().catch((error) => console.error('System shutdown cleanup failed', error))
    return
  }

  event.preventDefault()
  if (isQuitting || quitConfirmationOpen) return
  const confirmation = quitConfirmationFor(taskSummary)
  if (!confirmation) {
    await quitAfterBackendCleanup()
    return
  }

  quitConfirmationOpen = true
  try {
    const messageBoxOptions: Electron.MessageBoxOptions = {
      type: 'warning',
      message: confirmation.message,
      detail: confirmation.detail,
      buttons: confirmation.buttons,
      defaultId: confirmation.defaultId,
      cancelId: confirmation.cancelId,
      noLink: true,
    }
    // Tray 退出时窗口通常处于隐藏状态；隐藏窗口不能作为 modal parent，否则确认框也可能不可见。
    const mainWindow = windows?.getMainWindow()
    const result = mainWindow?.isVisible()
      ? await dialog.showMessageBox(mainWindow, messageBoxOptions)
      : await dialog.showMessageBox(messageBoxOptions)
    if (result.response === 1) {
      mainWindow?.hide()
    } else if (result.response === 2) {
      await quitAfterBackendCleanup()
    }
  } finally {
    quitConfirmationOpen = false
  }
}

async function quitAfterBackendCleanup(): Promise<void> {
  isQuitting = true
  try {
    await backendSupervisor.stop()
    allowQuit = true
    app.quit()
  } catch (error) {
    isQuitting = false
    dialog.showErrorBox(
      '无法安全退出 Pi RUNNER',
      `仍有后台进程无法确认已停止：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function waitForBackendReady(instanceId: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${backendPort}/health`, {
        signal: AbortSignal.timeout(500),
      })
      const payload = await response.json() as { ok?: unknown; instanceId?: unknown }
      if (response.ok && payload.ok === true && payload.instanceId === instanceId) return
    } catch {
      // Backend spawn 后需要时间打开监听端口；在总 deadline 内继续探测。
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Backend ${instanceId} did not become ready within 10 seconds`)
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) {
    app.quit()
    return
  }
  const iconPath = resolveAppIconPath()
  const dock = app.dock
  if (process.platform === 'darwin' && iconPath && dock) {
    dock.setIcon(nativeImage.createFromPath(iconPath))
  }

  backendSupervisor.start()
  windows = createWindowManager({
    devServerUrl: process.env.VITE_DEV_SERVER_URL,
    iconPath,
    isQuitting: () => isQuitting,
    petPreloadPath: path.join(__dirname, 'petPreload.mjs'),
    preloadPath: path.join(__dirname, 'preload.mjs'),
    rendererHtmlPath: path.join(__dirname, '../renderer/index.html'),
  })
  windows.showMainWindow()
  createTray()
  powerMonitor.on('shutdown', () => {
    isSystemShutdown = true
    isQuitting = true
    void backendSupervisor.stop().catch((error) => console.error('System shutdown cleanup failed', error))
  })
})

app.on('window-all-closed', () => {
  // macOS only：窗口与应用生命周期分离，后台任务继续由常驻 backend 管理。
})

app.on('before-quit', (event) => {
  void confirmQuitIfNeeded(event)
})

app.on('activate', showMainWindow)
app.on('second-instance', showMainWindow)

ipcMain.on('runtime:update-task-summary', (event, value: unknown) => {
  if (!isMainWindowSender(event)) return
  taskSummary = normalizeTaskSummary(value)
  updateTrayMenu()
})

ipcMain.on('pet:show', (event) => {
  if (!isMainWindowSender(event)) return
  windows?.showPetWindow()
})

ipcMain.on('pet:hide', (event) => {
  if (!isPetWindowSender(event)) return
  windows?.hidePetWindow()
})

ipcMain.on('pet:drag-start', (event) => {
  if (!isPetWindowSender(event)) return
  windows?.beginPetDrag()
})

ipcMain.on('pet:drag-move', (event, deltaX: unknown, deltaY: unknown) => {
  if (!isPetWindowSender(event)) return
  windows?.dragPetWindowBy(deltaX, deltaY)
})

ipcMain.on('pet:update-state', (event, state: unknown) => {
  if (!isPetWindowSender(event)) return
  windows?.updatePetState(state)
})

ipcMain.handle('backend:get-url', async (event) => {
  assertMainWindowSender(event)
  return `ws://127.0.0.1:${backendPort}?token=${encodeURIComponent(backendToken)}`
})

ipcMain.handle('workspace:get-default-path', async (event) => {
  assertMainWindowSender(event)
  return process.env.PI_DESKTOP_WORKSPACE_CWD ?? process.cwd()
})

ipcMain.handle('workspace:get-home-path', async (event) => {
  assertMainWindowSender(event)
  return app.getPath('home')
})

ipcMain.handle('workspace:open-folder', async (event, folderPath: string) => {
  assertMainWindowSender(event)
  if (!folderPath) return ''
  return shell.openPath(folderPath)
})

ipcMain.handle('workspace:select-folder', async (event) => {
  assertMainWindowSender(event)
  const mainWindow = windows?.getMainWindow()
  if (!mainWindow) return ''
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return ''
  return result.filePaths[0]
})
