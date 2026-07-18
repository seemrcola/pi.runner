import {
  BrowserWindow,
  screen,
  shell,
  type BrowserWindowConstructorOptions,
  type Rectangle,
  type WebContents,
} from 'electron'
import { pathToFileURL } from 'node:url'
import { PET_STATES, type PetState } from '../src/features/desktop-pet/core/petTypes.js'
import {
  createMainWindowOptions,
  createPetWindowOptions,
  PET_WINDOW_SCREEN_MARGIN,
} from './windowOptions.js'

type BrowserWindowFactory = (options: BrowserWindowConstructorOptions) => BrowserWindow
type IntervalHandle = ReturnType<typeof globalThis.setInterval>
type WindowType = 'main' | 'pet'

const PET_MOTION_TICK_MS = 50
const PET_MOTION_STEP_PX = 10
const PET_MOTION_FOCUS_PAUSE_MS = 5_000
const MAX_PET_DRAG_DELTA_PX = 16_384

type WindowManagerOptions = {
  devServerUrl?: string
  iconPath?: string
  isQuitting: () => boolean
  petPreloadPath: string
  preloadPath: string
  rendererHtmlPath: string
  browserWindowFactory?: BrowserWindowFactory
  clearInterval?: (handle: IntervalHandle) => void
  getPrimaryWorkArea?: () => Rectangle
  getWorkAreaForBounds?: (bounds: Rectangle) => Rectangle
  now?: () => number
  openExternal?: (url: string) => unknown
  random?: () => number
  setInterval?: (callback: () => void, delay: number) => IntervalHandle
}

export type WindowManager = {
  beginPetDrag(): void
  dragPetWindowBy(deltaX: unknown, deltaY: unknown): void
  getMainWindow(): BrowserWindow | null
  getPetWindow(): BrowserWindow | null
  hidePetWindow(): void
  isTrustedSender(windowType: WindowType, sender: WebContents, frameUrl: string): boolean
  showMainWindow(): void
  showPetWindow(): void
  updatePetState(state: unknown): void
}

export function createWindowManager(options: WindowManagerOptions): WindowManager {
  const createBrowserWindow = options.browserWindowFactory ?? ((windowOptions) => new BrowserWindow(windowOptions))
  const scheduleInterval = options.setInterval ?? globalThis.setInterval
  const cancelInterval = options.clearInterval ?? globalThis.clearInterval
  const getPrimaryWorkArea = options.getPrimaryWorkArea ?? (() => screen.getPrimaryDisplay().workArea)
  const now = options.now ?? Date.now
  const openExternal = options.openExternal ?? ((url: string) => shell.openExternal(url))
  const random = options.random ?? Math.random
  let mainWindow: BrowserWindow | null = null
  let petWindow: BrowserWindow | null = null
  let petMotionTimer: IntervalHandle | null = null
  let petMotionPausedUntil = 0
  let petState: PetState = 'resting'
  let petWalkDirection: -1 | 1 = 1
  let petWalkStarted = false
  let petWalkCompleted = false

  function stopPetMotion() {
    if (petMotionTimer === null) return
    cancelInterval(petMotionTimer)
    petMotionTimer = null
  }

  function workAreaForBounds(bounds: Rectangle) {
    return options.getWorkAreaForBounds?.(bounds) ?? screen.getDisplayMatching(bounds).workArea
  }

  function petWorkArea(window: BrowserWindow) {
    return workAreaForBounds(window.getBounds())
  }

  function horizontalRange(workArea: Rectangle, windowBounds: Rectangle) {
    const minimumX = workArea.x + PET_WINDOW_SCREEN_MARGIN
    return {
      minimumX,
      maximumX: Math.max(
        minimumX,
        workArea.x + workArea.width - windowBounds.width - PET_WINDOW_SCREEN_MARGIN,
      ),
    }
  }

  function pausePetMotion() {
    // 按下会立即暂停；手动增量和原生 will-move 会持续续期，避免散步状态抢回窗口。
    petMotionPausedUntil = now() + PET_MOTION_FOCUS_PAUSE_MS
  }

  function movePetWindow() {
    const window = petWindow
    if (
      !window ||
      window.isDestroyed() ||
      !window.isVisible() ||
      petState !== 'walking' ||
      petWalkCompleted ||
      now() < petMotionPausedUntil
    ) return

    const workArea = petWorkArea(window)
    const bounds = window.getBounds()
    const { minimumX, maximumX } = horizontalRange(workArea, bounds)
    const candidateX = bounds.x + PET_MOTION_STEP_PX * petWalkDirection
    const reachedDestination = petWalkDirection === 1 ? candidateX >= maximumX : candidateX <= minimumX
    const nextX = reachedDestination ? (petWalkDirection === 1 ? maximumX : minimumX) : candidateX
    const bottomY = workArea.y + workArea.height - bounds.height - PET_WINDOW_SCREEN_MARGIN

    // 跨屏移动由主进程持有，renderer 不需要获得窗口坐标或任意 BrowserWindow 能力。
    window.setPosition(Math.round(nextX), Math.round(bottomY), false)
    if (reachedDestination) {
      petWalkCompleted = true
      stopPetMotion()
    }
  }

  function startPetMotion() {
    const window = petWindow
    if (
      petMotionTimer !== null ||
      !window ||
      window.isDestroyed() ||
      !window.isVisible() ||
      petState !== 'walking' ||
      petWalkCompleted
    ) return

    if (!petWalkStarted) {
      const workArea = petWorkArea(window)
      const bounds = window.getBounds()
      const { minimumX, maximumX } = horizontalRange(workArea, bounds)
      const startX = petWalkDirection === 1 ? minimumX : maximumX
      const bottomY = workArea.y + workArea.height - bounds.height - PET_WINDOW_SCREEN_MARGIN
      window.setPosition(Math.round(startX), Math.round(bottomY), false)
      petWalkStarted = true
    }
    petMotionTimer = scheduleInterval(movePetWindow, PET_MOTION_TICK_MS)
  }

  function rendererUrl(windowType: WindowType) {
    const url = options.devServerUrl
      ? new URL(options.devServerUrl)
      : pathToFileURL(options.rendererHtmlPath)
    if (windowType === 'pet') url.searchParams.set('window', 'pet')
    else url.searchParams.delete('window')
    return url
  }

  function isTrustedRendererUrl(rawUrl: string, windowType: WindowType) {
    try {
      const actual = new URL(rawUrl)
      const expected = rendererUrl(windowType)
      // hash 只影响同一文档内定位，不改变 renderer 的安全来源。
      actual.hash = ''
      expected.hash = ''
      return actual.href === expected.href
    } catch {
      return false
    }
  }

  function openExternalUrl(rawUrl: string) {
    let externalUrl: URL
    try {
      externalUrl = new URL(rawUrl)
    } catch {
      return
    }
    if (externalUrl.protocol !== 'http:' && externalUrl.protocol !== 'https:') return

    try {
      void Promise.resolve(openExternal(externalUrl.toString())).catch((error) => {
        console.warn('Failed to open external URL', error)
      })
    } catch (error) {
      console.warn('Failed to open external URL', error)
    }
  }

  function loadRenderer(window: BrowserWindow, windowType: WindowType) {
    if (options.devServerUrl) {
      void window.loadURL(rendererUrl(windowType).toString())
      if (windowType === 'main') window.webContents.openDevTools({ mode: 'detach' })
      return
    }

    const fileOptions = windowType === 'pet' ? { query: { window: 'pet' } } : undefined
    void window.loadFile(options.rendererHtmlPath, fileOptions)
  }

  function hardenWindow(window: BrowserWindow) {
    // renderer 永远留在受信应用页面；普通链接交给系统浏览器，危险协议与未受管窗口一律拒绝。
    window.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      openExternalUrl(url)
    })
    // 重定向可能来自初始 renderer 加载，不代表用户点击，因此只拒绝而不自动打开外部页面。
    window.webContents.on('will-redirect', (event) => event.preventDefault())
    window.webContents.setWindowOpenHandler(({ url }) => {
      openExternalUrl(url)
      return { action: 'deny' }
    })
  }

  function createMainWindow() {
    const window = createBrowserWindow(createMainWindowOptions({
      iconPath: options.iconPath,
      preloadPath: options.preloadPath,
    }))
    mainWindow = window
    hardenWindow(window)

    window.on('close', (event) => {
      if (options.isQuitting()) return
      event.preventDefault()
      window.hide()
    })
    window.on('closed', () => {
      if (mainWindow === window) mainWindow = null
    })
    loadRenderer(window, 'main')
    return window
  }

  function createPetWindow() {
    const window = createBrowserWindow(createPetWindowOptions({
      iconPath: options.iconPath,
      preloadPath: options.petPreloadPath,
      workArea: getPrimaryWorkArea(),
    }))
    petWindow = window
    hardenWindow(window)

    if (process.platform === 'darwin') {
      // 桌面宠物属于跨 Space 的浮动工具，不应随着主窗口切换桌面而消失。
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }
    window.on('focus', pausePetMotion)
    window.on('will-move', pausePetMotion)
    window.on('closed', () => {
      if (petWindow !== window) return
      stopPetMotion()
      petWindow = null
      petState = 'resting'
      petMotionPausedUntil = 0
      petWalkStarted = false
      petWalkCompleted = false
    })
    loadRenderer(window, 'pet')
    return window
  }

  return {
    beginPetDrag() {
      if (!petWindow || petWindow.isDestroyed()) return
      pausePetMotion()
    },
    dragPetWindowBy(deltaX, deltaY) {
      const window = petWindow
      if (
        !window
        || window.isDestroyed()
        || typeof deltaX !== 'number'
        || typeof deltaY !== 'number'
        || !Number.isFinite(deltaX)
        || !Number.isFinite(deltaY)
      ) return

      const x = Math.round(deltaX)
      const y = Math.round(deltaY)
      if (
        (x === 0 && y === 0)
        || !Number.isSafeInteger(x)
        || !Number.isSafeInteger(y)
        || Math.abs(x) > MAX_PET_DRAG_DELTA_PX
        || Math.abs(y) > MAX_PET_DRAG_DELTA_PX
      ) return

      // renderer 只提供单次指针增量；窗口绝对坐标和移动权限继续由主进程持有。
      pausePetMotion()
      const bounds = window.getBounds()
      const proposedBounds = { ...bounds, x: bounds.x + x, y: bounds.y + y }
      const workArea = workAreaForBounds(proposedBounds)
      const nextX = clamp(proposedBounds.x, workArea.x, workArea.x + workArea.width - bounds.width)
      const nextY = clamp(proposedBounds.y, workArea.y, workArea.y + workArea.height - bounds.height)
      if (nextX === bounds.x && nextY === bounds.y) return
      window.setPosition(nextX, nextY, false)
    },
    getMainWindow() {
      return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
    },
    getPetWindow() {
      return petWindow && !petWindow.isDestroyed() ? petWindow : null
    },
    hidePetWindow() {
      stopPetMotion()
      if (petWindow && !petWindow.isDestroyed()) petWindow.hide()
    },
    isTrustedSender(windowType, sender, frameUrl) {
      const window = windowType === 'main' ? mainWindow : petWindow
      return Boolean(
        window
        && !window.isDestroyed()
        && window.webContents === sender
        && isTrustedRendererUrl(frameUrl, windowType),
      )
    },
    showMainWindow() {
      const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createMainWindow()
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    },
    showPetWindow() {
      const window = petWindow && !petWindow.isDestroyed() ? petWindow : createPetWindow()
      // 宠物出现时不抢走消息输入框或编辑器焦点。
      window.showInactive()
      startPetMotion()
    },
    updatePetState(value) {
      if (!isPetWindowState(value) || value === petState) return

      stopPetMotion()
      petState = value
      petWalkStarted = false
      petWalkCompleted = false
      if (value !== 'walking') return

      petWalkDirection = boundedRandom(random()) < 0.5 ? 1 : -1
      startPetMotion()
    },
  }
}

function isPetWindowState(value: unknown): value is PetState {
  return typeof value === 'string' && PET_STATES.includes(value as PetState)
}

function boundedRandom(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 0.999_999
  return value
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.round(Math.min(Math.max(value, minimum), Math.max(minimum, maximum)))
}
