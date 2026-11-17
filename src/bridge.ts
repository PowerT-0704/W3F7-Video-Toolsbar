export type AssetKind = 'video' | 'cover'
export type Page = 'cover' | 'settings' | 'about'
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
}
export interface DesktopAPI {
  pick: (kind: AssetKind) => Promise<Asset | null>
  drop: (files: File[]) => Promise<Asset[]>
  inspect: (id: string) => Promise<VideoDetails>
  settings: () => Promise<Preferences>
  setReducedMotion: (enabled: boolean) => Promise<Preferences>
  chooseDirectory: (setting: 'toolDirectory' | 'outputDirectory') => Promise<Preferences>
  resetDirectory: (setting: 'toolDirectory' | 'outputDirectory') => Promise<Preferences>
  detect: () => Promise<ToolStatus>
  exportCover: (video: string, cover: string) => Promise<{ path: string }>
  onProgress: (callback: (percent: number) => void) => () => void
  revealOutput: () => Promise<void>
  openLink: (id: 'github' | 'ffmpeg' | 'icaros' | 'ezqr' | 'campuslink') => Promise<void>
}
declare global {
  interface Window { videoTools: DesktopAPI }
}
