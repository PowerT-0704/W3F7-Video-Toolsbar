import type { Theme, ToolStatus } from './bridge'

export const api = window.videoTools
export const initialTheme: Theme = new URLSearchParams(window.location.search).get('theme') === 'light' ? 'light' : 'dark'

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export type EngineStatus =
  | { kind: 'checking' }
  | { kind: 'ready'; tools: ToolStatus }
  | { kind: 'missing'; message: string }

export function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
