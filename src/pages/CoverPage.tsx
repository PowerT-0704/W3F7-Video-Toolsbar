import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { AlertCircle, ArrowDownToLine, Check, CircleCheck, FileVideo, FolderOpen, ImageIcon, LoaderCircle, Maximize2, MonitorPlay, Upload, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Dialog } from 'radix-ui'
import type { Asset, AssetKind, Preferences, VideoDetails } from '../bridge'
import { api, errorText, type EngineStatus } from '../workspace'
import { ActionButton } from '../ui/action-button'
import { BlurFade } from '../ui/blur-fade'
import { BorderBeam } from '../ui/border-beam'
import { cn } from '../ui/class-names'
import { useMotionEnabled } from '../ui/motion-policy'
import { positionSpotlight } from '../ui/spotlight'
import { Alert, AlertDescription, AlertTitle } from '../ui/shadcn/alert'
import { Badge } from '../ui/shadcn/badge'
import { Button } from '../ui/shadcn/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../ui/shadcn/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/shadcn/empty'
import { Progress } from '../ui/shadcn/progress'
import { VideoTimeline } from './VideoTimeline'

interface CoverPageProps {
  active: boolean
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
      <BlurFade key={asset?.id ?? kind} className="min-w-0 flex-1" delay={asset && kind === 'cover' ? 0.045 : 0}>
        <p className="text-muted-foreground text-xs">{typeName}</p>
        <p className="truncate text-sm font-medium" title={asset?.frameSource ? asset.name : asset?.path}>{asset?.name ?? '尚未导入'}</p>
        {asset && <p className="text-muted-foreground mt-0.5 truncate text-xs">{info || sizeLabel(asset.bytes)}</p>}
      </BlurFade>
      <Button type="button" variant={asset ? 'ghost' : 'outline'} size="sm" disabled={disabled} onClick={onPick}
        aria-label={(asset ? '更换' : '选择') + typeName}>{asset ? '更换' : '选择'}</Button>
    </div>
  )
}

export function CoverPage({ active, engine, preferences, onChooseOutput, onOpenSettings, onRetry }: CoverPageProps) {
  const [video, setVideo] = useState<Asset>()
  const [cover, setCover] = useState<Asset>()
  const [videoReview, setVideoReview] = useState<Review<VideoDetails>>()
  const [coverReview, setCoverReview] = useState<Review<string>>()
  const [isSelecting, setIsSelecting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [frameBusy, setFrameBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const selectingRef = useRef(false)
  const exportingRef = useRef(false)
  const dragDepth = useRef(0)
  const dragTimeout = useRef<number>(undefined)
  const currentCoverId = useRef<string>(undefined)
  const motionEnabled = useMotionEnabled()
  const animated = active && motionEnabled

  const resetDrag = useCallback(() => {
    window.clearTimeout(dragTimeout.current)
    dragDepth.current = 0
    setDragging(false)
  }, [])

  useEffect(() => {
    if (!active) {
      resetDrag()
      return
    }
    window.addEventListener('dragend', resetDrag)
    window.addEventListener('blur', resetDrag)
    return () => {
      window.clearTimeout(dragTimeout.current)
      window.removeEventListener('dragend', resetDrag)
      window.removeEventListener('blur', resetDrag)
    }
  }, [active, resetDrag])

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
  const controlsBusy = isSelecting || exporting || frameBusy
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
      if (assets.some((asset) => asset.kind === 'video') && cover?.frameSource) {
        currentCoverId.current = undefined
        setCoverReview(undefined)
        setCover(undefined)
      }
      for (const asset of assets) {
        if (asset.kind === 'video') setVideo(asset)
        else {
          currentCoverId.current = asset.id
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
    keepDragAlive()
  }

  function keepDragAlive() {
    window.clearTimeout(dragTimeout.current)
    // A drag cancelled in Explorer may stop sending events without a final dragleave.
    dragTimeout.current = window.setTimeout(resetDrag, 750)
    setDragging(true)
  }

  function onDragLeave(event: DragEvent) {
    if (!dragDepth.current) return
    const next = event.relatedTarget
    if (next instanceof Node && !event.currentTarget.contains(next)) {
      resetDrag()
      return
    }
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (!dragDepth.current) resetDrag()
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    resetDrag()
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
  const beam = animated && dragging && <BorderBeam size={105} duration={2.2} borderWidth={1.5}
    colorFrom="var(--drop-beam-start)" colorTo="var(--drop-beam-end)" />

  return (
    <section className="page-layout" onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDrop={onDrop}
      onDragOver={(event) => {
        event.preventDefault()
        if (event.dataTransfer.types.includes('Files')) {
          event.dataTransfer.dropEffect = controlsBusy ? 'none' : 'copy'
          if (!controlsBusy) keepDragAlive()
        }
      }}>
      <header className="page-header">
        <div className="grid gap-1.5">
          <h1>视频封面封装</h1>
          <p>为 MP4 写入自定义封面，保留原始画质和音轨。</p>
        </div>
        <div role="status" aria-live="polite">
          <BlurFade key={engine.kind}><Badge variant="outline">
            {engine.kind === 'ready' && <CircleCheck />}
            {engine.kind === 'checking' && <LoaderCircle className="animate-spin" />}
            {engine.kind === 'missing' && <AlertCircle />}
            {engine.kind === 'ready' ? 'FFmpeg 已就绪' : engine.kind === 'checking' ? '正在检测 FFmpeg' : 'FFmpeg 需配置'}
          </Badge></BlurFade>
        </div>
      </header>

      {engine.kind === 'missing' && <BlurFade>
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
      </BlurFade>}
      {issue && (
        <motion.div key={issue} className="overflow-hidden" initial={animated ? { opacity: 0, height: 0 } : false}
          animate={{ opacity: 1, height: 'auto' }} transition={{ duration: animated ? 0.22 : 0 }}>
          <Alert variant="destructive"><AlertCircle /><AlertTitle>无法处理素材或输出</AlertTitle><AlertDescription className="break-words">{issue}</AlertDescription></Alert>
        </motion.div>
      )}

      {!hasAssets ? (
        <Empty className={cn('import-panel spotlight-surface rounded-xl border border-dashed', dragging && 'drop-active')}
          onPointerMove={animated ? positionSpotlight : undefined} data-drop-zone="initial">
          {beam}
          {dropHeader}
          <EmptyContent className="flex-row flex-wrap justify-center">
            <Button variant="outline" disabled={controlsBusy} onClick={() => pick('video')}><FileVideo />选择视频</Button>
            <Button variant="outline" disabled={controlsBusy} onClick={() => pick('cover')}><ImageIcon />选择封面</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="cover-grid">
          {video && details && details.duration > 0 ? <VideoTimeline key={video.id} video={video} details={details}
              active={active} disabled={controlsBusy} onBusy={setFrameBusy}
              onUseFrame={(id) => select(async () => [await api.useFrame(id)])} /> : (
            <Card className="editor-panel min-w-0 gap-4 py-5">
              <CardHeader><CardTitle className="flex items-center gap-2"><MonitorPlay className="text-muted-foreground size-4" />视频预览</CardTitle></CardHeader>
              <CardContent>
                <Empty className="editor-empty bg-muted/40 rounded-lg border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><FileVideo /></EmptyMedia>
                    <EmptyTitle>{!video ? '待导入视频' : videoError ? '视频无法预览' : engine.kind === 'missing' ? '预览需要 FFmpeg' : '正在读取视频'}</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              </CardContent>
            </Card>
          )}

          <div className="cover-inspector">
            <Card className="min-w-0 gap-3.5 py-5">
              <CardHeader><CardTitle>素材与封面</CardTitle></CardHeader>
              <CardContent className="grid gap-3.5">
                <AssetRow kind="video" asset={video} info={details ? [details.width + ' × ' + details.height, durationLabel(details.duration), details.codec.toUpperCase()].join(' · ') : undefined} disabled={controlsBusy} onPick={() => pick('video')} />
                <AssetRow kind="cover" asset={cover} info={cover && coverSize ? coverSize + ' · ' + sizeLabel(cover.bytes) : undefined} disabled={controlsBusy} onPick={() => pick('cover')} />
                <Dialog.Root>
                  <Dialog.Trigger asChild>
                    <Button variant="outline" className="cover-thumbnail" disabled={!coverSize || Boolean(coverError)} aria-label="放大封面预览">
                      <AnimatePresence initial={animated}>
                        {cover && !coverError && <motion.img key={cover.id} src={cover.preview} alt="所选视频封面"
                          initial={animated ? { opacity: 0, scale: 0.985 } : false}
                          animate={{ opacity: coverSize ? 1 : 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: animated ? 0.2 : 0 }}
                          onLoad={({ currentTarget }) => {
                            if (currentCoverId.current === cover.id) setCoverReview({ id: cover.id, info: currentTarget.naturalWidth + ' × ' + currentTarget.naturalHeight })
                          }}
                          onError={() => {
                            if (currentCoverId.current === cover.id) setCoverReview({ id: cover.id, error: '封面无法读取，请换一张 PNG、JPG 或 JPEG。' })
                          }} />}
                      </AnimatePresence>
                      {coverSize && !coverError ? <span className="cover-enlarge"><Maximize2 /></span> :
                        <span className="flex items-center gap-2"><ImageIcon />{coverError ? '无法预览封面' : '封面预览'}</span>}
                    </Button>
                  </Dialog.Trigger>
                  {cover && <Dialog.Portal>
                    <Dialog.Overlay className="qr-overlay" data-reduced={!animated} />
                    <Dialog.Content className="qr-dialog cover-dialog" data-reduced={!animated} aria-describedby={undefined}>
                      <div className="flex items-center justify-between gap-3">
                        <Dialog.Title className="font-semibold">封面预览</Dialog.Title>
                        <Dialog.Close asChild><Button size="icon-sm" variant="ghost" aria-label="关闭封面预览"><X /></Button></Dialog.Close>
                      </div>
                      <img src={cover.preview} alt="放大的视频封面" />
                    </Dialog.Content>
                  </Dialog.Portal>}
                </Dialog.Root>
                <div className={cn('replacement-drop text-muted-foreground', dragging && 'drop-active')} data-drop-zone="replacement">
                  {beam}
                  <Upload className="size-3.5" />{dragging ? '松开鼠标，导入素材' : '拖入文件以导入或替换素材'}
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0 gap-3 py-5">
              <CardHeader><CardTitle>输出设置</CardTitle></CardHeader>
              <CardContent className="grid gap-2">
                <span className="text-muted-foreground text-xs">输出文件夹</span>
                <Button variant="outline" className="w-full min-w-0 justify-start" disabled={controlsBusy}
                  title={outputDirectory} aria-label="选择输出文件夹" onClick={() => void changeOutput()}>
                  <FolderOpen /><span className="min-w-0 truncate">{outputDirectory}</span>
                </Button>
              </CardContent>
              <CardFooter className="flex flex-col items-stretch gap-3">
                <ActionButton shimmer="ready" disabled={!canExport} onClick={() => void exportCover()}>
                  {exporting ? <LoaderCircle className="animate-spin" /> : <ArrowDownToLine />}
                  {exporting ? '正在封装' : '封装封面'}
                </ActionButton>
                {exporting && (
                  <div className="grid gap-2 export-progress" role="status">
                    <span className="text-muted-foreground text-xs tabular-nums">正在封装 · {progress}%</span>
                    <Progress value={progress} aria-label="封装进度" />
                  </div>
                )}
                {output && (
                  <BlurFade key={output} className="grid gap-2">
                    <div className="min-w-0 text-sm" role="status">
                      <p className="flex items-center gap-2"><Check className="result-check size-4" />封装完成</p>
                      <p className="text-muted-foreground mt-1 truncate text-xs" title={output}>{output.split(/[\\/]/).at(-1)}</p>
                    </div>
                    <Button variant="outline" onClick={() => void api.revealOutput()}><FolderOpen />在资源管理器中查看</Button>
                  </BlurFade>
                )}
              </CardFooter>
            </Card>
          </div>
        </div>
      )}
    </section>
  )
}
