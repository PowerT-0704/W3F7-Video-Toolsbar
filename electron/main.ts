import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { stat, readFile, writeFile, rename, copyFile, rm } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import type { Asset, AssetKind, MusicExport, Preferences, SquareCrop, Theme, ToolCheck, ToolStatus, VideoCoverMode, VideoDetails } from '../src/bridge'
import { FrameStore, streamLocalMedia } from './frames.cjs'
import { MediaCache } from './media-cache.cjs'
import { MusicWorkspace } from './music.cjs'
import { MusicArtwork } from './music-artwork.cjs'
import { createUpdateChecker } from './updates.cjs'
import { CaptionConfiguration } from './caption-settings.cjs'
import { mediaExtensions, subtitleExtensions } from './caption-media.cjs'
import { renderCaptionOverlay } from './caption-canvas.cjs'
import { TranscriptionWorkspace } from './transcription.cjs'
import type { CaptionPicker } from '../src/transcription'

type DirectorySetting = 'toolDirectory' | 'outputDirectory'
type CoreRequest =
  | { operation: 'detect' }
  | { operation: 'inspect'; video: string }
  | { operation: 'export'; video: string; cover: string; outputDirectory: string; mode: VideoCoverMode }

const defaultPreferences: Preferences = { toolDirectory: '', outputDirectory: '', cacheDirectory: '', reduceMotion: false, theme: 'dark', welcomeSeen: false }
const titleBars: Record<Theme, { color: string; symbolColor: string; height: number }> = {
  dark: { color: '#0a0a0a', symbolColor: '#d4d4d4', height: 40 },
  light: { color: '#f3f3f6', symbolColor: '#262630', height: 40 },
}
const transparentTitleBar = '#00000000'
const links = {
  website: "https://w3f7.cn",
  bilibili: "https://space.bilibili.com/1135924891?spm_id_from=333.1007.0.0",
  qq: "http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=h-stGncQWM6yJbRpfqHG6J8JI45h9fBm&authKey=Vzm7clWrhmbi0JbPa2CjYRDl98VXcmW9Bfhg5nRqZC0QB1oPfK0knINTzvFnMzTd&noverify=0&group_code=934019491",
  shadcn: 'https://github.com/shadcn-ui/ui',
  magicui: 'https://github.com/magicuidesign/magicui',
  reactbits: 'https://github.com/DavidHDev/react-bits',
  github: 'https://github.com/PowerT-0704',
  ezqr: 'https://github.com/PowerT-0704/EzQR-Tools',
  campuslink: 'https://github.com/PowerT-0704/CampusLink',
  ffmpeg: 'https://ffmpeg.org/download.html#build-windows',
  icaros: 'https://github.com/Xanashi/Icaros#thumbnailing-options',
} as const
const extensions = { video: ['mp4'], cover: ['png', 'jpg', 'jpeg'] }
let preferences = defaultPreferences
let appWindow: BrowserWindow | null = null
let previewTitleBarTone: Theme | null = null
let shownTitleBarTone: Theme | undefined
let lastOutput = ''
let exporting = false
let preferenceWrites = Promise.resolve()
const selected = new Map<AssetKind, Asset>()
let selectionRevision = 0
let frameRequest = 0
let frameAction = false
let musicBusy = false
let cacheBusy = false
let videoDetails: { id: string; info: VideoDetails } | undefined
let frameTools: { directory: string; tools?: ToolStatus } | undefined
const mediaCache = new MediaCache(app.getPath('userData'))
const frames = new FrameStore(mediaCache)
const music = new MusicWorkspace()
const musicArtwork = new MusicArtwork()
const updates = createUpdateChecker(app.getVersion(), (url, options) => net.fetch(url, options))
const chosenCaptionPaths = new Map<CaptionPicker, Set<string>>()
const captionConfiguration = new CaptionConfiguration(join(app.getPath('userData'), 'transcription', 'settings.json'), safeStorage, (path) => {
  if (!(['program', 'model', 'model-directory'] as const).some((type) => chosenCaptionPaths.get(type)?.has(path))) {
    throw new Error('请通过文件选择器选择外置程序或模型。')
  }
})
const captions = new TranscriptionWorkspace({
  dataDirectory: app.getPath('userData'), settings: captionConfiguration,
  tools: requireMediaTools, outputDirectory: () => preferences.outputDirectory,
  authorize: (path, kind) => {
    if (!chosenCaptionPaths.get(kind)?.has(path)) throw new Error('请通过文件选择器选择输出目录或字体。')
  },
  notify: (task) => { if (appWindow && !appWindow.isDestroyed()) appWindow.webContents.send('caption:task', task) },
  notifyRemoved: (id) => { if (appWindow && !appWindow.isDestroyed()) appWindow.webContents.send('caption:task-removed', id) },
  render: renderCaptionOverlay,
})

protocol.registerSchemesAsPrivileged([
  { scheme: 'w3f7-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

function applyTitleBarTone() {
  const theme = previewTitleBarTone ?? preferences.theme
  if (!appWindow || shownTitleBarTone === theme) return
  const { symbolColor, height } = titleBars[theme]
  appWindow.setTitleBarOverlay({ color: transparentTitleBar, symbolColor, height })
  shownTitleBarTone = theme
}

function preferencesPath() {
  return join(app.getPath('userData'), 'preferences.json')
}

async function loadPreferences() {
  try {
    const saved = JSON.parse(await readFile(preferencesPath(), 'utf8'))
    preferences = {
      toolDirectory: typeof saved.toolDirectory === 'string' && isAbsolute(saved.toolDirectory) ? saved.toolDirectory : '',
      outputDirectory: typeof saved.outputDirectory === 'string' && isAbsolute(saved.outputDirectory) ? saved.outputDirectory : '',
      cacheDirectory: typeof saved.cacheDirectory === 'string' && isAbsolute(saved.cacheDirectory) ? saved.cacheDirectory : '',
      reduceMotion: saved.reduceMotion === true,
      theme: saved.theme === 'light' ? 'light' : 'dark',
      welcomeSeen: saved.welcomeSeen === true,
    }
  } catch {
    preferences = defaultPreferences
  }
}

async function savePreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
  const write = preferenceWrites.then(async () => {
    const next = { ...preferences, [key]: value }
    const path = preferencesPath()
    await writeFile(path + '.tmp', JSON.stringify(next, null, 2), 'utf8')
    await rename(path + '.tmp', path)
    preferences = next
  })
  preferenceWrites = write.catch(() => {})
  await write
  return preferences
}

function runCore<T>(request: CoreRequest, onProgress?: (percent: number) => void, toolDirectory = preferences.toolDirectory): Promise<T> {
  const resources = app.isPackaged ? process.resourcesPath : app.getAppPath()
  const script = join(resources, 'core', 'cover.ps1')
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Json'], {
      cwd: dirname(script),
      windowsHide: true,
      env: { ...process.env, W3F7_MEDIA_REQUEST: JSON.stringify({ ...request, toolDirectory }) },
    })
    let result: T | undefined
    let errorMessage = ''
    let stderr = ''
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      try {
        const event = JSON.parse(line)
        if (event.type === 'result') result = event as T
        if (event.type === 'error') errorMessage = event.message
        if (event.type === 'progress') onProgress?.(event.percent)
      } catch {
        errorMessage = '无法读取封装核心的运行结果。'
      }
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-3000) })
    child.once('error', reject)
    child.once('close', (code) => {
      lines.close()
      if (code === 0 && result !== undefined && !errorMessage) resolve(result)
      else reject(new Error(errorMessage || stderr.trim() || '封装核心异常退出。'))
    })
  })
}

async function checkTools(): Promise<ToolCheck> {
  const directory = preferences.toolDirectory
  async function probe(path: string) {
    try { return { tools: await runCore<ToolStatus>({ operation: 'detect' }, undefined, path) } }
    catch (error) { return { message: error instanceof Error ? error.message : String(error) } }
  }
  const pathProbe = probe('')
  const [path, effective] = await Promise.all([pathProbe, directory ? probe(directory) : pathProbe])
  if (directory === preferences.toolDirectory) frameTools = { directory, tools: effective.tools }
  return { inPath: Boolean(path.tools), ...effective }
}

async function requireMediaTools() {
  const tools = frameTools?.directory === preferences.toolDirectory ? frameTools.tools : (await checkTools()).tools
  if (!tools) throw new Error('请先配置 FFmpeg 和 FFprobe。')
  return tools
}

async function withMusic<T>(action: () => Promise<T>) {
  if (musicBusy) throw new Error('请等待当前音乐操作完成。')
  musicBusy = true
  try { return await action() }
  finally { musicBusy = false }
}

async function selectMusic(paths: unknown) {
  const result = await music.select(paths, requireMediaTools)
  musicArtwork.selectAudio(result.audio.id)
  return result
}

async function musicSavePath(source: string, suffix: string, extension: string, title: string, label: string) {
  const name = basename(source, extname(source)) + suffix + '.' + extension
  const result = await dialog.showSaveDialog(appWindow!, {
    title, defaultPath: join(preferences.outputDirectory || dirname(source), name),
    filters: [{ name: label, extensions: [extension] }],
  })
  return result.canceled || !result.filePath ? null : result.filePath
}

async function inspectVideo(id: string) {
  const asset = requireAsset('video', id)
  if (videoDetails?.id === id) return videoDetails.info
  const info = await runCore<VideoDetails>({ operation: 'inspect', video: asset.path })
  if (selected.get('video')?.id === id) videoDetails = { id, info }
  return info
}

function clearGeneratedCover() {
  const previous = selected.get('cover')
  if (!previous?.frameSource) return
  selected.delete('cover')
  mediaCache.remove(previous.path)
}

function activeCachePaths() {
  const paths = new Set<string>()
  const cover = selected.get('cover')
  if (frames.activePath) paths.add(frames.activePath)
  if (cover?.frameSource) paths.add(cover.path)
  return paths
}

async function withCache<T>(action: () => Promise<T>) {
  if (cacheBusy || exporting || frameAction) throw new Error('请等待当前媒体操作完成后再管理缓存。')
  cacheBusy = true
  frameRequest++
  try {
    await frames.waitForPending()
    await mediaCache.waitForRemovals()
    return await action()
  } finally { cacheBusy = false }
}

async function moveCache(directory: string) {
  const result = await mediaCache.migrate(directory, activeCachePaths(), () => savePreference('cacheDirectory', directory), (paths) => {
    frames.relocate(paths)
    const cover = selected.get('cover')
    const destination = cover?.frameSource && paths.get(cover.path)
    if (cover && destination) cover.path = destination
  })
  return { ...result, preferences }
}

async function takeAsset(path: string): Promise<Asset> {
  const ext = extname(path).slice(1).toLowerCase()
  const kind = (Object.keys(extensions) as AssetKind[]).find((key) => extensions[key].includes(ext))
  if (!kind || !isAbsolute(path)) throw new Error('请选择 MP4 视频或 PNG、JPG、JPEG 封面。')
  const info = await stat(path)
  if (!info.isFile() || info.size === 0) throw new Error('所选文件为空或无法读取。')
  const id = randomUUID()
  return { id, kind, name: basename(path), path, bytes: info.size, preview: `w3f7-media://${kind}/${id}` }
}

async function selectFiles(paths: unknown) {
  if (exporting || frameAction || cacheBusy) throw new Error('请在当前操作完成后更换素材。')
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 2 || !paths.every((item) => typeof item === 'string')) {
    throw new Error('请拖入一个 MP4 视频或一张封面，也可以同时拖入这两个文件。')
  }
  const revision = ++selectionRevision
  const assets = await Promise.all(paths.map(takeAsset))
  if (assets.length === 2 && assets[0].kind === assets[1].kind) {
    throw new Error('请同时拖入一个 MP4 视频和一张封面。')
  }
  if (revision !== selectionRevision || exporting || frameAction || cacheBusy) throw new Error('素材状态已变化，请重新选择。')
  if (assets.some((asset) => asset.kind === 'video')) {
    frameRequest++
    frames.reset()
    videoDetails = undefined
  }
  clearGeneratedCover()
  for (const asset of assets) selected.set(asset.kind, asset)
  return assets
}

function requireAsset(kind: AssetKind, id: unknown) {
  const asset = selected.get(kind)
  if (!asset || asset.id !== id) throw new Error('请重新选取素材。')
  return asset
}

function requireDirectorySetting(setting: unknown): DirectorySetting {
  if (setting === 'toolDirectory' || setting === 'outputDirectory') return setting
  throw new Error('未知目录设置。')
}

function handle<Args extends unknown[], Result>(channel: string, handler: (...args: Args) => Result) {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: Args) => {
    const contents = appWindow?.webContents
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) {
      throw new Error('该请求只能从工具窗口发出。')
    }
    return handler(...args)
  })
}

function registerHandlers() {
  handle('caption:pick', async (kind: 'media' | 'subtitle') => {
    if (kind !== 'media' && kind !== 'subtitle') throw new Error('请选择媒体或字幕。')
    const result = await dialog.showOpenDialog(appWindow!, {
      title: kind === 'media' ? '选择音频或视频' : '选择字幕文件',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: kind === 'media' ? '音频和视频' : '字幕', extensions: kind === 'media' ? mediaExtensions : subtitleExtensions }],
    })
    return result.canceled ? { assets: [], errors: [] } : captions.importPaths(result.filePaths)
  })
  handle('caption:drop', (paths) => captions.importPaths(paths))
  handle('caption:choose', async (kind: CaptionPicker) => {
    const options: Record<CaptionPicker, { title: string; extensions?: string[] }> = {
      output: { title: '选择字幕任务输出目录' },
      program: { title: '选择已下载的 Whisper 程序', extensions: ['exe'] },
      model: { title: '选择已下载的模型文件', extensions: ['bin', 'gguf', 'onnx'] },
      'model-directory': { title: '选择已下载的模型目录' },
      font: { title: '选择字幕字体', extensions: ['ttf', 'otf'] },
    }
    if (!Object.hasOwn(options, kind)) throw new Error('未知选择类型。')
    const { title, extensions } = options[kind]
    const result = await dialog.showOpenDialog(appWindow!, {
      title, properties: [extensions ? 'openFile' : 'openDirectory'],
      filters: extensions ? [{ name: title, extensions }] : undefined,
    })
    const path = result.canceled ? undefined : result.filePaths[0]
    if (!path) return null
    if (!chosenCaptionPaths.has(kind)) chosenCaptionPaths.set(kind, new Set())
    chosenCaptionPaths.get(kind)!.add(path)
    return path
  })
  handle('caption:preview', (id: string) => captions.preview(id))
  handle('caption:tasks', () => captions.tasks())
  handle('caption:create', (inputs, options) => captions.create(inputs, options))
  handle('caption:cancel', (id?: string) => captions.cancel(id))
  handle('caption:retry', (id: string) => captions.retry(id))
  handle('caption:remove', (target: string | string[]) => captions.remove(target))
  handle('caption:edit', (...args: Parameters<typeof captions.edit>) => captions.edit(...args))
  handle('caption:translate', (...args: Parameters<typeof captions.translate>) => captions.translate(...args))
  handle('caption:finish', (...args: Parameters<typeof captions.finish>) => captions.finish(...args))
  handle('caption:export', (...args: Parameters<typeof captions.export>) => captions.export(...args))
  handle('caption:reveal', (id: string) => {
    const path = captions.locate(id)
    if (!path) throw new Error('找不到成品。')
    shell.showItemInFolder(path)
  })
  handle('caption:settings', () => captionConfiguration.settings())
  handle('caption:save', (value: Parameters<typeof captionConfiguration.save>[0]) => captionConfiguration.save(value))
  handle('caption:presets-list', () => captions.listPresets())
  handle('caption:presets-save', (...args: Parameters<typeof captions.savePreset>) => captions.savePreset(...args))
  handle('caption:presets-remove', (id: string) => captions.removePreset(id))
  handle('caption:test-model', () => captions.testModel())
  handle('caption:check-program', (engine: Parameters<typeof captions.checkProgram>[0]) => captions.checkProgram(engine))
  handle('caption:cache-status', () => captions.cacheStatus())
  handle('caption:cache-choose', async () => {
    if (!appWindow) return null
    const result = await dialog.showOpenDialog(appWindow, {
      title: '选择转录缓存位置', properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled || !result.filePaths[0] ? null : captions.changeCache(result.filePaths[0])
  })
  handle('caption:cache-reset', () => captions.changeCache(''))
  handle('caption:cache-open', async () => {
    const result = await shell.openPath((await captions.cacheStatus()).directory)
    if (result) throw new Error(result)
  })
  handle('caption:cache-clear', () => captions.clearCache())

  handle('assets:pick', async (kind: AssetKind) => {
    if (kind !== 'video' && kind !== 'cover') throw new Error('未知素材类型。')
    const existing = selected.get(kind)
    const companion = selected.get(kind === 'video' ? 'cover' : 'video')
    const result = await dialog.showOpenDialog(appWindow!, {
      title: kind === 'video' ? '选择 MP4 视频' : '选择封面图片',
      defaultPath: existing?.path || (companion ? dirname(companion.path) : undefined),
      properties: ['openFile'],
      filters: [{ name: kind === 'video' ? 'MP4 视频' : '封面图片', extensions: extensions[kind] }],
    })
    return result.canceled ? null : (await selectFiles(result.filePaths))[0]
  })
  handle('assets:drop', selectFiles)
  handle('assets:inspect', inspectVideo)

  handle('settings:get', () => preferences)
  handle('settings:motion', (enabled: boolean) => savePreference('reduceMotion', enabled === true))
  handle('settings:preview-title-bar', (tone: unknown) => {
    if (tone !== null && tone !== 'dark' && tone !== 'light') throw new Error('未知标题栏配色。')
    previewTitleBarTone = tone
    applyTitleBarTone()
  })
  handle('settings:theme', async (theme: unknown) => {
    if (theme !== 'dark' && theme !== 'light') throw new Error('未知外观主题。')
    const saved = await savePreference('theme', theme)
    const titleBar = titleBars[saved.theme]
    appWindow?.setBackgroundColor(titleBar.color)
    applyTitleBarTone()
    return saved
  })
  handle('settings:choose', async (key: unknown) => {
    const setting = requireDirectorySetting(key)
    const result = await dialog.showOpenDialog(appWindow!, {
      title: setting === 'toolDirectory' ? '选择 FFmpeg 的 bin 文件夹' : '选择成品输出文件夹',
      defaultPath: preferences[setting] || undefined,
      properties: ['openDirectory'],
    })
    return result.canceled ? preferences : savePreference(setting, result.filePaths[0])
  })
  handle('settings:reset', (key: unknown) => savePreference(requireDirectorySetting(key), ''))
  handle('cache:status', () => mediaCache.status(activeCachePaths()))
  handle('cache:choose', async () => {
    const result = await dialog.showOpenDialog(appWindow!, {
      title: '选择媒体缓存位置', defaultPath: preferences.cacheDirectory || undefined,
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled || !result.filePaths[0] ? null : withCache(() => moveCache(result.filePaths[0]))
  })
  handle('cache:reset', () => withCache(() => moveCache('')))
  handle('cache:open', async () => {
    const message = await shell.openPath(await mediaCache.openPath())
    if (message) throw new Error(message)
  })
  handle('cache:clear', () => withCache(() => mediaCache.clear(activeCachePaths())))
  handle('settings:detect', checkTools)
  handle('welcome:complete', () => savePreference('welcomeSeen', true))
  handle('settings:windows-animation', () => shell.openExternal('ms-settings:easeofaccess-visualeffects'))
  handle('updates:check', updates.check)
  handle('updates:open', async () => {
    const page = updates.page()
    if (page) await shell.openExternal(page)
  })

  handle('frame:extract', async (videoId: string, time: unknown, presented: unknown) => {
    if (frameAction || exporting || cacheBusy) throw new Error('请等待当前操作完成。')
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) throw new Error('无效的视频定位时间。')
    const video = requireAsset('video', videoId)
    const request = ++frameRequest
    const tools = await requireMediaTools()
    const details = await inspectVideo(videoId)
    if (request !== frameRequest || frameAction || exporting || cacheBusy) throw new Error('已取消旧的取帧请求。')
    return frames.extract(tools.ffmpeg, video, details, time, presented === true)
  })
  handle('frame:cancel', (videoId: string) => {
    if (selected.get('video')?.id !== videoId || frameAction || cacheBusy) return
    frameRequest++
    frames.cancelPending()
  })

  async function withFrame<T>(id: string, action: (path: string, video: Asset, time: number) => Promise<T>) {
    if (frameAction || exporting || cacheBusy) throw new Error('请等待当前操作完成。')
    const frame = frames.get(id)
    if (!frame) throw new Error('请重新定位视频帧。')
    const video = requireAsset('video', frame.videoId)
    frameAction = true
    // Keep this snapshot available while the save dialog is open.
    frameRequest++
    frames.cancelPending()
    try { return await action(frame.path, video, frame.time) }
    finally { frameAction = false }
  }

  function frameName(video: Asset, time: number) {
    return `${basename(video.name, extname(video.name))}_frame_${Math.round(time * 1000)}ms.png`
  }

  handle('frame:use', (id: string) => withFrame(id, async (source, video, time) => {
    const path = await mediaCache.tempPath()
    try {
      await copyFile(source, path)
      const cover = { ...await takeAsset(path), name: frameName(video, time), frameSource: video.id }
      clearGeneratedCover()
      selected.set('cover', cover)
      lastOutput = ''
      return cover
    } catch (error) {
      await rm(path, { force: true }).catch(() => {})
      throw error
    }
  }))
  handle('frame:save', (id: string) => withFrame(id, async (source, video, time) => {
    const result = await dialog.showSaveDialog(appWindow!, {
      title: '导出当前帧', defaultPath: join(dirname(video.path), frameName(video, time)),
      filters: [{ name: 'PNG 图像', extensions: ['png'] }],
    })
    if (result.canceled || !result.filePath) return false
    if (extname(result.filePath).toLowerCase() !== '.png') throw new Error('请选择 .png 文件名。')
    const temporary = join(dirname(result.filePath), `.w3f7-frame-${randomUUID()}.tmp`)
    try {
      await copyFile(source, temporary)
      await rename(temporary, result.filePath)
    } finally { await rm(temporary, { force: true }).catch(() => {}) }
    return true
  }))

  handle('cover:export', async (videoId: string, coverId: string, mode: unknown = 'embedded') => {
    if (exporting || frameAction || cacheBusy) throw new Error('请等待当前操作完成。')
    if (mode !== 'embedded' && mode !== 'first-frame' && mode !== 'both') throw new Error('请选择有效的封面方式。')
    const video = requireAsset('video', videoId)
    const cover = requireAsset('cover', coverId)
    exporting = true
    lastOutput = ''
    try {
      const result = await runCore<{ path: string }>({
        operation: 'export', video: video.path, cover: cover.path, mode,
        outputDirectory: preferences.outputDirectory || dirname(video.path),
      }, (percent) => {
        if (appWindow && !appWindow.isDestroyed()) appWindow.webContents.send('cover:progress', percent)
      })
      lastOutput = result.path
      return result
    } finally {
      exporting = false
    }
  })
  handle('cover:reveal', () => { if (lastOutput) shell.showItemInFolder(lastOutput) })

  handle('music:pick', () => withMusic(async () => {
    const result = await dialog.showOpenDialog(appWindow!, {
      title: '选择音频', properties: ['openFile'], filters: [{ name: 'FLAC 和 MP3', extensions: ['flac', 'mp3'] }],
    })
    return result.canceled ? null : selectMusic(result.filePaths)
  }))
  handle('music:pick-lyric', (id: string) => withMusic(async () => {
    const result = await dialog.showOpenDialog(appWindow!, {
      title: '导入歌词', defaultPath: dirname(music.sourcePath(id)), properties: ['openFile'],
      filters: [{ name: 'LRC 歌词', extensions: ['lrc'] }],
    })
    return result.canceled ? null : selectMusic(result.filePaths)
  }))
  handle('music:drop', (paths: unknown) => withMusic(() => selectMusic(paths)))
  handle('music:pick-cover', (id: string) => withMusic(async () => {
    music.checkCoverEdit(id)
    const result = await dialog.showOpenDialog(appWindow!, {
      title: '重选封面', defaultPath: dirname(music.sourcePath(id)), properties: ['openFile'],
      filters: [{ name: '封面图片', extensions: ['jpg', 'jpeg', 'png'] }],
    })
    return result.canceled ? null : musicArtwork.pick(id, result.filePaths[0])
  }))
  handle('music:cancel-cover-pick', (id: string, candidate: string) => { musicArtwork.cancel(id, candidate) })
  handle('music:prepare-cover', (id: string, candidate: string, crop: SquareCrop) => withMusic(async () => {
    music.checkCoverEdit(id)
    const { name, picture } = musicArtwork.prepare(id, candidate, crop)
    return music.stageCover(id, name, picture)
  }))
  handle('music:discard-cover', (id: string) => withMusic(async () => music.discardCover(id)))
  handle('music:discard-lyric', (id: string) => withMusic(async () => music.discardLyric(id)))
  handle('music:save-cover', (id: string, index: number) => withMusic(async () => {
    const { extension, suffix } = music.cover(id, index)
    const path = await musicSavePath(music.sourcePath(id), suffix, extension, '另存封面', '封面原图')
    if (!path) return false
    await music.saveCover(id, index, path)
    return true
  }))
  handle('music:save-lyric', (id: string, index: number) => withMusic(async () => {
    music.lyric(id, index)
    const path = await musicSavePath(music.sourcePath(id), '', 'lrc', '导出内嵌歌词', 'LRC 歌词')
    if (!path) return false
    await music.saveLyric(id, index, path)
    return true
  }))
  handle('music:export', (id: string, changes: MusicExport) => withMusic(async () => {
    const { audio, suffix } = music.requireExport(id, changes)
    const path = await musicSavePath(audio.path, suffix, audio.info.format, '另存音频副本', '音频副本')
    return path ? music.export(id, changes, path, await requireMediaTools()) : null
  }))
  handle('music:reveal', (id: string) => {
    const path = music.outputPath(id)
    if (path) shell.showItemInFolder(path)
  })
  handle('links:open', (id: keyof typeof links) => {
    if (!Object.hasOwn(links, id)) throw new Error('未知链接。')
    return shell.openExternal(links[id])
  })
}

function createWindow() {
  const titleBar = titleBars[preferences.theme]
  const window = new BrowserWindow({
    width: 1150, height: 774, minWidth: 750, minHeight: 610, show: false,
    title: 'W3F7のVideo_Toolsbar', backgroundColor: titleBar.color, autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...titleBar, color: transparentTitleBar },
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  appWindow = window
  shownTitleBarTone = preferences.theme
  appWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  appWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  appWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  const painted = new Promise<void>((resolve) => window.once('ready-to-show', resolve))
  let captionClose: Promise<void> | undefined
  appWindow.on('close', (event) => {
    if (exporting || frameAction || cacheBusy || musicBusy) {
      event.preventDefault()
      void dialog.showMessageBox(appWindow!, { message: '当前操作完成后即可关闭窗口' })
      return
    }
    if (captions.working) {
      event.preventDefault()
      captionClose ??= dialog.showMessageBox(window, {
        type: 'question', message: '还有字幕任务正在进行', buttons: ['继续等待', '取消任务并退出'],
        defaultId: 0, cancelId: 0,
      }).then(async ({ response }) => {
        if (response !== 1) return
        await captions.dispose()
        if (!window.isDestroyed()) window.close()
      }).finally(() => { captionClose = undefined })
    }
  })
  appWindow.on('closed', () => {
    appWindow = null
    previewTitleBarTone = null
    shownTitleBarTone = undefined
  })
  const loaded = window.loadFile(join(app.getAppPath(), 'dist', 'index.html'), { query: { theme: preferences.theme } })
  void Promise.all([painted, loaded]).then(() => {
    if (!window.isDestroyed()) window.show()
  }).catch((reason) => console.error('无法加载应用窗口。', reason))
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    if (appWindow?.isMinimized()) appWindow.restore()
    appWindow?.focus()
  })
  void app.whenReady().then(async () => {
    await loadPreferences()
    await captionConfiguration.load()
    await mediaCache.initialize(preferences.cacheDirectory)
    protocol.handle('w3f7-media', (request) => {
      const url = new URL(request.url)
      if (url.hostname === 'caption-source' || url.hostname === 'caption-preview') {
        const source = captions.mediaSource(url.pathname.slice(1), url.hostname === 'caption-preview')
        if (source) return streamLocalMedia(request, source.path, source.type)
        return new Response('Not found', { status: 404 })
      }
      if (url.hostname === 'music-cover') {
        const match = /^\/([a-f0-9-]{36})\/(\d+)$/.exec(url.pathname)
        if (match) return music.preview(match[1], Number(match[2]))
      }
      if (url.hostname === 'music-audio') {
        return music.playback(url.pathname.slice(1), request)
      }
      if (url.hostname === 'video') {
        const video = selected.get('video')
        if (video && url.pathname === '/' + video.id) return streamLocalMedia(request, video.path, 'video/mp4')
      }
      const picture = url.hostname === 'frame' ? frames.get(url.pathname.slice(1)) :
        url.hostname === 'cover' ? selected.get('cover') : undefined
      if (picture && url.pathname === '/' + picture.id) return net.fetch(pathToFileURL(picture.path).href)
      return new Response('Not found', { status: 404 })
    })
    registerHandlers()
    createWindow()
  })
  app.on('window-all-closed', () => {
    void Promise.allSettled([frames.dispose(), captions.dispose()]).then(() => app.quit())
  })
} else {
  app.quit()
}
