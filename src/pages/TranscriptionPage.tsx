import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { AudioLines, Check, ChevronRight, FileText, Film, FolderOpen, Play, Square, Upload, X } from 'lucide-react'
import type { CaptionAsset, CaptionCue, CaptionFormat, CaptionInput, CaptionLayout, CaptionMode, CaptionOptions, CaptionTask,
  SubtitleStyle } from '../transcription'
import { api, errorText, type EngineStatus } from '../workspace'
import { ActionButton } from '../ui/action-button'
import { Button } from '../ui/shadcn/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/shadcn/card'
import { CaptionSelect, CaptionToggle, Field, FormatChecks, LayoutSelect, NumberField, PathField, TextField, engineNames,
  parseTime, targetLanguages, timeLabel } from './CaptionControls'
import './caption.css'

const initialOptions: CaptionOptions = {
  mode: 'full', engine: 'bijian', language: 'auto', split: 'rules', correct: false, translator: 'none',
  target: 'zh-Hans', reflect: false, prompt: '', cjk: 12, words: 18, batch: 10, concurrency: 10, layout: 'source-first',
  formats: ['srt'], synthesis: 'soft', container: 'mp4', quality: 28, review: true,
  style: { font: 'Microsoft YaHei', size: 42, outline: 2, bottom: 42, color: '#ffffff', background: '#151515',
    opacity: 78, radius: 12, padding: 14, spacing: 6 },
}

const modes: [CaptionMode, string][] = [
  ['transcribe', '仅转录'], ['subtitles', '处理已有字幕'], ['transcribe-subtitles', '转录并处理字幕'],
  ['full', '全流程'], ['synthesize', '仅合成'],
]

const translators: [CaptionOptions['translator'], string][] = [
  ['none', '不翻译'], ['llm', 'LLM'], ['bing', '微软翻译 · 免 Key'], ['google', '谷歌翻译 · 免 Key'], ['deeplx', 'DeepLX'],
]

const stateNames: Record<CaptionTask['state'], string> = {
  queued: '排队中', running: '处理中', review: '待校对', done: '已完成', warning: '待复核', failed: '失败', cancelled: '已取消',
}

const waiting = (task?: CaptionTask) => task?.state === 'queued' || task?.state === 'running'
const workflowNeedsMedia = (mode: CaptionMode) => mode !== 'subtitles'

function localText(line: CaptionCue, layout: CaptionLayout) {
  if (!line.translation || layout === 'source') return line.text
  if (layout === 'translation') return line.translation
  return layout === 'source-first' ? line.text + '\n' + line.translation : line.translation + '\n' + line.text
}

function currentCueIndex(cues: CaptionCue[], time: number) {
  let low = 0
  let high = cues.length - 1
  let result = -1
  while (low <= high) {
    const middle = (low + high) >>> 1
    if (cues[middle].start <= time) { result = middle; low = middle + 1 }
    else high = middle - 1
  }
  while (result >= 0) {
    if (cues[result].end > time) return result
    result--
    if (result >= 0 && time - cues[result].start > 60_000) break
  }
  return -1
}

function Editor({ task, visible, onChange, onAction, onDirty }: { task: CaptionTask; visible: boolean;
  onChange: (task: CaptionTask) => void; onAction: (action: () => Promise<void>) => void; onDirty: (dirty: boolean) => void }) {
  const captionApi = api.transcription
  const [draft, setDraft] = useState(task.cues)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [changed, setChanged] = useState(false)
  const [currentMs, setCurrentMs] = useState(0)
  const [timeError, setTimeError] = useState('')
  const [offset, setOffset] = useState(0)
  const [url, setUrl] = useState(task.media?.preview)
  const [fallback, setFallback] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const player = useRef<HTMLMediaElement | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const active = useRef(true)
  const isBusy = waiting(task)
  const playing = currentCueIndex(draft, currentMs)
  const first = Math.max(0, Math.floor(offset / 72) - 4)
  const shown = draft.slice(first, first + 16)
  const missing = draft.filter((line) => !line.translation.trim()).length
  const timeName = draft.some((line) => line.timing === 'estimated') ? '含估算词时间' :
    draft.some((line) => line.timing === 'word') ? '含识别词时间' : '句级时间'
  const translationWarning = new Set(task.retryIds)

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  useEffect(() => { if (!visible) player.current?.pause() }, [visible])
  useEffect(() => { onDirty(changed) }, [changed, onDirty])

  function jump(time: number) {
    if (!player.current) return
    player.current.currentTime = time / 1000
    setCurrentMs(time)
  }

  function trackTime() {
    if (!player.current) return
    const millis = Math.round(player.current.currentTime * 1000)
    setCurrentMs(millis)
  }

  function previewFallback() {
    if (!task.media || fallback) { setPreviewError('本机播放器无法预览此文件，字幕仍可编辑和导出。'); return }
    setFallback(true)
    setPreviewError('正在生成本地预览副本…')
    void captionApi.preview(task.media.id)
      .then((path) => { if (active.current) { setUrl(path); setPreviewError('') } })
      .catch((reason) => { if (active.current) setPreviewError(errorText(reason)) })
  }

  function edit(id: string, changes: Partial<CaptionCue>) {
    setDraft((items) => items.map((line) => line.id === id ? { ...line, ...changes } : line))
    setChanged(true)
  }

  function setSelection(id: string, checked: boolean) {
    setSelected((old) => {
      const set = new Set(old)
      if (checked) set.add(id); else set.delete(id)
      return set
    })
  }

  function merge() {
    const positions = draft.flatMap((line, index) => selected.has(line.id) ? [index] : [])
    if (positions.length < 2 || positions.at(-1)! - positions[0] !== positions.length - 1) {
      setTimeError('请选择连续的两行或更多字幕。')
      return
    }
    const start = positions[0]
    const end = positions.at(-1)!
    const group = draft.slice(start, end + 1)
    const merged = { ...group[0], end: Math.max(...group.map((line) => line.end)),
      text: group.map((line) => line.text).join('\n'), translation: group.map((line) => line.translation).filter(Boolean).join('\n') }
    setDraft([...draft.slice(0, start), merged, ...draft.slice(end + 1)])
    setSelected(new Set()); setChanged(true); setTimeError('')
  }

  function discard() {
    setDraft((old) => old.filter((line) => !selected.has(line.id)))
    setSelected(new Set()); setChanged(true); setTimeError('')
    viewport.current?.scrollTo(0, 0)
  }

  async function save() {
    const bad = draft.find((line) => !Number.isFinite(line.start) || !Number.isFinite(line.end) || line.start >= line.end || !line.text.trim())
    if (bad) throw new Error('第 ' + bad.id + ' 行的时间或原文无效。')
    onChange(await captionApi.edit(task.id, task.revision, draft))
  }

  const media = task.media && url && (task.media.video
    ? <video aria-label="字幕视频预览" src={url} controls preload="metadata" onTimeUpdate={trackTime} onError={previewFallback}
      ref={(node) => { player.current = node }} />
    : <audio aria-label="字幕音频预览" src={url} controls preload="metadata" onTimeUpdate={trackTime} onError={previewFallback}
      ref={(node) => { player.current = node }} />)
  return <div className="caption-stack">
    {media && <div className={task.media?.video ? 'caption-preview is-video' : 'caption-preview'}>
      {media}
      {playing >= 0 && <button type="button" className="caption-current" onClick={() => {
        viewport.current?.scrollTo({ top: playing * 72, behavior: 'instant' })
      }}>{localText(draft[playing], task.options.layout)}</button>}
      {previewError && <p role="status" className="caption-muted">{previewError}</p>}
    </div>}
    <div className="caption-actions caption-editor-actions">
      <span className="caption-muted">{draft.length} 行 · {timeName}{task.options.translator !== 'none' ? ' · ' + missing + ' 行缺译文' : ''}</span>
      <Button size="sm" variant="outline" disabled={isBusy || selected.size < 2} onClick={merge}>合并</Button>
      <Button size="sm" variant="outline" disabled={isBusy || !selected.size} onClick={discard}>删除</Button>
      {task.options.translator !== 'none' && <Button size="sm" variant="outline" disabled={isBusy || !selected.size || changed}
        onClick={() => onAction(() => captionApi.translate(task.id, [...selected]))}>重译所选</Button>}
      {task.retryIds.length > 0 && <Button size="sm" variant="outline" disabled={isBusy || changed}
        onClick={() => onAction(() => captionApi.translate(task.id, task.retryIds))}>重译失败行</Button>}
      <Button size="sm" disabled={isBusy || !changed} onClick={() => onAction(save)}><Check />保存校对</Button>
    </div>
    {timeError && <p role="alert" className="text-destructive text-sm">{timeError}</p>}
    <div className="caption-table" role="table" aria-label="字幕校对">
      <div className="caption-row caption-table-heading" role="row">
        <span role="columnheader">行</span><span role="columnheader">时间</span><span role="columnheader">原文</span><span role="columnheader">译文</span>
      </div>
      <div ref={viewport} className="caption-rows" onScroll={(event) => setOffset(event.currentTarget.scrollTop)}>
        <div style={{ height: first * 72 }} aria-hidden />
        {shown.map((line, index) => <div role="row" className="caption-row" data-current={first + index === playing}
          data-failed={translationWarning.has(line.id)} key={line.id}>
          <div role="cell" className="caption-line-number">
            <input type="checkbox" checked={selected.has(line.id)} aria-label={'选择第 ' + line.id + ' 行'} disabled={isBusy}
              onChange={(event) => setSelection(line.id, event.currentTarget.checked)} />
            <button className="caption-jump" type="button" disabled={!task.media} onClick={() => jump(line.start)} title="跳到字幕位置">{line.id}</button>
          </div>
          <div role="cell" className="caption-times">
            {(['start', 'end'] as const).map((kind) => <input key={kind} defaultValue={timeLabel(line[kind])} disabled={isBusy}
              aria-label={(kind === 'start' ? '开始时间 ' : '结束时间 ') + line.id} onBlur={(event) => {
                const value = parseTime(event.currentTarget.value)
                if (!Number.isFinite(value)) {
                  setTimeError('请输入 HH:MM:SS.mmm 格式。')
                  event.currentTarget.value = timeLabel(line[kind])
                  return
                }
                setTimeError('')
                if (value !== line[kind]) edit(line.id, { [kind]: value })
              }} />)}
          </div>
          <div role="cell"><textarea aria-label={'原文 ' + line.id} value={line.text} rows={2} disabled={isBusy}
            onChange={(event) => edit(line.id, { text: event.currentTarget.value })} /></div>
          <div role="cell"><textarea aria-label={'译文 ' + line.id} value={line.translation} rows={2} disabled={isBusy}
            onChange={(event) => edit(line.id, { translation: event.currentTarget.value })} /></div>
        </div>)}
        <div style={{ height: Math.max(0, draft.length - first - shown.length) * 72 }} aria-hidden />
      </div>
    </div>
    {changed && <p className="caption-muted" role="status">有未保存的校对内容。</p>}
  </div>
}

function TaskOutputs({ task, onAction, dirty }: { task: CaptionTask; onAction: (action: () => Promise<void>) => void; dirty: boolean }) {
  const [formats, setFormats] = useState<CaptionFormat[]>(task.options.formats)
  const [layout, setLayout] = useState(task.options.layout)
  const [container, setContainer] = useState(task.options.container)
  const [synthesis, setSynthesis] = useState(task.options.synthesis)
  const busy = waiting(task)
  return <div className="caption-stack">
    {!!task.outputs.length && <div className="caption-output-list" aria-label="生成的文件">
      {task.outputs.map((output) => <Button key={output.id} type="button" variant="outline"
        title={output.name} onClick={() => onAction(() => api.transcription.reveal(output.id))}>
        <FolderOpen /><span className="truncate">{output.name}</span>
      </Button>)}
    </div>}
    {!!task.cues.length && <div className="caption-action-panel">
      <FormatChecks formats={formats} onChange={setFormats} />
      <LayoutSelect value={layout} onChange={setLayout} />
      {task.media?.video && <>
        <CaptionSelect label="成品字幕类型" value={synthesis} onChange={setSynthesis}
          choices={[['soft', '软字幕轨'], ['ass', 'ASS 描边'], ['rounded', '圆角背景']]} />
        <CaptionSelect label="成品容器" value={container} onChange={setContainer} choices={[['mp4', 'MP4'], ['mkv', 'MKV']]} />
      </>}
      <div className="caption-actions">
        <Button variant="outline" disabled={busy || dirty} onClick={() => onAction(() => api.transcription.export(task.id, formats, layout))}>导出字幕</Button>
        {task.media?.video && <Button disabled={busy || dirty}
          onClick={() => onAction(() => api.transcription.finish(task.id, { container, synthesis, layout }))}>合成视频</Button>}
      </div>
    </div>}
  </div>
}

function SubtitleAppearance({ style, rounded, onChange, pickFont }: {
  style: SubtitleStyle; rounded: boolean; onChange: (style: SubtitleStyle) => void; pickFont: () => void
}) {
  return <details><summary>字幕样式</summary><div className="caption-grid caption-detail">
    <CaptionSelect label="样式预设" value="" choices={[['', '自定义'], ['standard', '标准'], ['outline', '粗描边'], ['rounded', '半透明圆角']]}
      onChange={(value) => {
        if (value === 'standard') onChange({ ...initialOptions.style, fontFile: style.fontFile })
        if (value === 'outline') onChange({ ...style, size: 49, outline: 4, bottom: 52 })
        if (value === 'rounded') onChange({ ...style, background: '#14171f', color: '#ffffff', opacity: 70, radius: 16, padding: 19 })
      }} />
    <TextField label="字体名称" value={style.font} maxLength={100} onChange={(event) => onChange({ ...style, font: event.target.value })} />
    <PathField label="本地字体" value={style.fontFile || ''} onChoose={pickFont} onClear={() => onChange({ ...style, fontFile: undefined })} />
    <NumberField label="字号" min={10} max={160} value={style.size} onChange={(size) => onChange({ ...style, size })} />
    <NumberField label="底部距离" min={0} max={300} value={style.bottom} onChange={(bottom) => onChange({ ...style, bottom })} />
    <TextField label="字体颜色" type="color" value={style.color} onChange={(event) => onChange({ ...style, color: event.target.value })} />
    {rounded ? <>
      <TextField label="背景颜色" type="color" value={style.background} onChange={(event) => onChange({ ...style, background: event.target.value })} />
      <NumberField label="背景不透明度" min={0} max={100} value={style.opacity} onChange={(opacity) => onChange({ ...style, opacity })} />
      <NumberField label="圆角半径" min={0} max={80} value={style.radius} onChange={(radius) => onChange({ ...style, radius })} />
      <NumberField label="内边距" min={0} max={100} value={style.padding} onChange={(padding) => onChange({ ...style, padding })} />
      <NumberField label="行距" min={0} max={80} value={style.spacing} onChange={(spacing) => onChange({ ...style, spacing })} />
    </> : <NumberField label="描边" min={0} max={12} value={style.outline} onChange={(outline) => onChange({ ...style, outline })} />}
  </div></details>
}

export function TranscriptionPage({ active, engine, onConfigure, onSettings }: {
  active: boolean; engine: EngineStatus; onConfigure: () => void; onSettings: () => void
}) {
  const captionApi = api.transcription
  const [assets, setAssets] = useState<CaptionAsset[]>([])
  const [tracks, setTracks] = useState<Record<string, number>>({})
  const [pairs, setPairs] = useState<Record<string, string>>({})
  const [modesByAsset, setModesByAsset] = useState<Record<string, CaptionMode>>({})
  const [options, setOptions] = useState(initialOptions)
  const [tasks, setTasks] = useState<CaptionTask[]>([])
  const [taskId, setTaskId] = useState('')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [endpoints, setEndpoints] = useState({ llm: 'api.deepseek.com', whisper: 'api.openai.com', deeplx: '' })
  const depth = useRef(0)

  useEffect(() => {
    let open = true
    const unsubscribe = captionApi.onTask((task) => {
      if (!open) return
      setTasks((items) => items.some((item) => item.id === task.id) ? items.map((item) => item.id === task.id ? task : item) : [...items, task])
    })
    void captionApi.tasks().then((items) => {
      if (open) setTasks((current) => [...items.filter((item) => !current.some((entry) => entry.id === item.id)), ...current])
    }).catch((reason) => { if (open) setError(errorText(reason)) })
    return () => { open = false; unsubscribe() }
  }, [captionApi])

  useEffect(() => {
    if (!active) return
    let open = true
    const hostname = (value: string) => value ? new URL(value).host : ''
    void captionApi.settings().then((value) => {
      if (open) setEndpoints({ llm: hostname(value.llm.base), whisper: hostname(value.whisper.base), deeplx: hostname(value.deeplx) })
    }).catch((reason) => { if (open) setError(errorText(reason)) })
    return () => { open = false }
  }, [active, captionApi])

  const media = useMemo(() => assets.filter((asset) => asset.kind === 'media'), [assets])
  const subtitles = useMemo(() => assets.filter((asset) => asset.kind === 'subtitle'), [assets])
  const task = tasks.find((item) => item.id === taskId) ?? tasks.at(-1)
  const running = tasks.filter(waiting).length
  const modesUsed = [options.mode, ...media.map((item) => modesByAsset[item.id]).filter(Boolean)]
  const recognize = modesUsed.some((mode) => mode !== 'subtitles' && mode !== 'synthesize')
  const process = modesUsed.some((mode) => mode === 'subtitles' || mode === 'transcribe-subtitles' || mode === 'full')
  const canSynthesize = modesUsed.includes('full') || modesUsed.includes('synthesize')
  const inputs: CaptionInput[] = []
  for (const item of media) {
    const mode = modesByAsset[item.id] || options.mode
    const matching = subtitles.find((file) => file.name.replace(/\.[^.]+$/, '') === item.name.replace(/\.[^.]+$/, ''))
    const fallback = matching?.id || (media.length === 1 && subtitles.length === 1 ? subtitles[0]?.id : undefined)
    if (mode === 'subtitles' && !pairs[item.id] && !fallback) continue
    inputs.push({ media: item.id, subtitle: (pairs[item.id] ?? fallback) || undefined,
      track: tracks[item.id] ?? item.tracks[0]?.index ?? -1, mode })
  }
  if (options.mode === 'subtitles') {
    for (const subtitle of subtitles) {
      if (!inputs.some((item) => item.subtitle === subtitle.id)) inputs.push({ subtitle: subtitle.id, track: -1, mode: 'subtitles' })
    }
  }
  const recipients = new Set<string>()
  const willRecognize = inputs.some((input) => input.mode === 'transcribe' || input.mode === 'transcribe-subtitles' ||
    input.mode === 'full' && !input.subtitle)
  const asrReceiver = { bijian: '必剪', jianying: '剪映（另需签名服务）', 'whisper-api': endpoints.whisper }[options.engine as 'bijian' | 'jianying' | 'whisper-api']
  if (willRecognize && asrReceiver) recipients.add('音频 → ' + asrReceiver)
  if (options.split === 'llm' && modesUsed.some((mode) => mode !== 'synthesize') ||
      process && (options.correct || options.translator === 'llm')) recipients.add('字幕文本 → ' + endpoints.llm)
  if (process && options.translator !== 'none' && options.translator !== 'llm') {
    const destination = { bing: '微软翻译', google: '谷歌翻译', deeplx: endpoints.deeplx || 'DeepLX' }[options.translator]
    recipients.add('字幕文本 → ' + destination)
  }

  function update<K extends keyof CaptionOptions>(key: K, value: CaptionOptions[K]) {
    setOptions((old) => ({ ...old, [key]: value }))
  }

  async function action(run: () => Promise<void>) {
    setError('')
    try { await run() } catch (reason) { setError(errorText(reason)) }
  }

  function importAssets(run: () => ReturnType<typeof captionApi.pick>) {
    void action(async () => {
      const result = await run()
      setAssets((old) => [...new Map([...old, ...result.assets].map((asset) => [asset.id, asset])).values()])
      if (result.errors.length) setError(result.errors.join('\n'))
    })
  }

  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    depth.current = 0
    setDragging(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length) importAssets(() => captionApi.drop(files))
  }

  function chooseOutput() {
    void action(async () => {
      const path = await captionApi.choose('output')
      if (path) update('output', path)
    })
  }

  function chooseFont() {
    void action(async () => {
      const path = await captionApi.choose('font')
      if (path) setOptions((old) => ({ ...old, style: { ...old.style, fontFile: path } }))
    })
  }

  function submit() {
    setSubmitting(true)
    void action(async () => {
      const added = await captionApi.create(inputs, options)
      setTaskId(added[0].id)
    }).finally(() => setSubmitting(false))
  }

  function replaceTask(next: CaptionTask) {
    setDirty(false)
    setTasks((items) => items.map((item) => item.id === next.id ? next : item))
  }

  return <section className="page-layout caption-page" onDrop={drop} onDragOver={(event) => event.preventDefault()}
    onDragEnter={(event) => {
      if (event.dataTransfer.types.includes('Files')) { depth.current++; setDragging(true) }
    }} onDragLeave={() => {
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setDragging(false)
    }}>
    <header className="page-header caption-title">
      <div><h1>语音转录</h1><p>从本地音视频生成字幕，校对后导出或合成。</p></div>
      <Button variant="outline" onClick={onConfigure}>模型与 API</Button>
    </header>
    {error && <p className="caption-feedback text-destructive" role="alert">{error}</p>}
    {engine.kind === 'missing' && <div className="caption-feedback"><span>{engine.message}</span>
      <Button variant="outline" size="sm" onClick={onSettings}>设置 FFmpeg</Button></div>}
    <div className="caption-workbench">
      <div className="caption-stack">
        <Card>
          <CardHeader><CardTitle><Film />输入素材</CardTitle></CardHeader>
          <CardContent className="caption-stack">
            <div className="caption-drop" data-over={dragging}>
              <Upload size={23} /><span>拖入音频、视频或字幕</span>
              <div className="caption-actions">
                <Button variant="outline" size="sm" onClick={() => importAssets(() => captionApi.pick('media'))}>选择音视频</Button>
                <Button variant="outline" size="sm" onClick={() => importAssets(() => captionApi.pick('subtitle'))}>选择字幕</Button>
              </div>
            </div>
            {!!assets.length && <ul className="caption-assets">
              {assets.map((asset) => <li key={asset.id}>
                <div className="caption-asset-line">
                  {asset.kind === 'subtitle' ? <FileText size={16} /> : asset.video ? <Film size={16} /> : <AudioLines size={16} />}
                  <span title={asset.name}>{asset.name}<small>{timeLabel(asset.duration)}</small></span>
                  <Button size="icon-sm" variant="ghost" aria-label={'移除 ' + asset.name} onClick={() => {
                    setAssets((old) => old.filter((item) => item.id !== asset.id))
                    setPairs((old) => Object.fromEntries(Object.entries(old).filter(([id, value]) => id !== asset.id && value !== asset.id)))
                  }}><X /></Button>
                </div>
                {asset.kind === 'media' && <div className="caption-grid caption-asset-fields">
                  <CaptionSelect label="音轨" value={String(tracks[asset.id] ?? asset.tracks[0]?.index ?? -1)}
                    onChange={(value) => setTracks((old) => ({ ...old, [asset.id]: Number(value) }))}
                    choices={asset.tracks.length ? asset.tracks.map((item, index) => [String(item.index),
                      '音轨 ' + (index + 1) + (item.language ? ' · ' + item.language : '') + (item.channels ? ' · ' + item.channels + ' 声道' : '')]) : [['-1', '无音轨']]} />
                  <CaptionSelect label="任务模式" value={modesByAsset[asset.id] ?? ''}
                    onChange={(value) => setModesByAsset((old) => ({ ...old, [asset.id]: value as CaptionMode }))}
                    choices={[['', '使用全局模式'], ...modes]} />
                  {!!subtitles.length && <CaptionSelect label="配对字幕" value={pairs[asset.id] ?? 'auto'} onChange={(value) =>
                    setPairs((old) => {
                      const next = { ...old }
                      if (value === 'auto') delete next[asset.id]; else next[asset.id] = value
                      return next
                    })} choices={[['auto', '自动配对'], ['', '无'], ...subtitles.map((item): [string, string] => [item.id, item.name])]} />}
                </div>}
              </li>)}
            </ul>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle><Play />任务队列</CardTitle></CardHeader>
          <CardContent className="caption-stack">
            {tasks.length ? <ul className="caption-queue">
              {tasks.map((item) => <li key={item.id}>
                <button type="button" disabled={dirty && item.id !== task?.id} onClick={() => setTaskId(item.id)} aria-pressed={task?.id === item.id}>
                  <span><strong>{item.name}</strong><small>{stateNames[item.state]}{item.state === 'running' ? ' · ' + item.message : ''}</small></span>
                  <ChevronRight size={16} />
                </button>
              </li>)}
            </ul> : <p className="caption-muted">暂无任务。</p>}
            {running > 0 && <Button size="sm" className="justify-self-start" variant="outline" onClick={() => void action(() => captionApi.cancel())}>
              <Square />取消全部</Button>}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle><AudioLines />处理与输出</CardTitle></CardHeader>
        <CardContent className="caption-stack">
          <CaptionSelect label="默认任务模式" value={options.mode} onChange={(value) => update('mode', value)} choices={modes} />
          {recognize && <div className="caption-grid">
            <CaptionSelect label="识别引擎" value={options.engine} onChange={(value) =>
              setOptions((old) => ({ ...old, engine: value, language: value === 'bijian' || value === 'jianying' ? 'auto' : old.language }))}
              choices={Object.entries(engineNames) as Array<[CaptionOptions['engine'], string]>} />
            <CaptionSelect label="音频语言" value={options.language} onChange={(value) => update('language', value)}
              choices={options.engine === 'bijian' || options.engine === 'jianying'
                ? [['auto', '自动识别（中英）']]
                : [['auto', '自动识别'], ['zh', '中文'], ...targetLanguages.filter(([code]) => !code.startsWith('zh-'))]} />
          </div>}
          {modesUsed.some((mode) => mode !== 'synthesize') && <CaptionSelect label="字幕断句" value={options.split}
            onChange={(value) => update('split', value)} choices={[['rules', '规则断句'], ['original', '保留原断句'], ['llm', 'LLM 语义断句']]} />}
          {process && <>
            <CaptionToggle label="启用 LLM 校正" checked={options.correct} onChange={(value) => update('correct', value)} />
            <div className="caption-grid">
              <CaptionSelect label="翻译服务" value={options.translator} onChange={(value) => update('translator', value)} choices={translators} />
              <CaptionSelect label="目标语言" value={options.target} onChange={(value) => update('target', value)}
                disabled={options.translator === 'none'} choices={targetLanguages} />
            </div>
            {options.translator === 'llm' && <CaptionToggle label="反思式翻译" checked={options.reflect} onChange={(value) => update('reflect', value)} />}
          </>}
          <details><summary>断句与并发参数</summary><div className="caption-grid caption-detail">
            <NumberField label="中日韩每行字数" value={options.cjk} min={3} max={160} onChange={(value) => update('cjk', value)} />
            <NumberField label="其他语言每行词数" value={options.words} min={3} max={100} onChange={(value) => update('words', value)} />
            <NumberField label="每批字幕条数" value={options.batch} min={1} max={50} onChange={(value) => update('batch', value)} />
            <NumberField label="字幕请求并发" value={options.concurrency} min={1} max={10} onChange={(value) => update('concurrency', value)} />
            <Field label="术语与上下文"><textarea rows={3} value={options.prompt} maxLength={3000}
              onChange={(event) => update('prompt', event.currentTarget.value)} /></Field>
          </div></details>
          <FormatChecks formats={options.formats} onChange={(value) => update('formats', value)} />
          <LayoutSelect value={options.layout} onChange={(value) => update('layout', value)} />
          {canSynthesize && <>
            <div className="caption-grid">
              <CaptionSelect label="合成" value={options.synthesis} onChange={(value) => update('synthesis', value)}
                choices={[['soft', '软字幕轨'], ['ass', '硬字幕 · ASS 描边'], ['rounded', '硬字幕 · 圆角背景']]} />
              <CaptionSelect label="输出容器" value={options.container} onChange={(value) => update('container', value)}
                choices={[['mp4', 'MP4'], ['mkv', 'MKV']]} />
            </div>
            {options.synthesis !== 'soft' && <>
              <CaptionSelect label="视频质量" value={String(options.quality)}
                onChange={(value) => update('quality', Number(value) as CaptionOptions['quality'])}
                choices={[['18', '极高'], ['23', '高'], ['28', '中'], ['32', '低']]} />
              <SubtitleAppearance style={options.style} rounded={options.synthesis === 'rounded'} pickFont={chooseFont}
                onChange={(style) => update('style', style)} />
            </>}
            <CaptionToggle label="合成前停下来校对" checked={options.review} onChange={(value) => update('review', value)} />
          </>}
          <PathField label="任务输出目录" value={options.output || ''} onChoose={chooseOutput} onClear={() => update('output', undefined)} />
          {!!recipients.size && <ul className="caption-network" aria-label="本次任务的联网内容">
            {[...recipients].map((text) => <li key={text}>{text}</li>)}
          </ul>}
          <ActionButton disabled={dirty || submitting || !inputs.length || engine.kind === 'missing' && workflowNeedsMedia(options.mode)}
            onClick={submit} shimmer="ready"><Play />{inputs.length > 1 ? '添加 ' + inputs.length + ' 项任务' : '开始处理'}</ActionButton>
        </CardContent>
      </Card>
    </div>
    {task && <Card className="caption-task" key={task.id}>
      <CardHeader><CardTitle><FileText />{task.name}</CardTitle></CardHeader>
      <CardContent className="caption-stack">
        <div className="caption-task-status" aria-live="polite">
          <span>{stateNames[task.state]} · {task.message}</span>
          {waiting(task) && <Button variant="outline" size="sm" onClick={() => void action(() => captionApi.cancel(task.id))}>取消任务</Button>}
          {(task.state === 'failed' || task.state === 'cancelled') &&
            <Button variant="outline" size="sm" onClick={() => void action(() => captionApi.retry(task.id))}>重试任务</Button>}
        </div>
        {task.state === 'running' && <progress max={100} value={task.progress ?? undefined} aria-label="当前阶段进度" />}
        {!!task.warnings.length && <ul className="caption-warnings">{task.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        {!!task.cues.length && <Editor key={task.revision} task={task} visible={active} onDirty={setDirty}
          onChange={replaceTask} onAction={(run) => void action(run)} />}
        <TaskOutputs task={task} dirty={dirty} onAction={(run) => void action(run)} />
      </CardContent>
    </Card>}
  </section>
}
