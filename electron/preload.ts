import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getBackendUrl() {
    return ipcRenderer.invoke('backend:get-url') as Promise<string>
  },
  getDefaultWorkspacePath() {
    return ipcRenderer.invoke('workspace:get-default-path') as Promise<string>
  },
  getHomePath() {
    return ipcRenderer.invoke('workspace:get-home-path') as Promise<string>
  },
  openWorkspaceFolder(folderPath: string) {
    return ipcRenderer.invoke('workspace:open-folder', folderPath) as Promise<string>
  },
  selectWorkspaceFolder() {
    return ipcRenderer.invoke('workspace:select-folder') as Promise<string>
  },
  updateTaskSummary(summary: { known: boolean; activeTaskCount: number; hasUnsavedSettings: boolean }) {
    ipcRenderer.send('runtime:update-task-summary', summary)
  },
  showPet() {
    ipcRenderer.send('pet:show')
  },
}

contextBridge.exposeInMainWorld('piDesktop', api)

export type PiDesktopApi = typeof api
