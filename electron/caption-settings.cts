import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import type { CaptionSettings, CaptionSettingsChange, ModelEndpoint, WhisperProgram } from '../src/transcription'
import { object, serviceUrl } from './caption-services.cjs'

interface CryptoStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(value: string): Promise<Buffer>
  decryptStringAsync(value: Buffer): Promise<{ result: string }>
}

function defaultProgram(): WhisperProgram {
  return { executable: '', model: '', device: 'cpu', vad: false, vadModel: '', vadThreshold: 0.5, vadMethod: '', prompt: '', separateVoice: false }
}

export const defaultCaptionSettings: CaptionSettings = {
  provider: 'deepseek',
  llm: { base: 'https://api.deepseek.com', model: 'deepseek-flash', hasKey: false },
  whisper: { base: 'https://api.openai.com/v1', model: 'whisper-1', hasKey: false },
  whisperPrompt: '',
  deeplx: '',
  local: { 'whisper-cpp': defaultProgram(), 'faster-whisper': defaultProgram() },
}

export function textValue(value: unknown, limit = 300) {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw new Error('配置字段格式无效。')
  return value.trim()
}

function location(value: unknown) {
  const path = textValue(value, 32_767)
  if (path && !isAbsolute(path)) throw new Error('文件位置必须是绝对路径。')
  return path
}

function validateEndpoint(value: unknown): ModelEndpoint {
  const input = object(value)
  const url = serviceUrl(textValue(input.base, 2048))
  if (url.search) throw new Error('API Base 不能带查询参数。')
  const model = textValue(input.model)
  if (!model) throw new Error('请填写模型 ID。')
  return { base: url.href.replace(/\/$/, ''), model, hasKey: false }
}

function localProgram(input: unknown): WhisperProgram {
  const value = object(input)
  if (value.device !== 'cpu' && value.device !== 'cuda') throw new Error('未知 Whisper 设备。')
  const threshold = Number(value.vadThreshold)
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('VAD 阈值需要在 0 到 1 之间。')
  return { executable: location(value.executable), model: location(value.model), vadModel: location(value.vadModel),
    device: value.device, vad: value.vad === true, vadThreshold: threshold, vadMethod: textValue(value.vadMethod, 64),
    prompt: textValue(value.prompt, 3000), separateVoice: value.separateVoice === true }
}

function validated(value: unknown): CaptionSettings {
  const input = object(value)
  const provider = input.provider
  if (provider !== 'deepseek' && provider !== 'compatible' && provider !== 'ollama' && provider !== 'lm-studio') {
    throw new Error('未知 LLM 服务。')
  }
  const deeplx = textValue(input.deeplx, 2048)
  const local = object(input.local)
  return { provider, llm: validateEndpoint(input.llm), whisper: validateEndpoint(input.whisper),
    whisperPrompt: textValue(input.whisperPrompt, 3000), deeplx: deeplx ? serviceUrl(deeplx).href : '',
    local: { 'whisper-cpp': localProgram(local['whisper-cpp']), 'faster-whisper': localProgram(local['faster-whisper']) } }
}

export async function writeCaptionData(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx' })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

export class CaptionConfiguration {
  private data = structuredClone(defaultCaptionSettings)
  private secrets: { llm?: string; whisper?: string } = {}
  private writes = Promise.resolve()

  constructor(private readonly path: string, private readonly crypto: CryptoStorage, private readonly authorize: (path: string) => void) {}

  async load() {
    try {
      const saved = object(JSON.parse(await readFile(this.path, 'utf8')))
      const settings = validated(saved.settings)
      const secrets = object(saved.secrets ?? {})
      this.data = settings
      this.secrets = {
        llm: typeof secrets.llm === 'string' && secrets.llm.length < 20_000 ? secrets.llm : undefined,
        whisper: typeof secrets.whisper === 'string' && secrets.whisper.length < 20_000 ? secrets.whisper : undefined,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('字幕配置无法读取，已使用默认值。')
    }
  }

  settings() {
    const settings = structuredClone(this.data)
    settings.llm.hasKey = Boolean(this.secrets.llm)
    settings.whisper.hasKey = Boolean(this.secrets.whisper)
    return settings
  }

  async credentials(needs: { llm?: boolean; whisper?: boolean }) {
    await this.writes
    const settings = this.settings()
    const secrets = { ...this.secrets }
    const get = async (value?: string) => {
      if (!value) return ''
      try { return (await this.crypto.decryptStringAsync(Buffer.from(value, 'base64'))).result }
      catch { throw new Error('无法读取已保存的字幕 API Key，请在「模型与 API」重新填写。') }
    }
    return { settings, llmKey: needs.llm ? await get(secrets.llm) : '', whisperKey: needs.whisper ? await get(secrets.whisper) : '' }
  }

  async save(input: CaptionSettingsChange) {
    const settings = validated(input)
    for (const engine of ['whisper-cpp', 'faster-whisper'] as const) {
      for (const field of ['executable', 'model', 'vadModel'] as const) {
        const next = settings.local[engine][field]
        if (next && next !== this.data.local[engine][field]) this.authorize(next)
      }
    }
    const change = this.writes.then(async () => {
      const secret = async (key: string | null | undefined, saved: string | undefined, sameOrigin: boolean) => {
        if (key === undefined) return sameOrigin ? saved : undefined
        if (key === null) return undefined
        const trimmed = textValue(key, 4000)
        if (!trimmed) return sameOrigin ? saved : undefined
        if (!await this.crypto.isAsyncEncryptionAvailable()) throw new Error('系统凭证加密当前不可用，设置未保存。')
        return (await this.crypto.encryptStringAsync(trimmed)).toString('base64')
      }
      const sameOrigin = (a: string, b: string) => new URL(a).origin === new URL(b).origin
      const secrets = {
        llm: await secret(input.llmKey, this.secrets.llm, sameOrigin(this.data.llm.base, settings.llm.base)),
        whisper: await secret(input.whisperKey, this.secrets.whisper, sameOrigin(this.data.whisper.base, settings.whisper.base)),
      }
      await writeCaptionData(this.path, { settings, secrets })
      this.data = settings
      this.secrets = secrets
    })
    this.writes = change.catch(() => undefined)
    await change
    return this.settings()
  }
}
