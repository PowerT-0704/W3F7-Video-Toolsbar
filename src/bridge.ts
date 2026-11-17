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
}
export interface VideoDetails {
  width: number
  height: number
  duration: number
  codec: string
}
export interface ToolStatus {
  version: string
  ffmpeg: string
  ffprobe: string
}
export interface Preferences {
  toolDirectory: string
  outputDirectory: string
  reduceMotion: boolean
  theme: Theme
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
  detect: () => Promise<ToolStatus>
  exportCover: (video: string, cover: string) => Promise<{ path: string }>
  onProgress: (callback: (percent: number) => void) => () => void
  revealOutput: () => Promise<void>
  openLink: (id: ExternalLinkId) => Promise<void>
}
declare global {
  interface Window { videoTools: DesktopAPI }
}
