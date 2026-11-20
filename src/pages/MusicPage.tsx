import { useRef, useState } from 'react'
import { AlertCircle, ArrowDownToLine, Check, FileMusic, FolderOpen, ImageIcon, LoaderCircle, Upload, X } from 'lucide-react'
import type { MusicImage, MusicSelection, SquareCrop } from '../bridge'
import { api, errorText, interfaceCopy, type EngineStatus } from '../workspace'
import { ActionButton } from '../ui/action-button'
import { Alert, AlertDescription, AlertTitle } from '../ui/shadcn/alert'
import { Badge } from '../ui/shadcn/badge'
import { Button } from '../ui/shadcn/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/shadcn/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/shadcn/empty'
import { cn } from '../ui/class-names'
import { MusicCropDialog } from './MusicCropDialog'
import { MusicPlayer } from './MusicPlayer'

export function MusicPage({ active, engine, onOpenSettings, onRetry }: {
  active: boolean; engine: EngineStatus; onOpenSettings: () => void; onRetry: () => void
}) {
  const [selection, setSelection] = useState<MusicSelection>()
  const [pictureIndex, setPictureIndex] = useState(0)
  const [lyricIndex, setLyricIndex] = useState(0)
  const [lyricSource, setLyricSource] = useState<'embedded' | 'local'>('embedded')
  const [candidate, setCandidate] = useState<MusicImage>()
  const [previewError, setPreviewError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [output, setOutput] = useState('')
  const coverPicker = useRef<HTMLButtonElement>(null)
  const audio = selection?.audio
  const imported = selection?.imported
  const draft = selection?.draft
  const cover = audio?.covers[pictureIndex]
  const lyric = lyricSource === 'local' && imported ? imported.text : audio?.lyrics[lyricIndex]
  const ready = engine.kind === 'ready'
  const coverIssue = audio?.writeIssue || audio?.coverWriteIssue
  const lyricIssue = audio?.writeIssue || audio?.lyricWriteIssue
  const changes = { coverId: draft?.id, lyricId: lyricIssue ? undefined : imported?.id }

  async function act(label: string, action: () => Promise<void>) {
    if (busy) return
    setBusy(label)
    setError('')
    setNotice('')
    try { await action() }
    catch (reason) { setError(errorText(reason)) }
    finally { setBusy('') }
  }

  async function load(loadSelection: () => Promise<MusicSelection | null>) {
    await act('正在读取素材', async () => {
      const next = await loadSelection()
      if (!next) return
      if (next.audio.id !== audio?.id) {
        setPictureIndex(0)
        setLyricIndex(0)
        setPreviewError('')
      }
      if (next.imported?.id !== imported?.id || next.audio.id !== audio?.id) {
        setLyricSource(next.imported ? 'local' : 'embedded')
      }
      setSelection(next)
      setOutput('')
    })
  }

  const selectStyle = 'border-input bg-background text-foreground w-full min-w-0 rounded-md border px-2 py-1.5 text-sm'
  const previewLabel = cover?.preview || ''
  const brokenPreview = Boolean(previewLabel && previewError === previewLabel)

  function closeCrop() {
    setCandidate(undefined)
    setError('')
    requestAnimationFrame(() => coverPicker.current?.focus())
  }

  function cancelCrop() {
    if (!audio || !candidate) return
    closeCrop()
    void api.cancelMusicCoverPick(audio.id, candidate.id).catch((reason) => setError(errorText(reason)))
  }

  function prepareCrop(crop: SquareCrop) {
    if (!audio || !candidate) return
    void act('正在处理封面', async () => {
      setSelection(await api.prepareMusicCover(audio.id, candidate.id, crop))
      setOutput('')
      setNotice('封面已就绪')
      closeCrop()
    })
  }

  return (
    <section className="page-layout" onDragOver={(event) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = ready && !busy ? 'copy' : 'none'
      setDragging(ready && !busy)
    }} onDragLeave={(event) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false)
    }} onDrop={(event) => {
      event.preventDefault()
      setDragging(false)
      const files = Array.from(event.dataTransfer.files)
      if (ready && !busy && !candidate && files.length) void load(() => api.dropMusic(files))
    }}>
      <header className="page-header">
        <div className="grid gap-1.5"><h1>音乐封面解析</h1><p>预览 FLAC 和 MP3，导出内嵌封面与歌词，也可另存带新封面或歌词的音频副本</p></div>
        <Badge variant="outline" role="status">
          {ready ? 'FFmpeg 已就绪' : engine.kind === 'checking' ? '正在检测 FFmpeg' : 'FFmpeg 需配置'}
        </Badge>
      </header>

      {engine.kind === 'missing' && <Alert>
        <AlertCircle /><AlertTitle>需要 FFmpeg 和 FFprobe</AlertTitle>
        <AlertDescription>
          <p className="break-words">{engine.message}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onOpenSettings}>打开设置</Button>
            <Button variant="ghost" size="sm" onClick={onRetry}>重新检测</Button>
          </div>
        </AlertDescription>
      </Alert>}
      {error && !candidate && <Alert variant="destructive" role="alert"><AlertCircle /><AlertTitle>操作失败</AlertTitle>
        <AlertDescription className="break-words">{error}</AlertDescription></Alert>}

      {!audio ? <Empty className={cn('import-panel rounded-xl border border-dashed', dragging && 'drop-active')}>
        <EmptyHeader>
          <EmptyMedia variant="icon"><FileMusic /></EmptyMedia>
          <EmptyTitle>{dragging ? '松开鼠标，导入素材' : '拖入 FLAC 或 MP3'}</EmptyTitle>
          <EmptyDescription>可以同时拖入一个 .lrc 歌词文件</EmptyDescription>
        </EmptyHeader>
        <EmptyContent><Button variant="outline" disabled={!ready || !!busy} onClick={() => void load(api.pickMusic)}><Upload />选择音频</Button></EmptyContent>
      </Empty> : <>
        <Card className={cn('min-w-0 gap-3 py-4', dragging && 'drop-active')}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileMusic className="text-muted-foreground size-4 shrink-0" />
              <span className="min-w-0 truncate text-sm font-medium" title={audio.name}>{audio.name}</span>
              <Badge variant="secondary">{audio.format.toUpperCase()}</Badge>
            </div>
            <Button variant="outline" size="sm" disabled={!ready || !!busy} onClick={() => void load(api.pickMusic)}>
              <Upload />{dragging ? '松开以导入' : '更换音频'}
            </Button>
          </CardContent>
        </Card>

        <div className="music-grid">
          <Card className="min-w-0 gap-3 py-4">
            <CardHeader><CardTitle className="flex items-center gap-2"><ImageIcon className="text-muted-foreground size-4" />内嵌封面</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {audio.covers.length > 1 && <select className={selectStyle} aria-label="选择内嵌封面" value={pictureIndex}
                onChange={(event) => setPictureIndex(Number(event.target.value))}>
                {audio.covers.map((picture, index) => <option key={picture.index} value={index}>{picture.label}</option>)}
              </select>}
              {cover && previewLabel && !brokenPreview ? <figure className="bg-muted/40 grid min-h-40 place-items-center overflow-hidden rounded-md">
                <img key={previewLabel} className="block max-h-64 w-full object-contain" src={previewLabel} alt={cover.label}
                  onError={() => setPreviewError(previewLabel)} />
              </figure> : <p className="text-muted-foreground text-sm">
                {!cover ? '无内嵌封面' : cover.extension ? '无法预览此封面，可尝试另存原图' : '检测到内嵌封面，当前无法导出此图片格式'}
              </p>}
              <div className="flex flex-wrap items-center gap-2">
                {cover?.extension && <span className="text-muted-foreground mr-auto text-xs">{cover.width && cover.height ? cover.width + ' × ' + cover.height + ' · ' : ''}{cover.extension.toUpperCase()}</span>}
                <Button ref={coverPicker} variant="outline" size="sm" disabled={!!busy || !!coverIssue}
                  onClick={() => void act('正在选择封面', async () => {
                    const image = await api.pickMusicCover(audio.id)
                    if (image) setCandidate(image)
                  })}><ImageIcon />重选封面</Button>
                <Button variant="outline" size="sm" disabled={!!busy || !cover?.extension} onClick={() => void act('正在保存封面', async () => {
                  if (cover && await api.saveMusicCover(audio.id, cover.index)) setNotice('封面已保存')
                })}><ArrowDownToLine />另存封面</Button>
              </div>
              {coverIssue && <p className="text-muted-foreground text-xs">{interfaceCopy(coverIssue)}</p>}
              {draft && <div className="music-cover-draft">
                <img src={draft.preview} alt="待封装正面封面" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">待封装正面封面</p>
                  <p className="text-muted-foreground mt-0.5 truncate text-xs" title={draft.name}>
                    {draft.width} × {draft.height} · {Math.ceil(draft.bytes / 1024)} KiB · {draft.name}
                  </p>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label="移除待封装封面" disabled={!!busy}
                  onClick={() => void load(() => api.discardMusicCover(audio.id))}><X /></Button>
              </div>}
            </CardContent>
          </Card>

          <div className="grid min-w-0 gap-4">
            <MusicPlayer key={audio.id} audio={audio} active={active} lyric={lyric} lyricControls={<div className="flex min-w-0 flex-wrap items-center gap-2">
              {imported && audio.lyrics.length > 0 && <select className={selectStyle + ' w-auto!'} aria-label="歌词来源" value={lyricSource}
                onChange={(event) => setLyricSource(event.target.value === 'local' ? 'local' : 'embedded')}>
                <option value="embedded">内嵌歌词</option><option value="local">本地 LRC</option>
              </select>}
              {lyricSource === 'embedded' && audio.lyrics.length > 1 && <select className={selectStyle + ' w-auto!'} aria-label="选择内嵌歌词" value={lyricIndex}
                onChange={(event) => setLyricIndex(Number(event.target.value))}>
                {audio.lyrics.map((_, index) => <option key={index} value={index}>歌词 {index + 1}</option>)}
              </select>}
              {audio.lyrics.length > 0 && <Button variant="outline" size="sm" disabled={!!busy}
                onClick={() => void act('正在导出歌词', async () => {
                  if (await api.saveMusicLyric(audio.id, lyricIndex)) setNotice('歌词已导出')
                })}><ArrowDownToLine />导出内嵌 LRC</Button>}
            </div>} />

            <Card className="min-w-0 gap-3 py-4">
              <CardHeader><CardTitle>音频副本</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-muted-foreground text-sm break-words" title={imported?.name}>
                  {imported ? (lyricIssue ? '仅预览 · ' : '待封装歌词 · ') + imported.name : interfaceCopy(audio.lyricWarning || (audio.lyrics.length ? '可导入本地 LRC 替换内嵌歌词' : '无内嵌歌词'))}
                </p>
                {audio.lyricWriteIssue && <p className="text-muted-foreground text-xs">{interfaceCopy(audio.lyricWriteIssue)}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={!!busy} onClick={() => void load(() => api.pickMusicLyric(audio.id))}>
                    <Upload />{imported ? '更换 LRC' : '导入 LRC'}
                  </Button>
                  {imported && <Button variant="ghost" disabled={!!busy} aria-label="移除本地 LRC"
                    onClick={() => void load(() => api.discardMusicLyric(audio.id))}><X /></Button>}
                  <ActionButton shimmer="ready" disabled={!ready || !!busy || (!changes.coverId && !changes.lyricId)} onClick={() => {
                    void act('正在封装音频副本', async () => {
                      const path = await api.exportMusic(audio.id, changes)
                      if (path) { setOutput(path); setNotice('音频副本已保存') }
                    })
                  }}><ArrowDownToLine />另存音频副本</ActionButton>
                </div>
                {output && <div className="grid gap-2">
                  <p className="text-muted-foreground truncate text-xs" title={output}>{output.split(/[\\/]/).at(-1)}</p>
                  <Button variant="outline" size="sm" className="justify-self-start" disabled={!!busy}
                    onClick={() => void act('正在打开文件位置', () => api.revealMusic(audio.id))}><FolderOpen />在资源管理器中查看</Button>
                </div>}
              </CardContent>
            </Card>
          </div>
        </div>
      </>}
      <div className="text-muted-foreground text-sm" role="status">
        {busy ? <span className="flex items-center gap-2"><LoaderCircle className="size-4 motion-safe:animate-spin" />{busy}</span>
          : notice && <span className="flex items-center gap-2"><Check className="result-check size-4" />{notice}</span>}
      </div>
      {candidate && <MusicCropDialog key={candidate.id} image={candidate} error={error} busy={!!busy}
        onCancel={cancelCrop} onConfirm={prepareCrop} />}
    </section>
  )
}
