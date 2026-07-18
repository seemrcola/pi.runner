import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } }),
  },
}))

import { createWindowManager } from '../../electron/windowManager'

type Listener = (event: { preventDefault(): void }) => void
type WebContentsListener = (event: { preventDefault(): void }, url: string) => void
type WindowOpenHandler = (details: { url: string }) => { action: string }

class FakeWindow {
  readonly events = new Map<string, Listener>()
  readonly webContentsEvents = new Map<string, WebContentsListener>()
  readonly loadFiles: Array<{ path: string; options: unknown }> = []
  readonly loadUrls: string[] = []
  hideCalls = 0
  showCalls = 0
  showInactiveCalls = 0
  focusCalls = 0
  restoreCalls = 0
  minimized = false
  destroyed = false
  visible = false
  bounds: { x: number; y: number; width: number; height: number }
  readonly positions: Array<{ x: number; y: number }> = []
  readonly options: {
    webPreferences?: { preload?: string }
    x?: number
    y?: number
    width?: number
    height?: number
  }
  windowOpenHandler: WindowOpenHandler | null = null
  webContents = {
    on: vi.fn((name: string, listener: WebContentsListener) => {
      this.webContentsEvents.set(name, listener)
    }),
    openDevTools: vi.fn(),
    setWindowOpenHandler: vi.fn((handler: WindowOpenHandler) => {
      this.windowOpenHandler = handler
    }),
  }

  constructor(options: { x?: number; y?: number; width?: number; height?: number } = {}) {
    this.options = options
    this.bounds = {
      x: options.x ?? 0,
      y: options.y ?? 0,
      width: options.width ?? 0,
      height: options.height ?? 0,
    }
  }

  on(name: string, listener: Listener) {
    this.events.set(name, listener)
  }

  loadFile(path: string, options?: unknown) {
    this.loadFiles.push({ path, options })
    return Promise.resolve()
  }

  loadURL(url: string) { this.loadUrls.push(url); return Promise.resolve() }
  hide() { this.hideCalls += 1; this.visible = false }
  show() { this.showCalls += 1 }
  showInactive() { this.showInactiveCalls += 1; this.visible = true }
  focus() { this.focusCalls += 1 }
  restore() { this.restoreCalls += 1 }
  isMinimized() { return this.minimized }
  isDestroyed() { return this.destroyed }
  isVisible() { return this.visible }
  getBounds() { return { ...this.bounds } }
  setPosition(x: number, y: number) {
    this.bounds = { ...this.bounds, x, y }
    this.positions.push({ x, y })
  }
  setVisibleOnAllWorkspaces() {}
}

describe('window manager', () => {
  const created: FakeWindow[] = []

  beforeEach(() => {
    created.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createManager(
    isQuitting = false,
    random = () => 0,
    getWorkAreaForBounds = () => ({ x: 0, y: 0, width: 1280, height: 800 }),
    overrides: { devServerUrl?: string; openExternal?: (url: string) => unknown } = {},
  ) {
    return createWindowManager({
      devServerUrl: overrides.devServerUrl,
      isQuitting: () => isQuitting,
      petPreloadPath: '/app/petPreload.mjs',
      preloadPath: '/app/preload.mjs',
      rendererHtmlPath: '/app/index.html',
      browserWindowFactory: (options) => {
        const window = new FakeWindow(options)
        created.push(window)
        return window as never
      },
      getPrimaryWorkArea: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
      getWorkAreaForBounds,
      openExternal: overrides.openExternal,
      random,
    })
  }

  it('creates one main window, restores it, and turns close into hide', () => {
    const manager = createManager()

    manager.showMainWindow()
    manager.showMainWindow()

    expect(created).toHaveLength(1)
    expect(created[0].showCalls).toBe(2)
    expect(created[0].focusCalls).toBe(2)
    expect(created[0].options.webPreferences?.preload).toBe('/app/preload.mjs')
    const preventDefault = vi.fn()
    created[0].events.get('close')?.({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(created[0].hideCalls).toBe(1)
  })

  it('reuses the pet window and loads the pet renderer route without stealing focus', () => {
    const manager = createManager()

    manager.showPetWindow()
    manager.showPetWindow()

    expect(created).toHaveLength(1)
    expect(created[0].showInactiveCalls).toBe(2)
    expect(created[0].focusCalls).toBe(0)
    expect(created[0].options.webPreferences?.preload).toBe('/app/petPreload.mjs')
    expect(created[0].loadFiles).toEqual([{
      path: '/app/index.html',
      options: { query: { window: 'pet' } },
    }])

    manager.hidePetWindow()
    expect(created[0].hideCalls).toBe(1)
  })

  it('recreates a pet window after the previous instance closes', () => {
    const manager = createManager()
    manager.showPetWindow()
    created[0].events.get('closed')?.({ preventDefault() {} })

    manager.showPetWindow()

    expect(created).toHaveLength(2)
  })

  it('opens safe links in the system browser while denying renderer navigation and new windows', () => {
    const openExternal = vi.fn()
    const manager = createManager(false, () => 0, undefined, { openExternal })
    manager.showMainWindow()
    const window = created[0]

    const navigationEvent = { preventDefault: vi.fn() }
    window.webContentsEvents.get('will-navigate')?.(navigationEvent, 'https://example.com/docs?q=1')
    expect(navigationEvent.preventDefault).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs?q=1')

    expect(window.windowOpenHandler?.({ url: 'http://example.com/' })).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledWith('http://example.com/')

    window.webContentsEvents.get('will-navigate')?.(
      { preventDefault: vi.fn() },
      'file:///Users/example/secret.txt',
    )
    expect(window.windowOpenHandler?.({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledTimes(2)

    const redirectEvent = { preventDefault: vi.fn() }
    window.webContentsEvents.get('will-redirect')?.(redirectEvent, 'https://redirect.example/target')
    expect(redirectEvent.preventDefault).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledTimes(2)
  })

  it('trusts only the expected renderer URL for each managed window', () => {
    const manager = createManager()
    manager.showMainWindow()
    manager.showPetWindow()

    expect(manager.isTrustedSender('main', created[0].webContents as never, 'file:///app/index.html')).toBe(true)
    expect(manager.isTrustedSender('pet', created[1].webContents as never, 'file:///app/index.html?window=pet')).toBe(true)
    expect(manager.isTrustedSender('main', created[0].webContents as never, 'https://attacker.example/')).toBe(false)
    expect(manager.isTrustedSender('main', created[1].webContents as never, 'file:///app/index.html')).toBe(false)
    expect(manager.isTrustedSender('pet', created[1].webContents as never, 'file:///app/index.html')).toBe(false)
  })

  it('uses the exact development renderer routes as trusted IPC sources', () => {
    const manager = createManager(false, () => 0, undefined, {
      devServerUrl: 'http://127.0.0.1:5173/?debug=1',
    })
    manager.showMainWindow()
    manager.showPetWindow()

    expect(created[0].loadUrls).toEqual(['http://127.0.0.1:5173/?debug=1'])
    expect(created[1].loadUrls).toEqual(['http://127.0.0.1:5173/?debug=1&window=pet'])
    expect(manager.isTrustedSender(
      'main',
      created[0].webContents as never,
      'http://127.0.0.1:5173/?debug=1#section',
    )).toBe(true)
    expect(manager.isTrustedSender(
      'pet',
      created[1].webContents as never,
      'http://127.0.0.1:5173/?debug=1&window=pet',
    )).toBe(true)
    expect(manager.isTrustedSender(
      'main',
      created[0].webContents as never,
      'http://localhost:5173/?debug=1',
    )).toBe(false)
  })

  it('moves only while walking and pauses after focus', () => {
    vi.useFakeTimers()
    const manager = createManager()
    manager.showPetWindow()

    vi.advanceTimersByTime(50)
    expect(created[0].positions).toEqual([])

    manager.updatePetState('walking')
    vi.advanceTimersByTime(50)
    expect(created[0].positions).toEqual([
      { x: 16, y: 624 },
      { x: 26, y: 624 },
    ])

    created[0].events.get('focus')?.({ preventDefault() {} })
    vi.advanceTimersByTime(4_950)
    expect(created[0].positions).toHaveLength(2)

    vi.advanceTimersByTime(100)
    expect(created[0].positions.length).toBeGreaterThan(2)

    manager.updatePetState('thinking')
    const positionsAfterWalking = created[0].positions.length
    vi.advanceTimersByTime(500)
    expect(created[0].positions).toHaveLength(positionsAfterWalking)
    manager.hidePetWindow()
  })

  it('extends the motion pause while the user keeps dragging', () => {
    vi.useFakeTimers()
    const manager = createManager()
    manager.showPetWindow()
    manager.updatePetState('walking')
    vi.advanceTimersByTime(50)

    created[0].events.get('will-move')?.({ preventDefault() {} })
    vi.advanceTimersByTime(4_950)
    created[0].events.get('will-move')?.({ preventDefault() {} })
    vi.advanceTimersByTime(100)

    expect(created[0].positions).toHaveLength(2)
    vi.advanceTimersByTime(5_000)
    expect(created[0].positions.length).toBeGreaterThan(2)
    manager.hidePetWindow()
  })

  it('moves the pet by validated renderer drag deltas', () => {
    const manager = createManager()
    manager.showPetWindow()

    manager.beginPetDrag()
    manager.dragPetWindowBy(12.4, -7.6)
    manager.dragPetWindowBy(Number.NaN, 10)
    manager.dragPetWindowBy('20', 10)
    manager.dragPetWindowBy(Number.MAX_SAFE_INTEGER, 10)

    expect(created[0].positions).toEqual([{ x: 28, y: 616 }])
  })

  it('keeps manual dragging inside the nearest display work area', () => {
    const manager = createManager(false, () => 0, (bounds) => (
      bounds.x >= 1280
        ? { x: 1280, y: 40, width: 1024, height: 768 }
        : { x: 0, y: 0, width: 1280, height: 800 }
    ))
    manager.showPetWindow()

    manager.dragPetWindowBy(-5_000, -5_000)
    manager.dragPetWindowBy(1_300, 700)

    expect(created[0].positions).toEqual([
      { x: 0, y: 0 },
      { x: 1300, y: 648 },
    ])
  })

  it('randomly walks from right to left', () => {
    vi.useFakeTimers()
    const manager = createManager(false, () => 0.9)
    manager.showPetWindow()
    manager.updatePetState('walking')

    vi.advanceTimersByTime(50)

    expect(created[0].positions).toEqual([
      { x: 1104, y: 624 },
      { x: 1094, y: 624 },
    ])
    manager.hidePetWindow()
  })

  it('stops scheduling movement after reaching the display edge', () => {
    vi.useFakeTimers()
    const manager = createManager()
    manager.showPetWindow()
    manager.updatePetState('walking')

    vi.advanceTimersByTime(6_000)
    const positionsAtEdge = created[0].positions.length

    expect(created[0].positions.at(-1)).toEqual({ x: 1104, y: 624 })
    vi.advanceTimersByTime(1_000)
    expect(created[0].positions).toHaveLength(positionsAtEdge)
    manager.hidePetWindow()
  })

  it('walks inside the display that currently contains the pet', () => {
    vi.useFakeTimers()
    const manager = createManager(false, () => 0, (bounds) => (
      bounds.x >= 1280
        ? { x: 1280, y: 40, width: 1024, height: 768 }
        : { x: 0, y: 0, width: 1280, height: 800 }
    ))
    manager.showPetWindow()
    created[0].bounds = { x: 1400, y: 500, width: 160, height: 160 }

    manager.updatePetState('walking')
    vi.advanceTimersByTime(50)

    expect(created[0].positions).toEqual([
      { x: 1296, y: 632 },
      { x: 1306, y: 632 },
    ])
    manager.hidePetWindow()
  })
})
