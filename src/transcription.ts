export type SpeechEngine = 'bijian' | 'jianying' | 'whisper-api' | 'whisper-cpp' | 'faster-whisper'
export type CaptionMode = 'transcribe' | 'subtitles' | 'transcribe-subtitles' | 'full' | 'synthesize'
export type CaptionFormat = 'srt' | 'ass' | 'vtt' | 'txt' | 'json'
export type CaptionLayout = 'source' | 'translation' | 'source-first' | 'translation-first'
export type Translator = 'none' | 'llm' | 'bing' | 'google' | 'deeplx'
export type CaptionStage = 'prepare' | 'recognize' | 'split' | 'correct' | 'translate' | 'export' | 'synthesize'

export interface CaptionCue {
  id: string
  start: number
  end: number
  original: string
  text: string
  translation: string
  timing: 'word' | 'estimated' | 'segment'
}

export interface SubtitleStyle {
  font: string
  fontFile?: string
  size: number
  outline: number
  bottom: number
  color: string
  background: string
  opacity: number
  radius: number
  padding: number
  spacing: number
}

export interface CaptionOptions {
  mode: CaptionMode
  engine: SpeechEngine
  language: string
  split: 'original' | 'rules' | 'llm'
  correct: boolean
  translator: Translator
  target: string
  reflect: boolean
  prompt: string
  cjk: number
  words: number
  batch: number
  concurrency: number
  layout: CaptionLayout
  formats: CaptionFormat[]
  synthesis: 'soft' | 'ass' | 'rounded'
  container: 'mp4' | 'mkv'
  quality: 18 | 23 | 28 | 32
  style: SubtitleStyle
  review: boolean
  output?: string
}

export interface CaptionAsset {
  id: string
  name: string
  kind: 'media' | 'subtitle'
  duration: number
  video: boolean
  tracks: Array<{ index: number; language: string; channels: number }>
  preview?: string
}

export interface CaptionInput {
  media?: string
  subtitle?: string
  track: number
  mode?: CaptionMode
}

export interface CaptionTask {
  id: string
  name: string
  media?: CaptionAsset
  state: 'queued' | 'running' | 'review' | 'done' | 'warning' | 'failed' | 'cancelled'
  stage?: CaptionStage
  progress: number | null
  message: string
  cues: CaptionCue[]
  revision: number
  warnings: string[]
  retryIds: string[]
  outputs: Array<{ name: string; kind: CaptionFormat | 'video'; id: string }>
  options: CaptionOptions
}

export type ExternalWhisper = 'whisper-cpp' | 'faster-whisper'
export interface WhisperProgram {
  executable: string
  model: string
  device: 'cpu' | 'cuda'
  vad: boolean
  vadModel: string
  vadThreshold: number
  vadMethod: string
  prompt: string
  separateVoice: boolean
}

export interface ModelEndpoint {
  base: string
  model: string
  hasKey: boolean
}

export interface CaptionSettings {
  provider: 'deepseek' | 'compatible' | 'ollama' | 'lm-studio'
  llm: ModelEndpoint
  whisper: ModelEndpoint
  whisperPrompt: string
  deeplx: string
  local: Record<ExternalWhisper, WhisperProgram>
}

export interface CaptionSettingsChange extends CaptionSettings {
  llmKey?: string | null
  whisperKey?: string | null
}

export type CaptionPicker = 'output' | 'program' | 'model' | 'model-directory' | 'font'

export interface CaptionCacheStatus {
  directory: string
  custom: boolean
  bytes: number
  activeBytes: number
  warning?: string
}

export interface TranscriptionAPI {
  pick: (type: 'media' | 'subtitle') => Promise<{ assets: CaptionAsset[]; errors: string[] }>
  drop: (files: File[]) => Promise<{ assets: CaptionAsset[]; errors: string[] }>
  choose: (kind: CaptionPicker) => Promise<string | null>
  preview: (id: string) => Promise<string>
  tasks: () => Promise<CaptionTask[]>
  create: (inputs: CaptionInput[], options: CaptionOptions) => Promise<CaptionTask[]>
  cancel: (id?: string) => Promise<void>
  retry: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  edit: (id: string, revision: number, cues: CaptionCue[]) => Promise<CaptionTask>
  translate: (id: string, ids: string[]) => Promise<void>
  finish: (id: string, output: Pick<CaptionOptions, 'container' | 'synthesis' | 'layout'>) => Promise<void>
  export: (id: string, formats: CaptionFormat[], layout: CaptionLayout) => Promise<void>
  reveal: (id: string) => Promise<void>
  settings: () => Promise<CaptionSettings>
  save: (settings: CaptionSettingsChange) => Promise<CaptionSettings>
  testModel: () => Promise<string>
  checkProgram: (engine: ExternalWhisper) => Promise<WhisperCapabilities>
  onTask: (callback: (task: CaptionTask) => void) => () => void
  onTaskRemoved: (callback: (id: string) => void) => () => void
  cacheStatus: () => Promise<CaptionCacheStatus>
  chooseCache: () => Promise<CaptionCacheStatus | null>
  resetCache: () => Promise<CaptionCacheStatus>
  openCache: () => Promise<void>
  clearCache: () => Promise<{ released: number; incomplete: boolean }>
}

export interface WhisperCapabilities {
  words: boolean
  vad: boolean
  prompt: boolean
  device: boolean
  separateVoice: boolean
  vadMethod: boolean
}
