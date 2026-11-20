import { useEffect, useState } from 'react'
import { AudioLines, CheckCircle2, Cpu, Network, Settings2 } from 'lucide-react'
import { api, errorText, type EngineStatus } from '../workspace'
import type { CaptionPicker, CaptionSettings, ExternalWhisper, WhisperCapabilities, WhisperProgram } from '../transcription'
import { Button } from '../ui/shadcn/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/shadcn/card'
import { CaptionSelect, CaptionToggle, NumberField, PathField, TextField, engineNames } from './CaptionControls'
import './caption.css'

const providers = [
  ['deepseek', 'DeepSeek'], ['compatible', 'OpenAI 兼容'], ['ollama', 'Ollama'], ['lm-studio', 'LM Studio'],
] as const

const presets: Record<CaptionSettings['provider'], { base: string; model: string }> = {
  deepseek: { base: 'https://api.deepseek.com', model: 'deepseek-flash' },
  compatible: { base: 'https://api.openai.com/v1', model: '' },
  ollama: { base: 'http://localhost:11434/v1', model: '' },
  'lm-studio': { base: 'http://localhost:1234/v1', model: '' },
}

export function CaptionSettingsPage() {
  const captions = api.transcription
  const [settings, setSettings] = useState<CaptionSettings>()
  const [llmKey, setLlmKey] = useState<string | null>()
  const [whisperKey, setWhisperKey] = useState<string | null>()
  const [program, setProgram] = useState<ExternalWhisper>('whisper-cpp')
  const [capabilities, setCapabilities] = useState<Partial<Record<ExternalWhisper, WhisperCapabilities>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    let active = true
    void captions.settings().then((value) => { if (active) setSettings(value) }).catch((reason) => { if (active) setError(errorText(reason)) })
    return () => { active = false }
  }, [captions])

  async function action(run: () => Promise<void>) {
    setBusy(true); setError(''); setStatus('')
    try { await run() } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }

  async function save() {
    if (!settings) return
    const saved = await captions.save({ ...settings, llmKey, whisperKey })
    setSettings(saved); setLlmKey(undefined); setWhisperKey(undefined)
  }

  function endpoint(key: 'llm' | 'whisper', field: 'base' | 'model', value: string) {
    setSettings((old) => old && ({ ...old, [key]: { ...old[key], [field]: value } }))
  }

  function updateProgram<K extends keyof WhisperProgram>(kind: ExternalWhisper, key: K, value: WhisperProgram[K]) {
    setSettings((old) => old && ({ ...old, local: { ...old.local, [kind]: { ...old.local[kind], [key]: value } } }))
    if (key === 'executable' || key === 'model') setCapabilities((old) => ({ ...old, [kind]: undefined }))
  }

  function choose(kind: CaptionPicker, key: 'executable' | 'model' | 'vadModel') {
    void action(async () => {
      const path = await captions.choose(kind)
      if (path) updateProgram(program, key, path)
    })
  }

  const selected = settings?.local[program]
  const flags = capabilities[program]
  return <section className="page-layout caption-page">
    <header className="page-header"><h1>模型与 API</h1><p>配置字幕处理模型和可选的语音识别引擎。</p></header>
    {error && <p className="caption-feedback text-destructive" role="alert">{error}</p>}
    {status && <p className="caption-feedback" role="status"><CheckCircle2 size={16} />{status}</p>}
    {settings && selected && <fieldset disabled={busy} className="caption-settings">
      <Card><CardHeader><CardTitle><Network />字幕处理模型</CardTitle></CardHeader>
        <CardContent className="caption-stack">
          <div className="caption-grid">
            <CaptionSelect label="服务" value={settings.provider} choices={providers} onChange={(provider) => {
              setLlmKey(undefined)
              setSettings({ ...settings, provider, llm: { ...presets[provider], hasKey: false } })
            }} />
            <TextField label="模型 ID" value={settings.llm.model} onChange={(event) => endpoint('llm', 'model', event.target.value)} />
            <TextField label="API Base" value={settings.llm.base} onChange={(event) => endpoint('llm', 'base', event.target.value)} />
            <TextField label="API Key" type="password" autoComplete="off" spellCheck={false} value={llmKey ?? ''}
              placeholder={llmKey === null ? '保存后清除' : settings.llm.hasKey ? '已保存，输入可更换' : '待配置'}
              onChange={(event) => setLlmKey(event.target.value || undefined)} />
          </div>
          <div className="caption-actions">
            <Button onClick={() => void action(async () => { await save(); setStatus('设置已保存') })}>保存设置</Button>
            <Button variant="outline" onClick={() => void action(async () => { await save(); setStatus(await captions.testModel()) })}>保存并测试连接</Button>
            {settings.llm.hasKey && <Button variant="ghost" onClick={() => setLlmKey(null)}>清除 Key</Button>}
          </div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle><Settings2 />其他联网服务</CardTitle></CardHeader>
        <CardContent className="caption-stack">
          <TextField label="DeepLX 端点" placeholder="https://你的服务/translate" value={settings.deeplx}
            onChange={(event) => setSettings({ ...settings, deeplx: event.target.value })} />
          <details>
            <summary>Whisper API</summary>
            <div className="caption-grid caption-detail">
              <TextField label="Whisper API Base" value={settings.whisper.base} onChange={(event) => endpoint('whisper', 'base', event.target.value)} />
              <TextField label="Whisper 模型" value={settings.whisper.model} onChange={(event) => endpoint('whisper', 'model', event.target.value)} />
              <TextField label="Whisper Key" type="password" autoComplete="off" spellCheck={false} value={whisperKey ?? ''}
                placeholder={whisperKey === null ? '保存后清除' : settings.whisper.hasKey ? '已保存，输入可更换' : '待配置'}
                onChange={(event) => setWhisperKey(event.target.value || undefined)} />
              <TextField label="识别提示词" value={settings.whisperPrompt} maxLength={3000}
                onChange={(event) => setSettings({ ...settings, whisperPrompt: event.target.value })} />
            </div>
            {settings.whisper.hasKey && <Button variant="ghost" onClick={() => setWhisperKey(null)}>清除 Whisper Key</Button>}
          </details>
          <Button className="justify-self-start" variant="outline" onClick={() => void action(async () => { await save(); setStatus('设置已保存') })}>保存联网服务</Button>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle><Cpu />本地 Whisper</CardTitle></CardHeader>
        <CardContent className="caption-stack">
          <CaptionSelect label="外置程序" value={program} onChange={setProgram}
            choices={[['whisper-cpp', 'whisper.cpp'], ['faster-whisper', 'Faster Whisper']]} />
          <p className="caption-muted">自行下载兼容的 Windows 程序和模型，然后在这里选择路径并检查。</p>
          <div className="caption-grid">
            <PathField label="程序 EXE" value={selected.executable} onChoose={() => choose('program', 'executable')}
              onClear={() => updateProgram(program, 'executable', '')} />
            <PathField label={program === 'whisper-cpp' ? '模型文件' : '模型目录'} value={selected.model}
              onChoose={() => choose(program === 'whisper-cpp' ? 'model' : 'model-directory', 'model')}
              onClear={() => updateProgram(program, 'model', '')} />
            {flags?.device && <CaptionSelect label="设备" value={selected.device} onChange={(value) => updateProgram(program, 'device', value)}
              choices={[['cpu', 'CPU'], ['cuda', 'CUDA / GPU']]} />}
            {flags?.prompt && <TextField label="识别提示词" value={selected.prompt} onChange={(event) => updateProgram(program, 'prompt', event.target.value)} />}
            {flags?.vad && <CaptionToggle label="启用 VAD" checked={selected.vad} onChange={(value) => updateProgram(program, 'vad', value)} />}
            {flags?.vad && selected.vad && <NumberField label="VAD 阈值" value={selected.vadThreshold} min={0} max={1} step={0.05}
              onChange={(value) => updateProgram(program, 'vadThreshold', value)} />}
            {flags?.vad && selected.vad && program === 'whisper-cpp' && <PathField label="VAD 模型" value={selected.vadModel}
              onChoose={() => choose('model', 'vadModel')} onClear={() => updateProgram(program, 'vadModel', '')} />}
            {flags?.vadMethod && selected.vad && <CaptionSelect label="VAD 方法" value={selected.vadMethod}
              onChange={(value) => updateProgram(program, 'vadMethod', value)}
              choices={['', 'silero_v3', 'silero_v4', 'silero_v5', 'silero_v4_fw', 'pyannote_v3', 'pyannote_onnx_v3', 'webrtc', 'auditok']
                .map((id) => [id, id || '程序默认'])} />}
            {flags?.separateVoice && <CaptionToggle label="人声分离" checked={selected.separateVoice}
              onChange={(value) => updateProgram(program, 'separateVoice', value)} />}
          </div>
          <div className="caption-actions">
            <Button variant="outline" onClick={() => void action(async () => { await save(); setStatus('设置已保存') })}>保存本地设置</Button>
            <Button variant="outline" onClick={() => void action(async () => {
              await save()
              const result = await captions.checkProgram(program)
              setCapabilities((old) => ({ ...old, [program]: result }))
              setStatus('程序可输出 SRT · ' + (result.words ? '支持词级时间' : '句级时间') + (result.vad ? ' · 支持 VAD' : ''))
            })}>保存并检查程序</Button>
          </div>
        </CardContent>
      </Card>
    </fieldset>}
  </section>
}

export function CaptionEnginesPage({ engine, onConfigure, onRetry }: { engine: EngineStatus; onConfigure: () => void; onRetry: () => void }) {
  const [settings, setSettings] = useState<CaptionSettings>()
  const [checks, setChecks] = useState<Partial<Record<ExternalWhisper, string>>>({})
  const [checking, setChecking] = useState<ExternalWhisper>()
  useEffect(() => { void api.transcription.settings().then(setSettings).catch(() => setSettings(undefined)) }, [])
  const rows = [
    [engineNames.bijian, '联网 · 上传音频', '中英语音，句段与字词时间，默认识别服务。'],
    [engineNames.jianying, '联网 · 上传音频', '中英语音，依赖签名与上传服务，时间精度以返回结果为准。'],
    [engineNames['whisper-api'], '联网 · 独立 API 配置', '语言和时间粒度由所选模型决定。'],
    [engineNames['whisper-cpp'], '离线 · 自备程序和模型', '输出句级 SRT，重断句可估算词时间。支持 VAD 的版本可选择 VAD 模型。'],
    [engineNames['faster-whisper'], '离线 · 自备程序和模型', '词级时间、VAD、CPU/CUDA 和人声分离取决于 CLI 版本。'],
  ]
  return <section className="page-layout caption-page">
    <header className="page-header"><h1>引擎说明</h1><p>查看语音识别、字幕处理和视频合成使用的服务。</p></header>
    <div className="caption-stack">
      <Card><CardHeader><CardTitle><AudioLines />语音识别</CardTitle></CardHeader>
        <CardContent className="caption-stack">{rows.map(([name, source, text]) =>
          <div className="caption-engine" key={name}><strong>{name}</strong><span>{source}</span><p>{text}</p></div>)}
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle><Network />断句与翻译</CardTitle></CardHeader>
        <CardContent className="caption-stack">
          <p>规则断句在本机运行。语义断句、校正和 LLM 翻译使用设置中的模型，默认 DeepSeek Flash。微软、谷歌和 DeepLX 可单独用于翻译。</p>
          <Button className="justify-self-start" variant="outline" onClick={onConfigure}>打开模型与 API</Button>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle><Cpu />本机检查</CardTitle></CardHeader>
        <CardContent className="caption-stack">
          <p>{engine.kind === 'ready' ? 'FFmpeg / FFprobe 已连接 · ' + engine.tools.version :
            engine.kind === 'checking' ? '正在检查 FFmpeg 和 FFprobe' : engine.message}</p>
          <div className="caption-actions">
            <Button variant="outline" onClick={onRetry}>重新检测 FFmpeg</Button>
            {(['whisper-cpp', 'faster-whisper'] as const).map((kind) => <Button key={kind} variant="outline"
              disabled={Boolean(checking) || !settings?.local[kind].executable}
              onClick={() => {
                setChecking(kind)
                void api.transcription.checkProgram(kind).then((value) => setChecks((old) => ({ ...old, [kind]: '已兼容 SRT' +
                  (value.words ? '，词级时间' : '，句级时间') + (value.vad ? '，支持 VAD' : '') })))
                  .catch((reason) => setChecks((old) => ({ ...old, [kind]: errorText(reason) }))).finally(() => setChecking(undefined))
              }}>检查 {kind}</Button>)}
          </div>
          {Object.entries(checks).map(([name, message]) => <p className="caption-muted" key={name}>{name} · {message}</p>)}
        </CardContent>
      </Card>
    </div>
  </section>
}
