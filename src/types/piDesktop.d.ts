import type { PiDesktopApi } from '../../electron/preload'
import type { PiPetApi } from '../../electron/petPreload'

declare global {
  interface Window {
    piDesktop: PiDesktopApi
    piPet: PiPetApi
  }
}

export {}
