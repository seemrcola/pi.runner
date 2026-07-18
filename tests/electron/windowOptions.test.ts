import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createMainWindowOptions, createPetWindowOptions, PET_WINDOW_SIZE } from '../../electron/windowOptions'

describe('main window appearance', () => {
  it('uses a hidden macOS title bar over the dark app background', () => {
    const options = createMainWindowOptions({
      preloadPath: '/tmp/preload.mjs',
    })

    expect(options.titleBarStyle).toBe('hiddenInset')
    expect(options.backgroundColor).toBe('#0f1115')
    expect(options.title).toBe('Pi RUNNER')
  })

  it('keeps the E2E minimum viewport aligned with the main window constraints', () => {
    const options = createMainWindowOptions({
      preloadPath: '/tmp/preload.mjs',
    })
    const acceptance = readFileSync(new URL('../../docs/E2E_ACCEPTANCE.md', import.meta.url), 'utf8')

    expect(options.minWidth).toBe(860)
    expect(options.minHeight).toBe(560)
    expect(acceptance).toContain('最小支持尺寸 860x560')
  })

  it('places a fixed transparent pet window inside the primary work area', () => {
    const options = createPetWindowOptions({
      preloadPath: '/tmp/preload.mjs',
      workArea: { x: 10, y: 20, width: 1440, height: 900 },
    })

    expect(options).toMatchObject({
      width: PET_WINDOW_SIZE,
      height: PET_WINDOW_SIZE,
      x: 26,
      y: 744,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
    })
    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      preload: '/tmp/preload.mjs',
    })
  })
})
