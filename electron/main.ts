import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { stat, readFile, writeFile, rename } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import type { Asset, AssetKind, Preferences, ToolStatus, VideoDetails } from '../src/bridge'

type DirectorySetting = 'toolDirectory' | 'outputDirectory'
type CoreRequest =
  | { operation: 'detect' }
  | { operation: 'inspect'; video: string }
  | { operation: 'export'; video: string; cover: string; outputDirectory: string }

const defaultPreferences: Preferences = { toolDirectory: '', outputDirectory: '', reduceMotion: false }
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
let lastOutput = ''
let exporting = false
let preferenceWrites = Promise.resolve()
const selected = new Map<AssetKind, Asset>()
let selectionRevision = 0

protocol.registerSchemesAsPrivileged([
  { scheme: 'w3f7-media', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

function preferencesPath() {
  return join(app.getPath('userData'), 'preferences.json')
}

async function loadPreferences() {
  try {
    const saved = JSON.parse(await readFile(preferencesPath(), 'utf8'))
    preferences = {
      toolDirectory: typeof saved.toolDirectory === 'string' && isAbsolute(saved.toolDirectory) ? saved.toolDirectory : '',
      outputDirectory: typeof saved.outputDirectory === 'string' && isAbsolute(saved.outputDirectory) ? saved.outputDirectory : '',
      reduceMotion: saved.reduceMotion === true,
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

function runCore<T>(request: CoreRequest, onProgress?: (percent: number) => void): Promise<T> {
  const resources = app.isPackaged ? process.resourcesPath : app.getAppPath()
  const script = join(resources, 'core', 'cover.ps1')
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Json'], {
      cwd: dirname(script),
      windowsHide: true,
      env: { ...process.env, W3F7_MEDIA_REQUEST: JSON.stringify({ ...request, toolDirectory: preferences.toolDirectory }) },
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

async function takeAsset(path: string): Promise<Asset> {
  const ext = extname(path).slice(1).toLowerCase()
  const kind = (Object.keys(extensions) as AssetKind[]).find((key) => extensions[key].includes(ext))
  if (!kind || !isAbsolute(path)) throw new Error('请选择 MP4 视频或 PNG、JPG、JPEG 封面。')
  const info = await stat(path)
  if (!info.isFile() || info.size === 0) throw new Error('所选文件为空或无法读取。')
  const id = randomUUID()
  return { id, kind, name: basename(path), path, bytes: info.size,
    ...(kind === 'cover' ? { preview: 'w3f7-media://cover/' + id } : {}) }
}

async function selectFiles(paths: unknown) {
  if (exporting) throw new Error('当前导出完成后即可更换素材。')
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 2 || !paths.every((item) => typeof item === 'string')) {
    throw new Error('请拖入一个 MP4 视频或一张封面，也可以同时拖入这两个文件。')
  }
  const revision = ++selectionRevision
  const assets = await Promise.all(paths.map(takeAsset))
  if (assets.length === 2 && assets[0].kind === assets[1].kind) {
    throw new Error('请同时拖入一个 MP4 视频和一张封面。')
  }
  if (revision !== selectionRevision || exporting) throw new Error('素材状态已变化，请重新选择。')
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
  handle('assets:inspect', (id: string) => runCore<VideoDetails>({ operation: 'inspect', video: requireAsset('video', id).path }))

  handle('settings:get', () => preferences)
  handle('settings:motion', (enabled: boolean) => savePreference('reduceMotion', enabled === true))
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
  handle('settings:detect', () => runCore<ToolStatus>({ operation: 'detect' }))

  handle('cover:export', async (videoId: string, coverId: string) => {
    if (exporting) throw new Error('已有封装任务正在运行。')
    const video = requireAsset('video', videoId)
    const cover = requireAsset('cover', coverId)
    exporting = true
    lastOutput = ''
    try {
      const result = await runCore<{ path: string }>({
        operation: 'export', video: video.path, cover: cover.path,
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
  handle('links:open', (id: keyof typeof links) => {
    if (!Object.hasOwn(links, id)) throw new Error('未知链接。')
    return shell.openExternal(links[id])
  })
}

function createWindow() {
  appWindow = new BrowserWindow({
    width: 1150, height: 774, minWidth: 750, minHeight: 610, show: false,
    title: 'W3F7のVideo_Toolsbar', backgroundColor: '#0a0a0a', autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0a0a', symbolColor: '#d4d4d4', height: 40 },
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  appWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  appWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  appWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  appWindow.once('ready-to-show', () => appWindow?.show())
  appWindow.on('close', (event) => {
    if (exporting) {
      event.preventDefault()
      void dialog.showMessageBox(appWindow!, { message: '正在封装视频，完成后即可关闭窗口。' })
    }
  })
  appWindow.on('closed', () => { appWindow = null })
  void appWindow.loadFile(join(app.getAppPath(), 'dist', 'index.html'))
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    if (appWindow?.isMinimized()) appWindow.restore()
    appWindow?.focus()
  })
  void app.whenReady().then(async () => {
    await loadPreferences()
    protocol.handle('w3f7-media', (request) => {
      const url = new URL(request.url)
      const cover = selected.get('cover')
      if (!cover || url.hostname !== 'cover' || url.pathname !== '/' + cover.id) {
        return new Response('Not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(cover.path).href)
    })
    registerHandlers()
    createWindow()
  })
  app.on('window-all-closed', () => app.quit())
} else {
  app.quit()
}
