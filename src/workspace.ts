import type { ToolStatus } from './bridge'

export const api = window.videoTools

export type EngineStatus =
  | { kind: 'checking' }
  | { kind: 'ready'; tools: ToolStatus }
  | { kind: 'missing'; message: string }

export function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
