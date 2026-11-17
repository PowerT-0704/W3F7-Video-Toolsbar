import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { AlertCircle, ArrowDownToLine, Check, CircleCheck, FileVideo, FolderOpen, ImageIcon, LoaderCircle, Upload } from 'lucide-react'
import type { Asset, AssetKind, Preferences, VideoDetails } from '../bridge'
import { api, errorText, type EngineStatus } from '../workspace'
import { cn } from '../ui/class-names'
import { Alert, AlertDescription, AlertTitle } from '../ui/shadcn/alert'
import { Badge } from '../ui/shadcn/badge'
import { Button } from '../ui/shadcn/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../ui/shadcn/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/shadcn/empty'
import { Progress } from '../ui/shadcn/progress'
import { Separator } from '../ui/shadcn/separator'

interface CoverPageProps {
  engine: EngineStatus
  preferences: Preferences
  onChooseOutput: () => Promise<void>
  onOpenSettings: () => void
  onRetry: () => void
}

type Review<T> = { id: string; info: T } | { id: string; error: string }

function durationLabel(seconds: number) {
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const parts = [Math.floor(total / 60) % 60, total % 60]
  if (hours) parts.unshift(hours)
  return parts.map((part) => String(part).padStart(2, '0')).join(':')
}

function parentFolder(path: string) {
  return path.replace(/[^\\/]+$/, '').replace(/(.{3,})[\\/]$/, '$1')
}

function sizeLabel(bytes: number) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MiB' : Math.ceil(bytes / 1024) + ' KiB'
}

function AssetRow({ kind, asset, info, disabled, onPick }: {
  kind: AssetKind; asset?: Asset; info?: string; disabled: boolean; onPick: () => void
}) {
  const typeName = kind === 'video' ? '视频' : '封面'
  const Icon = kind === 'video' ? FileVideo : ImageIcon
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-md"><Icon className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground text-xs">{typeName}</p>
        <p className="truncate text-sm font-medium" title={asset?.path}>{asset?.name ?? '尚未导入'}</p>
        {asset && <p className="text-muted-foreground mt-0.5 truncate text-xs">{info || sizeLabel(asset.bytes)}</p>}
      </div>
      <Button type="button" variant={asset ? 'ghost' : 'outline'} size="sm" disabled={disabled} onClick={onPick}
        aria-label={(asset ? '更换' : '选择') + typeName}>{asset ? '更换' : '选择'}</Button>
    </div>
  )
}

export function CoverPage({ engine, preferences, onChooseOutput, onOpenSettings, onRetry }: CoverPageProps) {
  const [video, setVideo] = useState<Asset>()
  const [cover, setCover] = useState<Asset>()
  const [videoReview, setVideoReview] = useState<Review<VideoDetails>>()
  const [coverReview, setCoverReview] = useState<Review<string>>()
  const [isSelecting, setIsSelecting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const selectingRef = useRef(false)
  const exportingRef = useRef(false)
  const dragDepth = useRef(0)

  useEffect(() => api.onProgress((value) => setProgress((previous) => Math.max(previous, value))), [])

  useEffect(() => {
    setVideoReview(undefined)
    if (!video || engine.kind !== 'ready') return
    let active = true
    void api.inspect(video.id).then((info) => {
      if (active) setVideoReview({ id: video.id, info })
    }).catch((reason) => {
      if (active) setVideoReview({ id: video.id, error: errorText(reason) })
    })
    return () => { active = false }
  }, [video, engine])

  const currentVideo = videoReview?.id === video?.id ? videoReview : undefined
  const currentCover = coverReview?.id === cover?.id ? coverReview : undefined
  const details = currentVideo && 'info' in currentVideo ? currentVideo.info : undefined
  const coverSize = currentCover && 'info' in currentCover ? currentCover.info : undefined
  const videoError = currentVideo && 'error' in currentVideo ? currentVideo.error : ''
  const coverError = currentCover && 'error' in currentCover ? currentCover.error : ''
  const controlsBusy = isSelecting || exporting
  const canExport = Boolean(engine.kind === 'ready' && details && coverSize && !controlsBusy)
  const outputDirectory = preferences.outputDirectory || (video ? parentFolder(video.path) : '视频所在文件夹')
  const hasAssets = Boolean(video || cover)

  async function select(action: () => Promise<Asset[]>) {
    if (selectingRef.current || exportingRef.current) return
    selectingRef.current = true
    setIsSelecting(true)
    setError('')
    try {
      const assets = await action()
      if (!assets.length) return
      for (const asset of assets) {
        if (asset.kind === 'video') setVideo(asset)
        else {
          setCoverReview(undefined)
          setCover(asset)
        }
      }
      setOutput('')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      selectingRef.current = false
      setIsSelecting(false)
    }
  }

  function pick(kind: AssetKind) {
    void select(async () => {
      const asset = await api.pick(kind)
      return asset ? [asset] : []
    })
  }

  function onDragEnter(event: DragEvent) {
    if (!event.dataTransfer.types.includes('Files') || controlsBusy) return
    event.preventDefault()
    dragDepth.current++
    setDragging(true)
  }

  function onDragLeave(event: DragEvent) {
    if (!event.dataTransfer.types.includes('Files')) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (!dragDepth.current) setDragging(false)
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length) void select(() => api.drop(files))
  }

  async function exportCover() {
    if (!video || !cover || !canExport || exportingRef.current || selectingRef.current) return
    exportingRef.current = true
    setExporting(true)
    setProgress(0)
    setOutput('')
    setError('')
    try {
      const result = await api.exportCover(video.id, cover.id)
      setProgress(100)
      setOutput(result.path)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      exportingRef.current = false
      setExporting(false)
    }
  }

  async function changeOutput() {
    setError('')
    try { await onChooseOutput() } catch (reason) { setError(errorText(reason)) }
  }

  const dropHeader = (
    <EmptyHeader>
      <EmptyMedia variant="icon"><Upload /></EmptyMedia>
      <EmptyTitle>{dragging ? '松开鼠标，导入素材' : '拖入 MP4 视频和封面'}</EmptyTitle>
      <EmptyDescription>支持 MP4 和 PNG、JPG、JPEG，可以一起拖入，也可以分别导入。</EmptyDescription>
    </EmptyHeader>
  )
  const issue = [error, videoError, coverError].filter(Boolean).join(' ')

  return (
    <section className="page-layout" onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDrop={onDrop}
      onDragOver={(event) => {
        event.preventDefault()
        if (event.dataTransfer.types.includes('Files')) event.dataTransfer.dropEffect = controlsBusy ? 'none' : 'copy'
      }}>
      <header className="page-header">
        <div className="grid gap-1.5">
          <h1>视频封面封装</h1>
          <p>为 MP4 写入自定义封面，保留原始画质和音轨。</p>
        </div>
        <div role="status" aria-live="polite">
          <Badge variant="outline">
            {engine.kind === 'ready' && <CircleCheck />}
            {engine.kind === 'checking' && <LoaderCircle className="animate-spin" />}
            {engine.kind === 'missing' && <AlertCircle />}
            {engine.kind === 'ready' ? 'FFmpeg 已就绪' : engine.kind === 'checking' ? '正在检测 FFmpeg' : 'FFmpeg 需配置'}
          </Badge>
        </div>
      </header>

      {engine.kind === 'missing' && (
        <Alert>
          <AlertCircle />
          <AlertTitle>需要 FFmpeg 和 FFprobe 才能封装</AlertTitle>
          <AlertDescription className="min-w-0">
            <p className="break-words">{engine.message}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={onOpenSettings}>打开设置</Button>
              <Button variant="ghost" size="sm" onClick={onRetry}>重新检测</Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {issue && <Alert variant="destructive"><AlertCircle /><AlertTitle>无法处理素材或输出</AlertTitle><AlertDescription className="break-words">{issue}</AlertDescription></Alert>}

      {!hasAssets ? (
        <Empty className={cn('import-panel rounded-xl border border-dashed', dragging && 'drop-active')} data-drop-zone="initial">
          {dropHeader}
          <EmptyContent className="flex-row flex-wrap justify-center">
            <Button variant="outline" disabled={controlsBusy} onClick={() => pick('video')}><FileVideo />选择视频</Button>
            <Button variant="outline" disabled={controlsBusy} onClick={() => pick('cover')}><ImageIcon />选择封面</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="cover-grid">
          <Card className="min-w-0 gap-4 pb-4 pt-5">
            <CardHeader className="flex items-center justify-between gap-3">
              <CardTitle>封面预览</CardTitle>
              {coverSize && <span className="text-muted-foreground text-xs tabular-nums">{coverSize}</span>}
            </CardHeader>
            <CardContent>
              <div className="preview-stage">
                {cover && !coverError ? (
                  <img key={cover.id} src={cover.preview} alt="所选视频封面"
                    onLoad={({ currentTarget }) => setCoverReview({ id: cover.id, info: currentTarget.naturalWidth + ' × ' + currentTarget.naturalHeight })}
                    onError={() => setCoverReview({ id: cover.id, error: '封面无法读取，请换一张 PNG、JPG 或 JPEG。' })} />
                ) : (
                  <Empty className="h-full border-0 p-4">
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><ImageIcon /></EmptyMedia>
                      <EmptyTitle>{coverError ? '无法预览封面' : '待导入封面'}</EmptyTitle>
                    </EmptyHeader>
                    <EmptyContent><Button variant="outline" size="sm" disabled={controlsBusy} onClick={() => pick('cover')}>选择封面</Button></EmptyContent>
                  </Empty>
                )}
              </div>
              <div className={cn('replacement-drop text-muted-foreground mt-3', dragging && 'drop-active')} data-drop-zone="replacement">
                <Upload className="size-3.5" />{dragging ? '松开鼠标，导入素材' : '拖入文件以导入或替换素材'}
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0 gap-4 py-5">
            <CardHeader><CardTitle>素材与输出</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <AssetRow kind="video" asset={video} info={details ? [details.width + ' × ' + details.height, durationLabel(details.duration), details.codec.toUpperCase()].join(' · ') : undefined} disabled={controlsBusy} onPick={() => pick('video')} />
              <AssetRow kind="cover" asset={cover} info={cover && coverSize ? coverSize + ' · ' + sizeLabel(cover.bytes) : undefined} disabled={controlsBusy} onPick={() => pick('cover')} />
              <Separator />
              <div className="grid gap-2">
                <span className="text-muted-foreground text-xs">输出文件夹</span>
                <Button variant="outline" className="w-full min-w-0 justify-start" disabled={controlsBusy}
                  title={outputDirectory} aria-label="选择输出文件夹" onClick={() => void changeOutput()}>
                  <FolderOpen /><span className="min-w-0 truncate">{outputDirectory}</span>
                </Button>
              </div>
            </CardContent>
            <CardFooter className="mt-1 flex flex-col items-stretch gap-3">
              <Button disabled={!canExport} onClick={() => void exportCover()}>
                {exporting ? <LoaderCircle className="animate-spin" /> : <ArrowDownToLine />}
                {exporting ? '正在封装' : '封装封面'}
              </Button>
              {exporting && (
                <div className="grid gap-2" role="status">
                  <span className="text-muted-foreground text-xs tabular-nums">正在封装 · {progress}%</span>
                  <Progress value={progress} aria-label="封装进度" />
                </div>
              )}
              {output && (
                <div className="grid gap-2">
                  <div className="min-w-0 text-sm" role="status">
                    <p className="flex items-center gap-2"><Check className="size-4" />封装完成</p>
                    <p className="text-muted-foreground mt-1 truncate text-xs" title={output}>{output.split(/[\\/]/).at(-1)}</p>
                  </div>
                  <Button variant="outline" onClick={() => void api.revealOutput()}><FolderOpen />在资源管理器中查看</Button>
                </div>
              )}
            </CardFooter>
          </Card>
        </div>
      )}
    </section>
  )
}
