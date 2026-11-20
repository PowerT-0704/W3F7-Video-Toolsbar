import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import type { ToolStatus } from '../src/bridge'
import type { CaptionAsset, CaptionCue, CaptionFormat, CaptionInput, CaptionLayout, CaptionMode, CaptionOptions,
  CaptionPreset, CaptionStage, CaptionTask, ExternalWhisper, SaveCaptionPresetResult, SubtitleStyle } from '../src/transcription'
import { cleanCues, defaultStyle, joinChunks, parseCaptions, serializeCaptions, smoothCues } from './captions.cjs'
import { bijian, chat, jianying, object, parallelMap, processText, serviceUrl, splitCaptions, whisperApi } from './caption-services.cjs'
import type { Requester, ServiceCredentials } from './caption-services.cjs'
import { allocateOutput, chunkPlan, extractAudio, inspectWhisper, localWhisper, makePreview, mediaExtensions,
  probeMedia, readSubtitle, renderAudioChunk, subtitleExtensions, synthesize } from './caption-media.cjs'
import type { MediaInfo, RenderOverlay } from './caption-media.cjs'
import { type CaptionConfiguration, textValue, writeCaptionData } from './caption-settings.cjs'
import { CaptionCache } from './caption-cache.cjs'

const validModes = ['transcribe', 'subtitles', 'transcribe-subtitles', 'full', 'synthesize'] as const
const validFormats = ['srt', 'ass', 'vtt', 'txt', 'json'] as const
const validLayouts = ['source', 'translation', 'source-first', 'translation-first'] as const
const localEngines = ['whisper-cpp', 'faster-whisper'] as const
const busy = new Set(['queued', 'running'])
const terminals = new Set(['done', 'warning', 'failed', 'cancelled'])
const mime: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4',
}

function oneOf<const Values extends readonly unknown[]>(value: unknown, choices: Values): Values[number] {
  if (!choices.includes(value)) throw new Error('转录选项无效。')
  return value
}

function integer(value: unknown, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error('转录数值超出范围。')
  return value
}

function code(value: unknown) {
  const text = textValue(value, 32)
  if (!/^[a-z]{2,3}(?:-[a-z\d]{2,8})*$/i.test(text) && text !== 'auto') throw new Error('语言代码无效。')
  return text
}

function outputFormats(value: unknown): CaptionFormat[] {
  if (!Array.isArray(value) || !value.length || value.length > validFormats.length) throw new Error('请选择至少一种字幕格式。')
  return [...new Set(value.map((format) => oneOf(format, validFormats)))]
}

function validateStyle(value: unknown): SubtitleStyle {
  const data = object(value)
  const color = (value: unknown, fallback: string) => {
    if (value === undefined) return fallback
    const text = textValue(value, 7)
    if (!/^#[a-f\d]{6}$/i.test(text)) throw new Error('字幕颜色无效。')
    return text
  }
  return {
    font: textValue(data.font, 100) || defaultStyle.font,
    fontFile: data.fontFile ? textValue(data.fontFile, 32_767) : undefined,
    size: integer(data.size, 10, 160), outline: integer(data.outline, 0, 12), bottom: integer(data.bottom, 0, 300),
    color: color(data.color, defaultStyle.color), background: color(data.background, defaultStyle.background),
    opacity: integer(data.opacity, 0, 100), radius: integer(data.radius, 0, 80), padding: integer(data.padding, 0, 100), spacing: integer(data.spacing, 0, 80),
  }
}

function validateOptions(value: unknown): CaptionOptions {
  const data = object(value)
  return {
    mode: oneOf(data.mode, validModes), engine: oneOf(data.engine, ['bijian', 'jianying', 'whisper-api', ...localEngines]),
    language: code(data.language), split: oneOf(data.split, ['original', 'rules', 'llm']),
    correct: data.correct === true, translator: oneOf(data.translator, ['none', 'llm', 'bing', 'google', 'deeplx']),
    target: code(data.target), reflect: data.reflect === true, prompt: textValue(data.prompt, 3000),
    cjk: integer(data.cjk, 3, 160), words: integer(data.words, 3, 100), batch: integer(data.batch, 1, 50),
    concurrency: integer(data.concurrency, 1, 10), layout: oneOf(data.layout, validLayouts), formats: outputFormats(data.formats),
    synthesis: oneOf(data.synthesis, ['soft', 'ass', 'rounded']), container: oneOf(data.container, ['mp4', 'mkv']),
    quality: oneOf(data.quality, [18, 23, 28, 32]), style: validateStyle(data.style), review: data.review === true,
    output: data.output ? textValue(data.output, 32767) : undefined,
  }
}

function presetOptions(value: unknown): CaptionPreset['options'] {
  const data = object(value)
  const { output: _output, style: { fontFile: _fontFile, ...safeStyle }, ...options } =
    validateOptions({ ...data, output: undefined, style: { ...object(data.style), fontFile: undefined } })
  return { ...options, style: safeStyle }
}

function presetName(value: unknown) {
  const name = textValue(value, 64)
  if (!name || /[\x00-\x1f\x7f]/.test(name)) throw new Error('请输入有效的预设名称')
  return name
}

const presetNameKey = (name: string) => name.normalize('NFKC').toLowerCase()

interface AssetRecord {
  public: CaptionAsset
  path: string
  info?: MediaInfo
  proxy?: string
  proxyTask?: Promise<string>
}

type Action = { type: 'pipeline' | 'finish' } | { type: 'translate'; ids: Set<string> } |
  { type: 'export'; formats: CaptionFormat[]; layout: CaptionLayout }

interface Job {
  task: CaptionTask
  media?: AssetRecord
  subtitle?: AssetRecord
  track: number
  credentials: ServiceCredentials
  tools?: ToolStatus
  action: Action
  complete: Set<CaptionStage>
  remote: Map<string, string>
  cache: Map<string, CaptionCue[]>
  languageText?: string
  directory: string
  inheritedState?: CaptionTask['state']
  lastNotice: number
  controller?: AbortController
  imported?: boolean
  exported?: { revision: number; layout: CaptionLayout; formats: Set<CaptionFormat> }
}

interface WorkspaceOptions {
  dataDirectory: string
  settings: CaptionConfiguration
  tools: () => Promise<ToolStatus>
  outputDirectory: () => string
  authorize: (path: string, kind: 'output' | 'font') => void
  notify: (task: CaptionTask) => void
  notifyRemoved?: (id: string) => void
  render: RenderOverlay
  request?: Requester
}

const reasonText = (error: unknown) => error instanceof Error ? error.message : String(error)
const usesRecognition = (mode: CaptionMode) => mode === 'transcribe' || mode === 'transcribe-subtitles' || mode === 'full'
const usesText = (mode: CaptionMode) => mode !== 'transcribe' && mode !== 'synthesize'
const usesSynthesis = (mode: CaptionMode, media?: AssetRecord) => mode === 'synthesize' || mode === 'full' && Boolean(media?.public.video)

async function digest(path: string, signal: AbortSignal) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path, { signal })) hash.update(bytes)
  return hash.digest('hex')
}

function savedBase(path: string) {
  return basename(path, extname(path)).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').slice(0, 130) || '字幕'
}

export class TranscriptionWorkspace {
  private assets = new Map<string, AssetRecord>()
  private jobs = new Map<string, Job>()
  private paths = new Map<string, string>()
  private queue: Job[] = []
  private active?: Job
  private activeSettled?: () => void
  private removing = new Set<string>()
  private pump?: Promise<void>
  private previewAbort = new AbortController()
  private cacheOperation?: Promise<unknown>
  private quotaWrites = Promise.resolve()
  private cacheWrites = Promise.resolve()
  private presetWrites = Promise.resolve()
  private readonly request: Requester
  private readonly root: string
  private readonly storage: CaptionCache
  private readonly device = String(390 + new Date().getFullYear() % 10) + String(Number.parseInt(randomUUID().slice(0, 8), 16)).padStart(13, '0')

  constructor(private readonly context: WorkspaceOptions) {
    this.request = context.request ?? fetch
    this.root = join(context.dataDirectory, 'transcription')
    this.storage = new CaptionCache(context.dataDirectory)
  }

  get working() { return Boolean(this.active || this.queue.length) }

  async dispose() {
    await this.cancel()
    this.previewAbort.abort()
    await this.pump
    await Promise.allSettled([...this.assets.values()].flatMap((asset) => asset.proxyTask ? [asset.proxyTask] : []))
    await this.cacheOperation?.catch(() => undefined)
    await this.storage.dispose()
  }

  private activePreviews() {
    return new Set([...this.jobs.values()].flatMap((job) => job.media?.proxy ? [job.media.proxy] : []))
  }

  cacheStatus() {
    return this.storage.status(this.activePreviews(), this.working || [...this.assets.values()].some((asset) => asset.proxyTask))
  }

  private useCacheWhileIdle<T>(action: () => Promise<T>) {
    if (this.cacheOperation || this.working || [...this.assets.values()].some((asset) => asset.proxyTask)) {
      throw new Error('请等待转录、合成或预览完成后再管理缓存。')
    }
    const operation = action().finally(() => { this.cacheOperation = undefined })
    this.cacheOperation = operation
    return operation
  }

  changeCache(parent: string) {
    return this.useCacheWhileIdle(async () => {
      await this.storage.change(parent)
      return this.cacheStatus()
    })
  }

  clearCache() {
    return this.useCacheWhileIdle(async () => {
      await this.cacheWrites
      const previews = this.activePreviews()
      for (const asset of this.assets.values()) if (asset.proxy && !previews.has(asset.proxy)) asset.proxy = undefined
      for (const job of this.jobs.values()) job.cache.clear()
      return this.storage.clear(previews)
    })
  }

  private requireCacheIdle() {
    if (this.cacheOperation) throw new Error('请等待转录缓存操作完成。')
  }

  async importPaths(paths: unknown) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 100) throw new Error('请选择 1 至 100 个文件。')
    const controller = AbortSignal.any([this.previewAbort.signal, AbortSignal.timeout(90_000)])
    const result: CaptionAsset[] = []
    const errors: string[] = []
    for (const candidate of paths) {
      try {
        const path = textValue(candidate, 32_767)
        if (!isAbsolute(path) || !(await stat(path).catch(() => null))?.isFile()) throw new Error('请选择可读取的本地文件。')
        const ext = extname(path).slice(1).toLowerCase()
        const existing = [...this.assets.values()].find((asset) => asset.path === path)
        if (existing) { result.push(existing.public); continue }
        const id = randomUUID()
        const asset: CaptionAsset = { id, name: basename(path), kind: 'subtitle', duration: 0, video: false, tracks: [] }
        if (subtitleExtensions.includes(ext)) {
          const cues = await readSubtitle(path)
          asset.duration = cues.reduce((max, line) => Math.max(max, line.end), 0)
          this.assets.set(id, { public: asset, path })
        } else {
          if (!mediaExtensions.includes(ext)) throw new Error('文件格式不在支持列表中。')
          const info = await probeMedia(await this.context.tools(), path, controller)
          asset.kind = 'media'
          asset.video = Boolean(info.video)
          asset.duration = info.duration
          asset.tracks = info.audio.map((stream) => ({ index: stream.index, language: stream.tags?.language || '',
            channels: stream.channels || 0 }))
          asset.preview = 'w3f7-media://caption-source/' + id
          this.assets.set(id, { public: asset, path, info })
        }
        result.push(asset)
      } catch (error) { errors.push(typeof candidate === 'string' ? basename(candidate) + '：' + reasonText(error) : reasonText(error)) }
    }
    if (!result.length || errors.length) {
      if (!result.length) throw new Error(errors.join('\n'))
      // Return valid assets, and report each invalid file without losing the successful registrations.
      return { assets: result, errors }
    }
    return { assets: result, errors: [] }
  }

  mediaSource(id: string, proxy: boolean) {
    const asset = this.assets.get(id)
    if (!asset || asset.public.kind !== 'media' || proxy && !asset.proxy) return undefined
    return { path: proxy ? asset.proxy! : asset.path, type: proxy ? 'video/mp4' : mime[extname(asset.path).slice(1).toLowerCase()] || 'application/octet-stream' }
  }

  async preview(id: string) {
    this.requireCacheIdle()
    const media = this.asset(id, 'media')
    if (media.proxy) return 'w3f7-media://caption-preview/' + id
    media.proxyTask ??= (async () => {
      const output = join(await this.storage.session(), id + '.mp4')
      const signal = AbortSignal.any([this.previewAbort.signal, AbortSignal.timeout(300_000)])
      try { await makePreview(await this.context.tools(), media.path, media.info!, output, signal) }
      catch (error) { await rm(output, { force: true }).catch(() => undefined); throw error }
      media.proxy = output
      return 'w3f7-media://caption-preview/' + id
    })()
    try { return await media.proxyTask } finally { media.proxyTask = undefined }
  }

  private asset(id: unknown, kind: CaptionAsset['kind']) {
    const source = typeof id === 'string' ? this.assets.get(id) : undefined
    if (!source || source.public.kind !== kind) throw new Error('请选择有效的' + (kind === 'media' ? '媒体' : '字幕') + '。')
    return source
  }

  tasks() { return [...this.jobs.values()].map(({ task }) => task) }

  private async readPresets(): Promise<CaptionPreset[]> {
    try {
      const content: unknown = JSON.parse(await readFile(join(this.root, 'presets.json'), 'utf8'))
      if (!Array.isArray(content)) throw new Error('invalid presets')
      return content.map((entry) => {
        const row = object(entry)
        return { id: textValue(row.id), name: presetName(row.name), options: presetOptions(row.options) }
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new Error('无法读取操作预设，请检查应用数据目录', { cause: error })
    }
  }

  async listPresets() {
    await this.presetWrites
    return this.readPresets()
  }

  private changePresets<T>(change: (presets: CaptionPreset[], path: string) => Promise<T>) {
    const write = this.presetWrites.then(async () => change(await this.readPresets(), join(this.root, 'presets.json')))
    this.presetWrites = write.then(() => undefined, () => undefined)
    return write
  }

  async savePreset(rawName: unknown, rawOptions: unknown, rawReplaceId?: unknown): Promise<SaveCaptionPresetResult> {
    const name = presetName(rawName)
    const options = presetOptions(rawOptions)
    const replaceId = rawReplaceId === undefined ? undefined : textValue(rawReplaceId)
    return this.changePresets(async (presets, path) => {
      const duplicate = presets.find((preset) => presetNameKey(preset.name) === presetNameKey(name))
      if (duplicate && replaceId === undefined) return { duplicate }
      if (replaceId !== undefined && replaceId !== duplicate?.id) throw new Error('同名预设已变更，请重新保存')
      const saved = { id: duplicate?.id ?? randomUUID(), name, options }
      const next = duplicate ? presets.map((preset) => preset.id === duplicate.id ? saved : preset) : [...presets, saved]
      await writeCaptionData(path, next)
      return { presets: next, saved }
    })
  }

  async removePreset(rawId: unknown) {
    const id = textValue(rawId)
    return this.changePresets(async (presets, path) => {
      const next = presets.filter((preset) => preset.id !== id)
      if (next.length !== presets.length) await writeCaptionData(path, next)
      return next
    })
  }
  locate(id: string) { return this.paths.get(id) }

  private job(id: string) {
    const job = this.jobs.get(id)
    if (!job) throw new Error('找不到字幕任务。')
    if (this.removing.has(id)) throw new Error('任务正在删除。')
    return job
  }

  private publish(job: Job, force = true) {
    if (this.removing.has(job.task.id)) return
    if (!force && Date.now() - job.lastNotice < 220) return
    job.lastNotice = Date.now()
    this.context.notify(job.task)
  }

  async create(rawInputs: unknown, rawOptions: unknown) {
    this.requireCacheIdle()
    const options = validateOptions(rawOptions)
    if (options.output) this.context.authorize(options.output, 'output')
    if (options.style.fontFile) this.context.authorize(options.style.fontFile, 'font')
    if (!Array.isArray(rawInputs) || !rawInputs.length || rawInputs.length > 100) throw new Error('一次可提交 1 至 100 个任务。')
    if (this.jobs.size + rawInputs.length > 500) throw new Error('本次会话的任务达到上限。保存成品后可重开软件继续。')
    const inputs = rawInputs.map((raw) => {
      const input = object(raw) as unknown as CaptionInput
      const mode = input.mode === undefined ? options.mode : oneOf(input.mode, validModes)
      const media = input.media ? this.asset(input.media, 'media') : undefined
      const subtitle = input.subtitle ? this.asset(input.subtitle, 'subtitle') : undefined
      const track = integer(input.track, -1, 4096)
      const recognize = usesRecognition(mode) && !(mode === 'full' && subtitle)
      if (recognize && !media?.public.tracks.some((value) => value.index === track)) throw new Error((media?.public.name || '任务') + '缺少选中的音轨。')
      if ((mode === 'subtitles' || mode === 'synthesize') && !subtitle) throw new Error('该模式需要已有字幕文件。')
      if (mode === 'synthesize' && !media?.public.video) throw new Error('合成任务需要一个视频文件。')
      return { mode, media, subtitle, track, recognize }
    })
    const llm = inputs.some(({ mode }) => mode !== 'synthesize' && options.split === 'llm' ||
      usesText(mode) && (options.correct || options.translator === 'llm'))
    const whisper = options.engine === 'whisper-api' && inputs.some((item) => item.recognize)
    const credentials = await this.context.settings.credentials({ llm, whisper })
    if (llm && !credentials.llmKey && !isLoopback(credentials.settings.llm.base)) {
      throw new Error('请先在「模型与 API」填写 LLM Key，或改用规则断句。')
    }
    if (whisper && !credentials.whisperKey && !isLoopback(credentials.settings.whisper.base)) {
      throw new Error('请先配置 Whisper API Key，或选择必剪。')
    }
    if (options.translator === 'deeplx' && inputs.some(({ mode }) => usesText(mode)) && !credentials.settings.deeplx) {
      throw new Error('请先在「模型与 API」设置 DeepLX 端点。')
    }
    if (localEngines.some((engine) => engine === options.engine) && inputs.some((item) => item.recognize)) {
      const program = credentials.settings.local[options.engine as ExternalWhisper]
      if (!program.executable || !program.model) throw new Error('请先在「模型与 API」选择已下载的 Whisper 程序和模型。')
    }
    const tools = inputs.some(({ recognize, mode, media }) => recognize || usesSynthesis(mode, media)) ? await this.context.tools() : undefined
    this.requireCacheIdle()
    if (this.jobs.size + inputs.length > 500) throw new Error('本次会话的任务达到上限。请移除已处理的任务后继续。')
    const prepared = inputs.map(({ mode, media, subtitle, track }) => {
      const source = subtitle && !usesRecognition(mode) ? subtitle : media ?? subtitle!
      const task: CaptionTask = {
        id: randomUUID(), name: source.public.name, media: media?.public, cues: [], revision: 0, outputs: [], warnings: [],
        retryIds: [], options: { ...options, mode }, state: 'queued', progress: null, message: '等待处理',
      }
      const job: Job = {
        task, media, subtitle, track, credentials, tools, action: { type: 'pipeline' }, complete: new Set(),
        remote: new Map(), cache: new Map(), directory: options.output || this.context.outputDirectory() || dirname(source.path),
        lastNotice: 0,
      }
      return job
    })
    for (const job of prepared) {
      this.jobs.set(job.task.id, job)
      this.enqueue(job, job.action)
    }
    return prepared.map(({ task }) => task)
  }

  private enqueue(job: Job, action: Action) {
    job.action = action
    job.task.state = 'queued'
    job.task.message = '等待处理'
    job.task.stage = undefined
    job.task.progress = null
    this.queue.push(job)
    this.publish(job)
    this.startQueue()
  }

  private startQueue() {
    this.pump ??= Promise.resolve().then(() => this.drain()).finally(() => {
      this.pump = undefined
      if (this.queue.length) this.startQueue()
    })
  }

  private async drain() {
    while (this.queue.length) {
      const job = this.queue.shift()!
      this.active = job
      const controller = new AbortController()
      job.controller = controller
      job.task.state = 'running'
      this.publish(job)
      try {
        if (job.action.type === 'translate') await this.translateRows(job, job.action.ids, controller.signal)
        else if (job.action.type === 'export') await this.saveSubtitles(job, job.action.formats, job.action.layout, controller.signal)
        else if (job.action.type === 'finish') {
          if (!job.complete.has('export')) await this.runStage(job, 'export', controller.signal)
          await this.runStage(job, 'synthesize', controller.signal)
        } else await this.runPipeline(job, controller.signal)
        if (job.task.state === 'running') {
          job.task.state = job.inheritedState === 'review' && job.action.type !== 'finish' ? 'review'
            : job.task.warnings.length || job.task.retryIds.length ? 'warning' : 'done'
          job.task.message = job.task.state === 'review' ? '字幕等待校对' : job.task.state === 'warning' ? '已完成，有待复核项目' : '处理完成'
          job.task.progress = 100
        }
      } catch (error) {
        job.task.state = controller.signal.aborted ? 'cancelled' : 'failed'
        job.task.message = controller.signal.aborted ? '已取消' : reasonText(error)
        job.task.progress = null
      } finally {
        this.active = undefined
        job.controller = undefined
        this.activeSettled?.()
        this.activeSettled = undefined
        this.publish(job)
      }
    }
  }

  private async runPipeline(job: Job, signal: AbortSignal) {
    const { task, subtitle, media } = job
    const { mode, split, correct, translator } = task.options
    const fromSubtitle = Boolean(subtitle && (!usesRecognition(mode) || mode === 'full'))
    if (fromSubtitle && !job.imported) {
      this.stage(job, 'prepare', null, '正在读取已有字幕')
      this.replaceCues(job, await readSubtitle(subtitle!.path))
      job.imported = true
    }
    if (!fromSubtitle && !job.complete.has('recognize')) await this.runStage(job, 'recognize', signal)
    if (job.languageText && !task.cues.length) {
      await this.saveSubtitles(job, ['txt'], 'source', signal)
      signal.throwIfAborted()
      task.warnings.push('该模型只返回文本。已导出 TXT。')
      return
    }
    if (!task.cues.length) {
      task.message = '未检测到语音'
      task.warnings.push('未检测到语音，未生成字幕文件。')
      return
    }
    if (mode !== 'synthesize' && split !== 'original' && !job.complete.has('split')) {
      if (fromSubtitle && task.cues.some((line) => line.translation)) {
        job.complete.add('split')
        task.warnings.push('已保留导入双语字幕的原行边界。')
      } else await this.runStage(job, 'split', signal)
    }
    if (usesText(mode) && correct && !job.complete.has('correct')) await this.runStage(job, 'correct', signal)
    if (usesText(mode) && translator !== 'none' && !job.complete.has('translate')) await this.runStage(job, 'translate', signal)
    if (usesSynthesis(mode, media) && task.options.review && !job.complete.has('synthesize')) {
      task.state = 'review'
      task.message = '字幕等待校对'
      task.progress = null
      return
    }
    if (!job.complete.has('export')) await this.runStage(job, 'export', signal)
    if (usesSynthesis(mode, media) && !job.complete.has('synthesize')) await this.runStage(job, 'synthesize', signal)
  }

  private stage(job: Job, stage: CaptionStage, progress: number | null, message: string, force = true) {
    job.task.stage = stage
    job.task.progress = progress
    job.task.message = message
    this.publish(job, force)
  }

  private replaceCues(job: Job, cues: CaptionCue[]) {
    job.task.cues = cues
    job.task.revision++
  }

  private async runStage(job: Job, stage: CaptionStage, signal: AbortSignal) {
    const { task, credentials } = job
    const progress = (done: number, total: number, message?: string) =>
      this.stage(job, stage, total ? Math.round(done * 100 / total) : null, message || task.message, false)
    const labels: Record<CaptionStage, string> = {
      prepare: '准备输入', recognize: '识别语音', split: '字幕断句', correct: '正在校正字幕', translate: '正在翻译字幕',
      export: '正在导出字幕', synthesize: '正在合成视频',
    }
    signal.throwIfAborted()
    this.stage(job, stage, null, labels[stage])
    if (stage === 'recognize') await this.recognize(job, signal)
    if (stage === 'split') {
      const output = await splitCaptions(this.request, credentials, task.cues, task.options, signal, progress)
      this.replaceCues(job, output.cues)
      if (output.failures) task.warnings.push(output.failures + ' 批字幕已改用规则断句。')
    }
    if (stage === 'correct' || stage === 'translate') {
      const output = await processText(this.request, credentials, task.cues, task.options, stage, signal, progress)
      this.replaceCues(job, output.cues)
      if (stage === 'translate') task.retryIds = output.failed
      else if (output.failed.length) task.warnings.push('校正失败的字幕行：' + output.failed.slice(0, 30).join('、') +
        (output.failed.length > 30 ? '（共 ' + output.failed.length + ' 行）' : ''))
    }
    if (stage === 'export') {
      if (!job.exported || job.exported.revision !== task.revision || job.exported.layout !== task.options.layout) {
        job.exported = { revision: task.revision, layout: task.options.layout, formats: new Set() }
      }
      const { formats } = job.exported
      const pending = task.options.formats.filter((format) => !formats.has(format))
      if (pending.length) await this.saveSubtitles(job, pending, task.options.layout, signal, (format) => formats.add(format))
    }
    if (stage === 'synthesize') await this.video(job, signal)
    signal.throwIfAborted()
    job.complete.add(stage)
  }

  private async quota(engine: string, duration: number) {
    const filepath = join(this.root, 'service-usage.json')
    const transaction = this.quotaWrites.then(async () => {
      let entries: Array<{ engine: string; at: number; duration: number }> = []
      try { entries = JSON.parse(await readFile(filepath, 'utf8')) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('识别服务用量记录无法读取。') }
      if (!Array.isArray(entries)) throw new Error('识别服务用量记录格式无效。')
      const now = Date.now()
      entries = entries.filter((item) => item && item.at > now - 12 * 3_600_000 && Number.isFinite(item.duration))
      const used = entries.filter((item) => item.engine === engine)
      if (used.length >= 100 || used.reduce((sum, item) => sum + item.duration, 0) + duration > 360 * 60_000) {
        throw new Error('已达到该免费识别服务的本机用量限制，请稍后重试。')
      }
      entries.push({ engine, at: now, duration })
      await writeCaptionData(filepath, entries)
    })
    this.quotaWrites = transaction.catch(() => undefined)
    await transaction
  }

  private async readCache(job: Job, directory: string, key: string, length: number) {
    const running = job.cache.get(key)
    if (running) return running
    const path = join(directory, key + '.json')
    try {
      const info = await stat(path)
      if (Date.now() - info.mtimeMs >= 2 * 86_400_000 || info.size > 16 * 1024 ** 2) return undefined
      const data: CaptionCue[] = JSON.parse(await readFile(path, 'utf8'))
      const cues = cleanCues(data, length)
      job.cache.set(key, cues)
      return cues
    } catch { return undefined }
  }

  private async writeCache(job: Job, directory: string, key: string, captions: CaptionCue[]) {
    job.cache.set(key, captions)
    const store = this.cacheWrites.then(async () => {
      await writeCaptionData(join(directory, key + '.json'), captions)
      const entries = await readdir(directory)
      if (entries.length <= 400) return
      const candidates = await Promise.all(entries.filter((name) => /^[a-f\d]{64}\.json$/.test(name)).map(async (name) =>
        ({ name, mtime: (await stat(join(directory, name))).mtimeMs })))
      candidates.sort((a, b) => a.mtime - b.mtime)
      await Promise.all(candidates.slice(0, -400).map(({ name }) => rm(join(directory, name), { force: true })))
    })
    this.cacheWrites = store.catch(() => undefined)
    await store.catch(() => undefined)
  }

  private async recognize(job: Job, signal: AbortSignal) {
    const { media, task, credentials } = job
    const tools = job.tools!
    const input = media!
    const settings = credentials.settings
    const { engine, language } = task.options
    const wantsWords = task.options.split !== 'original'
    const external = engine === 'whisper-cpp' || engine === 'faster-whisper'
    const session = await this.storage.session()
    const cacheDirectory = await this.storage.recognitionDirectory()
    const scratch = await mkdtemp(join(session, 'job-'))
    try {
      const info = await probeMedia(tools, input.path, signal)
      const audioStream = info.audio.find((stream) => stream.index === job.track)
      if (!audioStream) throw new Error('源文件的选定音轨已变更。')
      this.stage(job, 'prepare', 0, '正在提取选中的音轨')
      const wav = join(scratch, 'input.wav')
      await extractAudio(tools, input.path, job.track, wav, info.duration, signal,
        (percent) => this.stage(job, 'prepare', percent, '正在提取选中的音轨', false))
      const audio = await probeMedia(tools, wav, signal)
      const audioOffset = Number.isFinite(Number(audioStream.start_time)) ? Math.round(Number(audioStream.start_time) * 1000) - info.origin : 0
      const identity = settings.local[engine as ExternalWhisper]
      const capabilities = external ? await inspectWhisper(engine, identity, signal) : undefined
      const modelSignature = external
        ? [(await stat(identity.model)).mtimeMs, (await stat(identity.executable)).mtimeMs]
        : engine === 'whisper-api' ? [settings.whisper.base, settings.whisper.model, settings.whisperPrompt,
          credentials.whisperKey ? createHash('sha256').update(credentials.whisperKey).digest('hex') : ''] : []
      const digestKey = createHash('sha256').update(JSON.stringify([2, await digest(wav, signal), engine, job.track, language,
        modelSignature, wantsWords, identity])).digest('hex')
      const plan = chunkPlan(audio.duration, external ? 20 : 10)
      let finished = 0
      let furthest = 0
      const snippets = new Map<number, string>()
      const parts = await parallelMap(plan, external ? 1 : 3, signal, async (chunk, index) => {
        const key = createHash('sha256').update(digestKey + ':' + chunk.start + ':' + chunk.end).digest('hex')
        const length = chunk.end - chunk.start
        let cues = await this.readCache(job, cacheDirectory, key, length)
        if (!cues) {
          this.stage(job, 'recognize', furthest, '准备第 ' + (index + 1) + '/' + plan.length + ' 块', false)
          const directory = join(scratch, String(index))
          await mkdir(directory)
          const part = join(directory, external ? 'chunk.wav' : 'chunk.mp3')
          await renderAudioChunk(tools, wav, part, chunk.start, chunk.end, external, signal)
          const report = (message: string) => this.stage(job, 'recognize', furthest,
            '分块 ' + (index + 1) + '/' + plan.length + ' · ' + message, false)
          if (external) cues = await localWhisper(engine, identity, capabilities!.help, part, directory, language, wantsWords, signal)
          else {
            const file = await stat(part)
            if (file.size > 24_000_000) throw new Error('分块超过上传限制，请检查音频编码。')
            const bytes = await readFile(part, { signal })
            if (engine === 'bijian') cues = await bijian(this.request, bytes, wantsWords, signal, report, job.remote, key, () => this.quota(engine, length))
            else if (engine === 'jianying') cues = await jianying(this.request, bytes, length, wantsWords, signal, report, job.remote, key,
              () => this.quota(engine, length), this.device)
            else {
              const result = await whisperApi(this.request, bytes, credentials, language, wantsWords, signal)
              cues = result.cues
              if (result.text) snippets.set(index, result.text)
            }
          }
          cues = cleanCues(cues, length)
          if (!snippets.has(index)) await this.writeCache(job, cacheDirectory, key, cues)
          await this.storage.removeScratch(directory, scratch, String(index))
        }
        furthest = Math.max(furthest, Math.round(++finished * 100 / plan.length))
        this.stage(job, 'recognize', furthest, '识别完成 ' + finished + '/' + plan.length + ' 块', false)
        return { start: chunk.start, cues }
      })
      const combined = joinChunks(parts, 10_000)
      if (combined.fallback) task.warnings.push(combined.fallback + ' 处识别块使用时间边界拼接。')
      job.languageText = snippets.size ? [...snippets.entries()].sort(([a], [b]) => a - b).map(([, text]) => text).join('\n') : undefined
      if (job.languageText && combined.cues.length) task.warnings.push('部分分块只返回文本，未纳入带时间字幕。')
      const shifted = cleanCues(combined.cues.map((line) => ({ ...line, start: line.start + audioOffset, end: line.end + audioOffset })),
        info.duration || Number.MAX_SAFE_INTEGER)
      this.replaceCues(job, !wantsWords ? smoothCues(shifted) : shifted)
    } finally { await this.storage.removeScratch(scratch, session, 'job-') }
  }

  private async saveSubtitles(job: Job, formats: CaptionFormat[], layout: CaptionLayout, signal: AbortSignal,
    saved?: (format: CaptionFormat) => void) {
    const { task } = job
    this.stage(job, 'export', 0, '正在保存字幕')
    if (!task.cues.length && !job.languageText) throw new Error('没有可以导出的字幕。')
    const base = savedBase(task.name) + '_字幕'
    for (const [index, format] of formats.entries()) {
      if (!task.cues.length && format !== 'txt') throw new Error('该结果只有文本，请选择 TXT。')
      const output = await allocateOutput(job.directory, base, format)
      try {
        const content = !task.cues.length ? job.languageText! + '\n' :
          serializeCaptions(task.cues, format, layout, task.options.style, job.media?.info)
        if (format !== 'txt' && !parseCaptions(content, format).length) throw new Error('导出的字幕未通过校验。')
        await writeFile(output.temporary, content, { flag: 'wx', signal })
        this.addOutput(job, await output.commit(signal), format)
        saved?.(format)
        this.stage(job, 'export', Math.round((index + 1) * 100 / formats.length), '正在保存字幕', false)
      } finally { await output.cleanup() }
    }
  }

  private async video(job: Job, signal: AbortSignal) {
    const { task, media } = job
    if (!media?.public.video) throw new Error('请关联视频后再合成。')
    const tools = job.tools ?? await this.context.tools()
    const session = await this.storage.session()
    const scratch = await mkdtemp(join(session, 'job-'))
    try {
      const output = await allocateOutput(job.directory, savedBase(media.path) + '_字幕成片', task.options.container)
      try {
        const info = await probeMedia(tools, media.path, signal)
        const beyond = task.cues.filter((line) => line.end > info.duration).length
        await synthesize(tools, media.path, info, task.cues, task.options, scratch, output.temporary, this.context.render, signal,
          (value) => this.stage(job, 'synthesize', value, '正在合成视频', false))
        const warning = '合成时按视频时长裁切了 ' + beyond + ' 行字幕，原字幕文件仍保留。'
        if (beyond && !task.warnings.includes(warning)) task.warnings.push(warning)
        this.addOutput(job, await output.commit(signal), 'video')
      } finally { await output.cleanup() }
    } finally { await this.storage.removeScratch(scratch, session, 'job-') }
  }

  private addOutput(job: Job, path: string, kind: CaptionFormat | 'video') {
    const id = randomUUID()
    this.paths.set(id, path)
    job.task.outputs = [...job.task.outputs, { id, name: basename(path), kind }]
    this.publish(job)
  }

  private stopJobs(matches: (job: Job) => boolean) {
    const queued = this.queue.filter(matches)
    this.queue = this.queue.filter((job) => !matches(job))
    for (const job of queued) {
      job.task.state = 'cancelled'
      job.task.message = '已取消'
      this.publish(job)
    }
    if (this.active && matches(this.active)) this.active.controller?.abort()
  }

  async cancel(id?: string) {
    if (id !== undefined) this.job(id)
    this.stopJobs(({ task }) => id === undefined || task.id === id)
  }

  retry(id: string) {
    this.requireCacheIdle()
    const job = this.job(id)
    if (job.task.state !== 'failed' && job.task.state !== 'cancelled') throw new Error('当前任务无需重试。')
    this.enqueue(job, job.action)
  }

  async remove(target: string | string[]): Promise<Pick<CaptionTask, 'id' | 'state'>[]> {
    const ids = typeof target === 'string' ? [target] : target
    if (!Array.isArray(ids) || ids.length > 500 || ids.some((id) => typeof id !== 'string')) {
      throw new Error('要删除的任务列表无效。')
    }
    const jobs = [...new Set(ids)].flatMap((id) => {
      const job = this.jobs.get(id)
      return job && !this.removing.has(id) ? [job] : []
    })
    const pending = jobs.map(({ task }) => ({ id: task.id, state: busy.has(task.state) ? 'cancelled' as const : task.state }))
    const selected = new Set(jobs)
    const settled = this.active && selected.has(this.active)
      ? new Promise<void>((resolve) => { this.activeSettled = resolve })
      : undefined
    for (const { id } of pending) this.removing.add(id)
    try {
      this.stopJobs((job) => selected.has(job))
      await settled
      for (const { task } of jobs) {
        this.jobs.delete(task.id)
        for (const output of task.outputs) this.paths.delete(output.id)
        this.context.notifyRemoved?.(task.id)
      }
      return pending
    } finally {
      for (const { id } of pending) this.removing.delete(id)
    }
  }

  edit(id: string, revision: number, raw: unknown) {
    const job = this.job(id)
    if (busy.has(job.task.state) || job.task.revision !== revision) throw new Error('字幕已更新，请重新打开校对。')
    if (!Array.isArray(raw) || raw.length > job.task.cues.length || raw.length > 120_000) throw new Error('字幕编辑数据无效。')
    const original = new Map(job.task.cues.map((line) => [line.id, line]))
    const used = new Set<string>()
    const cues = raw.map((value) => {
      const input = object(value)
      const line = original.get(textValue(input.id, 80))
      if (!line || used.has(line.id)) throw new Error('字幕行已不存在或编号重复。')
      used.add(line.id)
      const start = integer(input.start, 0, Number.MAX_SAFE_INTEGER - 1)
      const end = integer(input.end, start + 1, Number.MAX_SAFE_INTEGER)
      const text = textValue(input.text, 12_000)
      if (!text) throw new Error('原文为空，请删除该行或补写原文。')
      return { ...line, start, end, text, translation: textValue(input.translation, 12_000) }
    })
    const pending = new Set(job.task.retryIds)
    job.task.retryIds = cues.filter((line) => pending.has(line.id) && line.translation === original.get(line.id)?.translation).map((line) => line.id)
    this.replaceCues(job, cues.sort((a, b) => a.start - b.start || a.end - b.end))
    job.complete.delete('export')
    job.complete.delete('synthesize')
    this.publish(job)
    return job.task
  }

  finish(id: string, raw: unknown) {
    this.requireCacheIdle()
    const job = this.job(id)
    if ((!terminals.has(job.task.state) && job.task.state !== 'review') || !job.media?.public.video || !job.task.cues.length) {
      throw new Error('需要先校对视频字幕才可合成。')
    }
    const input = object(raw)
    const container = oneOf(input.container, ['mp4', 'mkv'])
    const synthesis = oneOf(input.synthesis, ['soft', 'ass', 'rounded'])
    const layout = oneOf(input.layout, validLayouts)
    if (layout !== job.task.options.layout) job.complete.delete('export')
    job.task.options = { ...job.task.options, container, synthesis, layout }
    job.inheritedState = job.task.state
    this.enqueue(job, { type: 'finish' })
  }

  export(id: string, formats: unknown, layout: unknown) {
    this.requireCacheIdle()
    const job = this.job(id)
    if (busy.has(job.task.state)) throw new Error('请等待当前字幕任务结束。')
    job.inheritedState = job.task.state
    this.enqueue(job, { type: 'export', formats: outputFormats(formats), layout: oneOf(layout, validLayouts) })
  }

  translate(id: string, ids: unknown) {
    this.requireCacheIdle()
    const job = this.job(id)
    if (busy.has(job.task.state) || job.task.options.translator === 'none') throw new Error('当前任务没有可用的翻译设置。')
    if (!Array.isArray(ids) || !ids.length || ids.length > job.task.cues.length) throw new Error('请选择需要重译的字幕行。')
    const selected = new Set(ids.map((value) => textValue(value, 80)))
    if ([...selected].some((value) => !job.task.cues.some((line) => line.id === value))) throw new Error('要重译的字幕行已不存在。')
    job.inheritedState = job.task.state
    this.enqueue(job, { type: 'translate', ids: selected })
  }

  private async translateRows(job: Job, ids: Set<string>, signal: AbortSignal) {
    this.stage(job, 'translate', 0, '正在重译所选字幕')
    const result = await processText(this.request, job.credentials, job.task.cues, job.task.options, 'translate', signal,
      (done, total) => this.stage(job, 'translate', Math.round(done * 100 / total), '正在重译所选字幕', false), ids)
    this.replaceCues(job, result.cues)
    job.task.retryIds = [...new Set([...job.task.retryIds.filter((id) => !ids.has(id)), ...result.failed])]
    job.complete.delete('export')
    job.complete.delete('synthesize')
  }

  async testModel() {
    const config = await this.context.settings.credentials({ llm: true })
    await chat(this.request, config, [{ role: 'user', content: '回复 OK。' }], AbortSignal.timeout(25_000))
    return '已连接 · ' + config.settings.llm.model
  }

  async checkProgram(engine: ExternalWhisper) {
    oneOf(engine, localEngines)
    const { help: _, ...capabilities } = await inspectWhisper(engine, this.context.settings.settings().local[engine], AbortSignal.timeout(20_000))
    return capabilities
  }
}

function isLoopback(base: string) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(serviceUrl(base).hostname)
}
