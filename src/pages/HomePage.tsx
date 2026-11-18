import { ArrowRight, Clapperboard, Film, History } from 'lucide-react'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { version } from '../../package.json'
import { ActionButton } from '../ui/action-button'
import { BlurFade } from '../ui/blur-fade'
import { useMotionEnabled } from '../ui/motion-policy'
import { positionSpotlight } from '../ui/spotlight'
import { Badge } from '../ui/shadcn/badge'
import { Button } from '../ui/shadcn/button'
import type { UpdateResult } from '../bridge'
import { api, errorText } from '../workspace'
import { useEffect, useRef, useState } from 'react'

export function Startup({ animated }: { animated: boolean }) {
  return (
    <div className="startup" role="status" aria-label="正在启动" data-startup={animated ? 'playing' : 'loading'}>
      <motion.div className="startup-lockup" initial={animated ? { opacity: 0, scale: 0.88 } : false}
        animate={animated ? { opacity: [0, 1, 1, 0], scale: [0.88, 1.02, 1, 1.025] } : { opacity: 1, scale: 1 }}
        transition={{ duration: animated ? 0.45 : 0, times: [0, 0.38, 0.75, 1] }}>
        <span className="startup-mark"><Clapperboard />{animated && <span className="startup-sheen" />}</span>
        <span>W3F7のVideo_Toolsbar</span>
      </motion.div>
    </div>
  )
}

function AnimatedFilmEmblem({ active }: { active: boolean }) {
  const phase = useMotionValue(0)
  const rotate = useTransform(phase, (progress) => -11 + progress * 360 - 12 * Math.sin(progress * 2 * Math.PI))
  const x = useTransform(phase, (progress) => 7 * Math.sin(progress * 2 * Math.PI))
  const y = useTransform(phase, (progress) => 5 * (Math.cos(progress * 2 * Math.PI) - 1))
  const playback = useRef<{ play: () => void; pause: () => void }>(undefined)

  useEffect(() => {
    const controls = animate(phase, [0, 1], { duration: 16, repeat: Infinity, ease: 'linear' })
    playback.current = controls
    return () => { playback.current = undefined; controls.stop() }
  }, [phase])

  useEffect(() => {
    function updateVisibility() {
      if (active && !document.hidden) playback.current?.play()
      else playback.current?.pause()
    }
    updateVisibility()
    document.addEventListener('visibilitychange', updateVisibility)
    return () => document.removeEventListener('visibilitychange', updateVisibility)
  }, [active])

  return <motion.div style={{ rotate, x, y }} className="film-emblem" aria-hidden="true"><Film /></motion.div>
}

export function HomePage({ active, onOpenCover, onOpenLog, update }: {
  active: boolean; onOpenCover: () => void; onOpenLog: () => void; update?: UpdateResult
}) {
  const enabled = useMotionEnabled()
  const [error, setError] = useState('')
  return (
    <section className="page-layout home-page">
      <div className="home-hero spotlight-surface" onPointerMove={enabled ? positionSpotlight : undefined}>
        <div className="home-copy">
          <BlurFade delay={0.045}>
            <h1>W3F7の<span>Video_Toolsbar</span></h1>
            <p>在本地处理视频。拖入 MP4 和一张图片，即可写入自定义封面，保留原始画质与音轨。</p>
          </BlurFade>
          <BlurFade delay={0.095}>
            <div className="home-actions">
              <ActionButton size="lg" shimmer="hover" onClick={onOpenCover}>打开视频封面封装<ArrowRight /></ActionButton>
              <Button variant="outline" size="lg" onClick={onOpenLog}><History />查看开发日志</Button>
            </div>
          </BlurFade>
        </div>
        <BlurFade className="home-art" delay={0.075}>
          {enabled ? <AnimatedFilmEmblem active={active} /> : <div className="film-emblem" aria-hidden="true"><Film /></div>}
        </BlurFade>
      </div>
      {update?.kind === 'available' && <div className="update-banner">
        <span>发现正式版 <strong>{update.version}</strong></span>
        <Button variant="outline" size="sm" onClick={() => void api.openUpdate().catch((reason) => setError(errorText(reason)))}>前往下载<ArrowRight /></Button>
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      </div>}
      <BlurFade className="home-footer" delay={0.13}>
        <footer>
          <span>W3F7のVideo_Toolsbar</span>
          <Badge variant="outline">v{version}</Badge>
          <span>© 2026 W3F7</span>
        </footer>
      </BlurFade>
    </section>
  )
}
