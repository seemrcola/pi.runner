import { contextBridge, ipcRenderer } from 'electron'
import type { PetState } from '../src/features/desktop-pet/core/petTypes.js'

// 宠物窗口使用独立 preload，避免透明轻量窗口继承 backend、文件系统和任务状态能力。
const api = {
  beginDrag() {
    ipcRenderer.send('pet:drag-start')
  },
  dragBy(deltaX: number, deltaY: number) {
    ipcRenderer.send('pet:drag-move', deltaX, deltaY)
  },
  hide() {
    ipcRenderer.send('pet:hide')
  },
  updateState(state: PetState) {
    ipcRenderer.send('pet:update-state', state)
  },
}

contextBridge.exposeInMainWorld('piPet', api)

export type PiPetApi = typeof api
