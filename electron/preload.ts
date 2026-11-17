import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopAPI } from '../src/bridge'

const api: DesktopAPI = {
  pick: (kind) => ipcRenderer.invoke('assets:pick', kind),
  drop: (files) => ipcRenderer.invoke('assets:drop', files.map((file) => webUtils.getPathForFile(file))),
  inspect: (id) => ipcRenderer.invoke('assets:inspect', id),
  settings: () => ipcRenderer.invoke('settings:get'),
  setReducedMotion: (enabled) => ipcRenderer.invoke('settings:motion', enabled),
  setTheme: (theme) => ipcRenderer.invoke('settings:theme', theme),
  chooseDirectory: (setting) => ipcRenderer.invoke('settings:choose', setting),
  resetDirectory: (setting) => ipcRenderer.invoke('settings:reset', setting),
  detect: () => ipcRenderer.invoke('settings:detect'),
  exportCover: (video, cover) => ipcRenderer.invoke('cover:export', video, cover),
  onProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, percent: number) => callback(percent)
    ipcRenderer.on('cover:progress', listener)
    return () => ipcRenderer.removeListener('cover:progress', listener)
  },
  revealOutput: () => ipcRenderer.invoke('cover:reveal'),
  openLink: (id) => ipcRenderer.invoke('links:open', id),
}
contextBridge.exposeInMainWorld('videoTools', api)
