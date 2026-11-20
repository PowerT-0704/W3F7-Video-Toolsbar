import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopAPI } from '../src/bridge'

const api: DesktopAPI = {
  pick: (kind) => ipcRenderer.invoke('assets:pick', kind),
  drop: (files) => ipcRenderer.invoke('assets:drop', files.map((file) => webUtils.getPathForFile(file))),
  inspect: (id) => ipcRenderer.invoke('assets:inspect', id),
  settings: () => ipcRenderer.invoke('settings:get'),
  setReducedMotion: (enabled) => ipcRenderer.invoke('settings:motion', enabled),
  setTheme: (theme) => ipcRenderer.invoke('settings:theme', theme),
  previewTitleBar: (tone) => ipcRenderer.invoke('settings:preview-title-bar', tone),
  chooseDirectory: (setting) => ipcRenderer.invoke('settings:choose', setting),
  resetDirectory: (setting) => ipcRenderer.invoke('settings:reset', setting),
  cacheStatus: () => ipcRenderer.invoke('cache:status'),
  chooseCacheDirectory: () => ipcRenderer.invoke('cache:choose'),
  resetCacheDirectory: () => ipcRenderer.invoke('cache:reset'),
  openCacheDirectory: () => ipcRenderer.invoke('cache:open'),
  clearMediaCache: () => ipcRenderer.invoke('cache:clear'),
  detect: () => ipcRenderer.invoke('settings:detect'),
  completeWelcome: () => ipcRenderer.invoke('welcome:complete'),
  openAnimationSettings: () => ipcRenderer.invoke('settings:windows-animation'),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  openUpdate: () => ipcRenderer.invoke('updates:open'),
  extractFrame: (videoId, time, presented) => ipcRenderer.invoke('frame:extract', videoId, time, presented),
  cancelFrame: (videoId) => ipcRenderer.invoke('frame:cancel', videoId),
  useFrame: (id) => ipcRenderer.invoke('frame:use', id),
  saveFrame: (id) => ipcRenderer.invoke('frame:save', id),
  exportCover: (video, cover, mode) => ipcRenderer.invoke('cover:export', video, cover, mode),
  pickMusic: () => ipcRenderer.invoke('music:pick'),
  pickMusicLyric: (audio) => ipcRenderer.invoke('music:pick-lyric', audio),
  dropMusic: (files) => ipcRenderer.invoke('music:drop', files.map((file) => webUtils.getPathForFile(file))),
  pickMusicCover: (audio) => ipcRenderer.invoke('music:pick-cover', audio),
  cancelMusicCoverPick: (audio, image) => ipcRenderer.invoke('music:cancel-cover-pick', audio, image),
  prepareMusicCover: (audio, image, crop) => ipcRenderer.invoke('music:prepare-cover', audio, image, crop),
  discardMusicCover: (audio) => ipcRenderer.invoke('music:discard-cover', audio),
  discardMusicLyric: (audio) => ipcRenderer.invoke('music:discard-lyric', audio),
  saveMusicCover: (audio, index) => ipcRenderer.invoke('music:save-cover', audio, index),
  saveMusicLyric: (audio, index) => ipcRenderer.invoke('music:save-lyric', audio, index),
  exportMusic: (audio, changes) => ipcRenderer.invoke('music:export', audio, changes),
  revealMusic: (audio) => ipcRenderer.invoke('music:reveal', audio),
  onProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, percent: number) => callback(percent)
    ipcRenderer.on('cover:progress', listener)
    return () => ipcRenderer.removeListener('cover:progress', listener)
  },
  revealOutput: () => ipcRenderer.invoke('cover:reveal'),
  openLink: (id) => ipcRenderer.invoke('links:open', id),
}
contextBridge.exposeInMainWorld('videoTools', api)
