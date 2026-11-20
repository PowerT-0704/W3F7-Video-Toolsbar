import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { DesktopAPI } from '../src/bridge'

const api: DesktopAPI = {
  transcription: {
    pick: (type) => ipcRenderer.invoke('caption:pick', type),
    drop: (files) => ipcRenderer.invoke('caption:drop', files.map((file) => webUtils.getPathForFile(file))),
    choose: (kind) => ipcRenderer.invoke('caption:choose', kind),
    preview: (id) => ipcRenderer.invoke('caption:preview', id),
    tasks: () => ipcRenderer.invoke('caption:tasks'),
    create: (inputs, options) => ipcRenderer.invoke('caption:create', inputs, options),
    cancel: (id) => ipcRenderer.invoke('caption:cancel', id),
    retry: (id) => ipcRenderer.invoke('caption:retry', id),
    remove: (target) => ipcRenderer.invoke('caption:remove', target),
    edit: (id, revision, cues) => ipcRenderer.invoke('caption:edit', id, revision, cues),
    translate: (id, rows) => ipcRenderer.invoke('caption:translate', id, rows),
    finish: (id, output) => ipcRenderer.invoke('caption:finish', id, output),
    export: (id, formats, layout) => ipcRenderer.invoke('caption:export', id, formats, layout),
    reveal: (id) => ipcRenderer.invoke('caption:reveal', id),
    settings: () => ipcRenderer.invoke('caption:settings'),
    save: (settings) => ipcRenderer.invoke('caption:save', settings),
    listPresets: () => ipcRenderer.invoke('caption:presets-list'),
    savePreset: (name, options, replaceId) => ipcRenderer.invoke('caption:presets-save', name, options, replaceId),
    removePreset: (id) => ipcRenderer.invoke('caption:presets-remove', id),
    testModel: () => ipcRenderer.invoke('caption:test-model'),
    checkProgram: (engine) => ipcRenderer.invoke('caption:check-program', engine),
    cacheStatus: () => ipcRenderer.invoke('caption:cache-status'),
    chooseCache: () => ipcRenderer.invoke('caption:cache-choose'),
    resetCache: () => ipcRenderer.invoke('caption:cache-reset'),
    openCache: () => ipcRenderer.invoke('caption:cache-open'),
    clearCache: () => ipcRenderer.invoke('caption:cache-clear'),
    onTask: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, task: Parameters<typeof callback>[0]) => callback(task)
      ipcRenderer.on('caption:task', listener)
      return () => ipcRenderer.removeListener('caption:task', listener)
    },
    onTaskRemoved: (callback) => {
      const listener = (_: IpcRendererEvent, id: string) => callback(id)
      ipcRenderer.on('caption:task-removed', listener)
      return () => ipcRenderer.removeListener('caption:task-removed', listener)
    },
  },
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
