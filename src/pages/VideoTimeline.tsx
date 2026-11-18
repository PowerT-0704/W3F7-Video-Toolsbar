import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, ImagePlus, Pause, Play } from 'lucide-react'
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

export function VideoTimeline({ video, details, active, disabled, onUseFrame, onBusy }: {
  video: Asset
  details: VideoDetails
  active: boolean
  disabled: boolean
  onUseFrame: (id: string) => Promise<void>
  onBusy: (busy: boolean) => void
}) {
  const [time, setTime] = useState(0)
  const [frame, setFrame] = useState<VideoFrame>()
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
  const lastPresented = useRef<number>(undefined)
  const captured = useRef<VideoFrame>(undefined)
  const playingNow = useRef(false)
  const workingNow = useRef(false)

  const getFrame = useCallback(async (seconds: number, presented: boolean) => {
    window.clearTimeout(timer.current)
    const request = ++revision.current
    setDecoding(true)
    setMessage('')
    try {
      const result = await api.extractFrame(video.id, seconds, presented)
      if (request !== revision.current) return
      captured.current = result
      target.current = result.time
      setTime(result.time)
      setFrame(result)
      return result
    } catch (error) {
      if (request === revision.current) setMessage(errorText(error))
    } finally {
      if (request === revision.current) setDecoding(false)
    }
  }, [video.id])

  useEffect(() => {
    const media = player.current
    if (!media || fallback) return
    let callback = 0
    const track = (_when: number, metadata: VideoFrameCallbackMetadata) => {
      lastPresented.current = metadata.mediaTime
      callback = media.requestVideoFrameCallback(track)
    }
    callback = media.requestVideoFrameCallback(track)
    return () => media.cancelVideoFrameCallback(callback)
  }, [fallback])

  useEffect(() => {
    if (active) return
    if (playingNow.current) target.current = lastPresented.current ?? player.current?.currentTime ?? target.current
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

  function pauseTime() {
    const seconds = lastPresented.current ?? player.current?.currentTime ?? target.current
    playingNow.current = false
    player.current?.pause()
    setPlaying(false)
    target.current = seconds
    return seconds
  }

  async function togglePlayback() {
    const media = player.current
    if (!media) return
    if (playingNow.current) {
      void getFrame(pauseTime(), true)
      return
    }
    window.clearTimeout(timer.current)
    revision.current++
    void api.cancelFrame(video.id).catch(() => {})
    captured.current = undefined
    lastPresented.current = undefined
    setFrame(undefined)
    setDecoding(false)
    setMessage('')
    try {
      media.currentTime = media.ended ? 0 : target.current
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
    captured.current = undefined
    revision.current++
    if (player.current && canPlay && !fallback) player.current.currentTime = seconds
    if (!fallback) setFrame(undefined)
    setTime(seconds)
    setMessage('')
    setDecoding(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void getFrame(seconds, false), 150)
  }

  function switchToFrames() {
    playingNow.current = false
    setPlaying(false)
    setFallback(true)
    void getFrame(target.current, false)
  }

  async function applyFrame(save: boolean) {
    if (workingNow.current || disabled) return
    workingNow.current = true
    setWorking(true)
    onBusy(true)
    setMessage('')
    try {
      const snapshot = playingNow.current ? await getFrame(pauseTime(), true) :
        captured.current ?? await getFrame(target.current, false)
      if (!snapshot) return
      if (save) {
        if (await api.saveFrame(snapshot.id)) setMessage('当前帧已导出为 PNG。')
      } else await onUseFrame(snapshot.id)
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      workingNow.current = false
      setWorking(false)
      onBusy(false)
    }
  }

  return (
    <Card className="min-w-0 gap-4 py-5" aria-label="视频时间轴">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>视频时间轴</CardTitle>
        {fallback && <span className="text-muted-foreground text-xs">FFmpeg 逐帧预览</span>}
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="timeline-stage">
          {!fallback && <video ref={player} src={video.preview} preload="auto" playsInline
            onLoadedData={() => setCanPlay(true)} onError={switchToFrames}
            onTimeUpdate={(event) => {
              if (playingNow.current) {
                target.current = event.currentTarget.currentTime
                setTime(target.current)
              }
            }}
            onEnded={() => {
              if (playingNow.current) void getFrame(pauseTime(), true)
            }} />}
          {!playing && frame && <img src={frame.preview} alt="当前视频帧" />}
          {fallback && !frame && <p className="text-xs text-white">{decoding ? '正在解码当前帧' : '拖动时间轴定位视频帧'}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button variant="outline" size="sm" disabled={disabled || working || !canPlay || fallback}
            onClick={() => void togglePlayback()}>
            {playing ? <Pause /> : <Play />}{playing ? '暂停' : '播放'}
          </Button>
          <input className="timeline-range min-w-28 flex-1" type="range" aria-label="视频定位" min={0}
            max={details.duration} step="any" value={Math.min(time, details.duration)}
            disabled={disabled || working} onChange={(event) => seek(Number(event.currentTarget.value))} />
          <output className="text-muted-foreground text-xs tabular-nums">{clockLabel(time)} / {clockLabel(details.duration)}</output>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={disabled || working} onClick={() => void applyFrame(false)}>
            <ImagePlus />使用当前帧
          </Button>
          <Button variant="ghost" size="sm" disabled={disabled || working} onClick={() => void applyFrame(true)}>
            <Download />导出当前帧
          </Button>
        </div>
        {(decoding || message || fallback) && <p role="status" className="text-muted-foreground text-xs">
          {decoding ? '正在定位视频帧…' : message || '当前编码无法连续播放，可以拖动时间轴选帧。'}
        </p>}
      </CardContent>
    </Card>
  )
}
