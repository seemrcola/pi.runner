import type { BrowserWindowConstructorOptions, Rectangle } from 'electron'

type MainWindowOptionsInput = {
  iconPath?: string
  preloadPath: string
}

type PetWindowOptionsInput = MainWindowOptionsInput & {
  workArea: Rectangle
}

export const PET_WINDOW_SIZE = 160
export const PET_WINDOW_SCREEN_MARGIN = 16

function secureWebPreferences(preloadPath: string): Electron.WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
  }
}

export function createMainWindowOptions({
  iconPath,
  preloadPath,
}: MainWindowOptionsInput): BrowserWindowConstructorOptions {
  return {
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    title: 'Pi RUNNER',
    backgroundColor: '#0f1115',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: secureWebPreferences(preloadPath),
  }
}

export function createPetWindowOptions({
  iconPath,
  preloadPath,
  workArea,
}: PetWindowOptionsInput): BrowserWindowConstructorOptions {
  return {
    width: PET_WINDOW_SIZE,
    height: PET_WINDOW_SIZE,
    x: Math.round(workArea.x + PET_WINDOW_SCREEN_MARGIN),
    y: Math.round(workArea.y + workArea.height - PET_WINDOW_SIZE - PET_WINDOW_SCREEN_MARGIN),
    title: 'Pi 桌面宠物',
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: secureWebPreferences(preloadPath),
  }
}
