export type AssetKind = 'video' | 'cover'
export type Page = 'home' | 'cover' | 'changelog' | 'settings' | 'about'
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
  onProgress: (callback: (percent: number) => void) => () => void
  revealOutput: () => Promise<void>
  openLink: (id: ExternalLinkId) => Promise<void>
}
declare global {
  interface Window { videoTools: DesktopAPI }
}
