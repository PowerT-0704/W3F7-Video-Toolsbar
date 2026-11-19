export type AssetKind = 'video' | 'cover'
export type Page = 'home' | 'cover' | 'music' | 'changelog' | 'settings' | 'about'
export type MusicFormat = 'flac' | 'mp3'
export interface MusicCover {
  index: number
  label: string
  width?: number
  height?: number
  extension?: string
  preview?: string
}
export interface MusicInfo {
  id: string
  name: string
  format: MusicFormat
  playback: string
  covers: MusicCover[]
  lyrics: string[]
  lyricWarning?: string
  writeIssue?: string
  lyricWriteIssue?: string
  coverWriteIssue?: string
}
export interface MusicLyric { id: string; name: string; text: string }
export interface MusicImage { id: string; name: string; width: number; height: number; preview: string }
export interface MusicCoverDraft extends MusicImage { bytes: number }
export interface SquareCrop { x: number; y: number; size: number }
export interface MusicExport { coverId?: string; lyricId?: string }
export interface MusicSelection { audio: MusicInfo; imported?: MusicLyric; draft?: MusicCoverDraft }
export type Theme = 'dark' | 'light'
export type ExternalLinkId = 'github' | 'ffmpeg' | 'icaros' | 'ezqr' | 'campuslink' |
  'website' | 'bilibili' | 'qq' | 'shadcn' | 'magicui' | 'reactbits'
export interface Asset {
  id: string
  kind: AssetKind
  name: string
  path: string
  bytes: number
  preview?: string
  frameSource?: string
}
export interface VideoDetails {
  width: number
  height: number
  duration: number
  codec: string
  startTime: number
  timeBase: number
  videoEnd?: number
}
export interface VideoFrame {
  id: string
  time: number
  preview: string
}
export interface ToolStatus {
  version: string
  ffmpeg: string
  ffprobe: string
}
export interface ToolCheck {
  inPath: boolean
  tools?: ToolStatus
  message?: string
}
export type UpdateResult =
  | { kind: 'available'; version: string }
  | { kind: 'current' }
  | { kind: 'error'; message: string }
export interface Preferences {
  toolDirectory: string
  outputDirectory: string
  cacheDirectory: string
  reduceMotion: boolean
  theme: Theme
  welcomeSeen: boolean
}
export interface MediaCacheStatus {
  directory: string
  bytes: number
  activeBytes: number
  warning: string
}
export interface MediaCacheMove {
  preferences: Preferences
  moved: number
  incomplete: boolean
}
export interface DesktopAPI {
  pick: (kind: AssetKind) => Promise<Asset | null>
  drop: (files: File[]) => Promise<Asset[]>
  inspect: (id: string) => Promise<VideoDetails>
  settings: () => Promise<Preferences>
  setReducedMotion: (enabled: boolean) => Promise<Preferences>
  setTheme: (theme: Theme) => Promise<Preferences>
  previewTitleBar: (tone: Theme | null) => Promise<void>
  chooseDirectory: (setting: 'toolDirectory' | 'outputDirectory') => Promise<Preferences>
  resetDirectory: (setting: 'toolDirectory' | 'outputDirectory') => Promise<Preferences>
  cacheStatus: () => Promise<MediaCacheStatus>
  chooseCacheDirectory: () => Promise<MediaCacheMove | null>
  resetCacheDirectory: () => Promise<MediaCacheMove>
  openCacheDirectory: () => Promise<void>
  clearMediaCache: () => Promise<{ released: number; incomplete: boolean }>
  detect: () => Promise<ToolCheck>
  completeWelcome: () => Promise<Preferences>
  openAnimationSettings: () => Promise<void>
  checkUpdates: () => Promise<UpdateResult>
  openUpdate: () => Promise<void>
  extractFrame: (videoId: string, time: number, presented: boolean) => Promise<VideoFrame>
  cancelFrame: (videoId: string) => Promise<void>
  useFrame: (id: string) => Promise<Asset>
  saveFrame: (id: string) => Promise<boolean>
  exportCover: (video: string, cover: string) => Promise<{ path: string }>
  pickMusic: () => Promise<MusicSelection | null>
  pickMusicLyric: (audio: string) => Promise<MusicSelection | null>
  dropMusic: (files: File[]) => Promise<MusicSelection>
  pickMusicCover: (audio: string) => Promise<MusicImage | null>
  cancelMusicCoverPick: (audio: string, image: string) => Promise<void>
  prepareMusicCover: (audio: string, image: string, crop: SquareCrop) => Promise<MusicSelection>
  discardMusicCover: (audio: string) => Promise<MusicSelection>
  discardMusicLyric: (audio: string) => Promise<MusicSelection>
  saveMusicCover: (audio: string, index: number) => Promise<boolean>
  saveMusicLyric: (audio: string, index: number) => Promise<boolean>
  exportMusic: (audio: string, changes: MusicExport) => Promise<string | null>
  revealMusic: (audio: string) => Promise<void>
  onProgress: (callback: (percent: number) => void) => () => void
  revealOutput: () => Promise<void>
  openLink: (id: ExternalLinkId) => Promise<void>
}
declare global {
  interface Window { videoTools: DesktopAPI }
}
