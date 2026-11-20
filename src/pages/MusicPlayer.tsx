import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Pause, Play, Volume2, VolumeX } from 'lucide-react'
import type { MusicInfo } from '../bridge'
import { useMotionEnabled } from '../ui/motion-policy'
import { Button } from '../ui/shadcn/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/shadcn/card'
import { lyricAt, parseTimedLyrics } from './music-lyrics'

function timeLabel(value: number) {
  const seconds = Math.floor(value)
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
}

export function MusicPlayer({ audio, active, lyric, lyricControls }: {
  audio: MusicInfo; active: boolean; lyric?: string; lyricControls: ReactNode
}) {
  const media = useRef<HTMLAudioElement>(null)
  const lyricView = useRef<HTMLDivElement>(null)
  const line = useRef<HTMLParagraphElement>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState('')
  const animated = useMotionEnabled()
  const rows = useMemo(() => parseTimedLyrics(lyric ?? ''), [lyric])
  const current = lyricAt(rows, time * 1000)
  const progress = duration > 0 ? time / duration * 100 : 0

  useLayoutEffect(() => {
    const element = media.current
    return () => { element?.pause() }
  }, [])
  useLayoutEffect(() => {
    if (!active) media.current?.pause()
  }, [active])
  useLayoutEffect(() => {
    if (lyricView.current) lyricView.current.scrollTop = 0
  }, [lyric])
  useLayoutEffect(() => {
    const view = lyricView.current
    const row = line.current
    if (!active || !view || !rows.length) return
    const top = row ? view.scrollTop + row.getBoundingClientRect().top - view.getBoundingClientRect().top
      - (view.clientHeight - row.offsetHeight) / 2 : 0
    view.scrollTo({ top, behavior: playing && animated ? 'smooth' : 'instant' })
  }, [active, animated, current, playing, rows])

  async function toggle() {
    const element = media.current
    if (!element) return
    if (!element.paused) { element.pause(); return }
    try {
      setError('')
      await element.play()
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError('无法播放该音频，请重新导入后再试')
    }
  }

  return <Card className="min-w-0 gap-3 py-4">
    <CardHeader><CardTitle>音频预览</CardTitle></CardHeader>
    <CardContent className="grid min-w-0 gap-3.5">
      <audio ref={media} preload="metadata" src={audio.playback}
        onDurationChange={({ currentTarget }) => setDuration(Number.isFinite(currentTarget.duration) ? currentTarget.duration : 0)}
        onTimeUpdate={({ currentTarget }) => setTime(currentTarget.currentTime)}
        onSeeked={({ currentTarget }) => setTime(currentTarget.currentTime)}
        onPlaying={({ currentTarget }) => { if (!active) currentTarget.pause(); else setPlaying(true) }}
        onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onError={() => { setPlaying(false); setError('无法读取音频预览。封面与歌词仍可操作') }} />
      <div className="music-player-panel">
        <Button variant="default" size="icon" className="rounded-full" aria-label={playing ? '暂停音频' : '播放音频'}
          disabled={!duration} onClick={() => void toggle()}>{playing ? <Pause /> : <Play />}</Button>
        <div className="grid min-w-0 gap-1">
          <div className="music-seek" style={{ '--music-progress': Math.min(100, Math.max(0, progress)) + '%' } as CSSProperties}>
            <div className="music-seek-track" aria-hidden="true">
              <span className="music-seek-fill">{playing && active && animated && <span className="music-seek-glow" />}</span>
            </div>
            <input type="range" aria-label="音频进度" aria-valuetext={timeLabel(time)} min={0} max={duration || 1} step="any"
              disabled={!duration} value={time} onChange={(event) => {
                const next = Number(event.currentTarget.value)
                if (media.current) { media.current.currentTime = next; setTime(next) }
              }} />
          </div>
          <div className="text-muted-foreground flex justify-between gap-2 text-xs tabular-nums">
            <span>{timeLabel(time)}</span><span>{duration ? timeLabel(duration) : '–:––'}</span>
          </div>
        </div>
        <div className="music-volume">
          <Button variant="ghost" size="icon-xs" aria-label={muted ? '取消静音' : '静音'} aria-pressed={muted} onClick={() => {
            if (media.current) { media.current.muted = !muted; setMuted(!muted) }
          }}>{muted || volume === 0 ? <VolumeX /> : <Volume2 />}</Button>
          <input aria-label="音量" type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume}
            onChange={(event) => {
              const next = Number(event.currentTarget.value)
              if (media.current) { media.current.volume = next; media.current.muted = false; setVolume(next); setMuted(false) }
            }} />
        </div>
      </div>
      {error && <p className="text-destructive text-xs" role="alert">{error}</p>}
      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">歌词</h2>
          {lyricControls}
        </div>
        {rows.length ? <div ref={lyricView} className="music-lyrics-view" aria-label="同步歌词" tabIndex={0}>
          {rows.map((row, index) => <p key={row.time} ref={index === current ? line : undefined}
            aria-current={index === current ? 'true' : undefined}>{row.text || '\u00a0'}</p>)}
        </div> : lyric ? <div ref={lyricView} tabIndex={0} className="music-lyrics-view music-lyrics-plain" aria-label="文本歌词">
          <pre>{lyric}</pre>
        </div> : <p className="text-muted-foreground text-sm">暂无歌词，可导入 LRC 预览</p>}
      </div>
    </CardContent>
  </Card>
}
