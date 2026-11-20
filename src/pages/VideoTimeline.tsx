import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Film, ImagePlus, MonitorPlay, Pause, Play } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { Asset, VideoDetails, VideoFrame } from '../bridge'
import { api, errorText } from '../workspace'
import { Button } from '../ui/shadcn/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/shadcn/card'

function clockLabel(seconds: number) {
  const millis = Math.max(0, Math.round(seconds * 1000))
  const secondsPart = Math.floor(millis / 1000) % 60
  const minutes = Math.floor(millis / 60000)
  const pad = (value: number, length = 2) => String(value).padStart(length, '0')
  return `${pad(minutes)}:${pad(secondsPart)}.${pad(millis % 1000, 3)}`
}

function rulerTicks(duration: number) {
  const target = duration / 5
  const unit = Math.max(0.001, 10 ** Math.floor(Math.log10(target)))
  const step = ([1, 2, 5, 10].find((multiple) => multiple * unit >= target) ?? 10) * unit
  return Array.from({ length: Math.ceil(duration * 0.94 / step) }, (_, index) => index * step)
}

function presentedFrame(media: HTMLVideoElement, readCurrent: () => number | undefined) {
  const current = readCurrent()
  if (current !== undefined) return Promise.resolve(current)

  return new Promise<number | undefined>((resolve) => {
    let callback = media.requestVideoFrameCallback(track)
    let paint = 0
    const timeout = window.setTimeout(() => finish(readCurrent()), 800)
    media.addEventListener('seeked', onSeeked)

    function finish(time: number | undefined) {
      media.cancelVideoFrameCallback(callback)
      window.cancelAnimationFrame(paint)
      window.clearTimeout(timeout)
      media.removeEventListener('seeked', onSeeked)
      resolve(time)
    }

    function onSeeked() {
      window.cancelAnimationFrame(paint)
      paint = window.requestAnimationFrame(() => {
        const time = readCurrent()
        if (time !== undefined) finish(time)
      })
    }

    function track(_now: number, metadata: VideoFrameCallbackMetadata) {
      if (media.seeking) callback = media.requestVideoFrameCallback(track)
      else finish(metadata.mediaTime)
    }
  })
}

export function VideoTimeline({ video, details, active, disabled, onUseFrame, onBusy }: {
  video: Asset
  details: VideoDetails
  active: boolean
  disabled: boolean
  onUseFrame: (id: string) => Promise<void>
  onBusy: (busy: boolean) => void
}) {
  const [time, setTime] = useState(0)
  const [fallbackFrame, setFallbackFrame] = useState<VideoFrame>()
  const [playing, setPlaying] = useState(false)
  const [canPlay, setCanPlay] = useState(false)
  const [fallback, setFallback] = useState(false)
  const [decoding, setDecoding] = useState(false)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const player = useRef<HTMLVideoElement>(null)
  const revision = useRef(0)
  const timer = useRef<number>(undefined)
  const target = useRef(0)
  const lastPresented = useRef<{ time: number; position: number }>(undefined)
  const capture = useRef<{ revision: number; pending: Promise<VideoFrame | undefined> }>(undefined)
  const playingNow = useRef(false)
  const workingNow = useRef(false)
  const getFrame = useCallback((seconds: number, showImage: boolean, pausedFrame?: number) => {
    window.clearTimeout(timer.current)
    const request = revision.current
    if (capture.current?.revision === request) return capture.current.pending
    setDecoding(true)
    setMessage('')
    async function prepareFrame() {
      try {
        const media = showImage ? null : player.current
        const displayed = pausedFrame ?? (media && seconds < details.duration ? await presentedFrame(media, () => {
          const last = lastPresented.current
          if (!media.seeking && last?.position === media.currentTime) return last.time
        }) : undefined)
        if (request !== revision.current) return
        const result = await api.extractFrame(video.id, displayed ?? seconds, displayed !== undefined)
        if (request !== revision.current) return

        if (showImage) {
          const preview = new Image()
          preview.src = result.preview
          await preview.decode()
          if (request !== revision.current) return
          target.current = result.time
          setTime(result.time)
          setFallbackFrame(result)
        }
        setMessage('已定位')
        return result
      } catch (error) {
        if (request === revision.current) setMessage(errorText(error))
      } finally {
        if (request === revision.current) setDecoding(false)
      }
    }
    const pending = prepareFrame().then((result) => {
      if (!result && capture.current?.revision === request) capture.current = undefined
      return result
    })
    capture.current = { revision: request, pending }
    return pending
  }, [details.duration, video.id])

  useEffect(() => {
    const media = player.current
    if (!media || fallback) return
    let callback = 0
    const track = (_when: number, metadata: VideoFrameCallbackMetadata) => {
      // A new frame can be submitted before Chromium finishes dispatching the seek.
      lastPresented.current = { time: metadata.mediaTime, position: media.currentTime }
      if (playingNow.current && !media.seeking) {
        target.current = metadata.mediaTime
        setTime(metadata.mediaTime)
      }
      callback = media.requestVideoFrameCallback(track)
    }
    callback = media.requestVideoFrameCallback(track)
    return () => media.cancelVideoFrameCallback(callback)
  }, [fallback])

  useEffect(() => {
    if (active) return
    if (playingNow.current) target.current = lastPresented.current?.time ?? player.current?.currentTime ?? target.current
    playingNow.current = false
    player.current?.pause()
    setPlaying(false)
    setTime(target.current)
    window.clearTimeout(timer.current)
    if (!workingNow.current) {
      revision.current++
      setDecoding(false)
      void api.cancelFrame(video.id).catch(() => {})
    }
  }, [active, video.id])

  useEffect(() => () => {
    revision.current++
    window.clearTimeout(timer.current)
  }, [])

  function pauseTime(atEnd = false) {
    const seconds = atEnd ? details.duration : lastPresented.current?.time ?? player.current?.currentTime ?? target.current
    playingNow.current = false
    player.current?.pause()
    setPlaying(false)
    target.current = seconds
    setTime(seconds)
    return seconds
  }

  async function togglePlayback() {
    const media = player.current
    if (!media) return
    if (playingNow.current) {
      void getFrame(pauseTime(), false, lastPresented.current?.time)
      return
    }
    window.clearTimeout(timer.current)
    revision.current++
    void api.cancelFrame(video.id).catch(() => {})
    lastPresented.current = undefined
    setDecoding(false)
    setMessage('')
    try {
      if (media.ended || target.current >= details.duration) media.currentTime = 0
      playingNow.current = true
      setPlaying(true)
      await media.play()
    } catch (error) {
      if (playingNow.current) {
        playingNow.current = false
        setPlaying(false)
        setMessage(errorText(error))
      }
    }
  }

  function seek(seconds: number) {
    if (playingNow.current) pauseTime()
    target.current = seconds
    revision.current++
    if (player.current && canPlay && !fallback) player.current.currentTime = seconds
    setTime(seconds)
    setMessage('')
    setDecoding(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void getFrame(seconds, fallback), 150)
  }

  function switchToFrames() {
    revision.current++
    playingNow.current = false
    setPlaying(false)
    setFallback(true)
    void getFrame(target.current, true)
  }

  async function applyFrame(save: boolean) {
    if (workingNow.current || disabled) return
    workingNow.current = true
    setWorking(true)
    onBusy(true)
    setMessage('')
    try {
      const wasPlaying = playingNow.current
      const seconds = wasPlaying ? pauseTime() : target.current
      const snapshot = await getFrame(seconds, fallback, wasPlaying ? lastPresented.current?.time : undefined)
      if (!snapshot) return
      if (save) {
        if (await api.saveFrame(snapshot.id)) setMessage('当前帧已导出为 PNG')
      } else await onUseFrame(snapshot.id)
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      workingNow.current = false
      setWorking(false)
      onBusy(false)
    }
  }

  const position = Math.max(0, Math.min(time, details.duration))
  const status = decoding ? '正在定位视频帧…' : message || (fallback ? '当前编码无法连续播放，可以拖动时间轴选帧' : '')
  return (
    <Card className="editor-panel min-w-0 gap-4 py-5" aria-label="视频时间轴">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2"><MonitorPlay className="text-muted-foreground size-4" />视频预览</CardTitle>
        {fallback && <span className="text-muted-foreground text-xs">FFmpeg 逐帧预览</span>}
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="timeline-stage">
          {!fallback && <video ref={player} src={video.preview} preload="auto" playsInline
            onLoadedData={() => setCanPlay(true)} onError={switchToFrames}
            onTimeUpdate={(event) => {
              if (playingNow.current && lastPresented.current === undefined) {
                target.current = event.currentTarget.currentTime
                setTime(target.current)
              }
            }}
            onEnded={() => {
              if (playingNow.current) void getFrame(pauseTime(true), false)
            }} />}
          {fallback && fallbackFrame && <img src={fallbackFrame.preview} alt="当前视频帧" />}
          {fallback && !fallbackFrame && <p className="text-xs text-white">{decoding ? '正在解码当前帧' : '拖动时间轴定位视频帧'}</p>}
        </div>
        <div className="editor-controls">
          <div className="editor-transport">
            <Button variant="outline" size="sm" disabled={disabled || working || !canPlay || fallback}
              onClick={() => void togglePlayback()}>
              {playing ? <Pause /> : <Play />}{playing ? '暂停' : '播放'}
            </Button>
            <span className="editor-time"><strong>{clockLabel(time)}</strong> / {clockLabel(details.duration)}</span>
          </div>
          <div className="editor-seek" style={{ '--playhead': `${position / details.duration * 100}%` } as CSSProperties}>
            <div className="editor-scale" aria-hidden="true">
              <div className="editor-ruler">
                {rulerTicks(details.duration).map((tick) => <span key={tick} style={{ left: `${tick / details.duration * 100}%` }}>
                  {clockLabel(tick).replace(/\.000$/, '')}
                </span>)}
              </div>
              <div className="editor-track"><Film size={14} /><span title={video.name}>{video.name}</span></div>
              <div className="editor-playhead" />
            </div>
            <input className="timeline-range" type="range" aria-label="视频定位" min={0}
              max={details.duration} step="any" value={position}
              aria-valuetext={`${clockLabel(position)}，总时长 ${clockLabel(details.duration)}`}
              disabled={disabled || working || (!canPlay && !fallback)} onChange={(event) => seek(Number(event.currentTarget.value))} />
          </div>
        </div>
        <div className="editor-actions">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={disabled || working || (!canPlay && !fallback)} onClick={() => void applyFrame(false)}>
              <ImagePlus />使用当前帧
            </Button>
            <Button variant="ghost" size="sm" disabled={disabled || working || (!canPlay && !fallback)} onClick={() => void applyFrame(true)}>
              <Download />导出当前帧
            </Button>
          </div>
          <p role="status" title={status} className="editor-status text-muted-foreground truncate text-right text-xs">{status}</p>
        </div>
      </CardContent>
    </Card>
  )
}
