import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform, useVelocity, type MotionValue } from 'motion/react'
import { Switch } from 'radix-ui'
import type { Theme } from '../bridge'
import { api } from '../workspace'
import { useMotionEnabled } from './motion-policy'
import './theme-morph-toggle.css'

const travel = 40
const inactiveGlow = 0.58
const daylightGlow = 0.8
const pitch = 1.5
const edgePerimeter = 100
let titleBarFrame = 0
const moon = [
  '....##.......',
  '...###....+..',
  '..###........',
  '.####......+.',
  '.####.....+#+',
  '#####......+.',
  '#####........',
  '.#####.......',
  '.######...#..',
  '..#########..',
  '...#######...',
  '....#####....',
  '.............',
]
const sun = [
  '......#......',
  '......#......',
  '..#.......#..',
  '...#.....#...',
  '.....###.....',
  '....#####....',
  '##..#####..##',
  '....#####....',
  '.....###.....',
  '...#.....#...',
  '..#.......#..',
  '......#......',
  '......#......',
]

interface Dot { x: number; y: number; opacity: number }
interface Particle { from: Dot; to: Dot }

function readDots(pattern: string[]) {
  return pattern.flatMap((row, y) => [...row].flatMap((cell, x) =>
    cell === '.' ? [] : [{ x: x + 0.5, y: y + 0.5, opacity: cell === '+' ? 0.48 : 1 }]))
}

function distance(a: Dot, b: Dot) { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 }

function nearest(dots: Dot[], point: Dot) {
  return dots.reduce((best, dot) => distance(dot, point) < distance(best, point) ? dot : best)
}

function matchParticles(): Particle[] {
  const night = readDots(moon)
  const day = readDots(sun)
  const available = [...day]
  const result: Particle[] = []
  const moving = night.filter((from) => {
    const index = available.findIndex((to) => to.x === from.x && to.y === from.y)
    if (index === -1) return true
    result.push({ from, to: available.splice(index, 1)[0] })
    return false
  })
  for (const from of moving) {
    const to = nearest(available.length ? available : day, from)
    if (available.length) {
      available.splice(available.indexOf(to), 1)
      result.push({ from, to })
    } else result.push({ from, to: { ...to, opacity: 0 } })
  }
  for (const to of available) result.push({ from: { ...nearest(night, to), opacity: 0 }, to })
  return result
}

const particles = matchParticles()

function clamp(value: number, max = 1) { return Math.max(0, Math.min(max, value)) }
function mix(start: number, end: number, progress: number) { return start + (end - start) * progress }

function restingEdge(theme: Theme) {
  return theme === 'light' ? 18 : 70
}

function counterclockwiseEdge(position: number, theme: Theme) {
  const rest = restingEdge(theme)
  // Smaller positions move counterclockwise. Equivalent endpoints are one perimeter apart.
  return rest + Math.floor((position - rest + 0.0001) / edgePerimeter) * edgePerimeter
}

function Pixel({ particle, index, phase }: {
  particle: Particle; index: number; phase: MotionValue<number>
}) {
  const { from, to } = particle
  const delay = index % 7 * 0.018
  const moving = distance(from, to) > 0
  const progress = useTransform(phase, (value) => clamp((value - delay) / (1 - delay * 1.35)))
  const opacity = useTransform(progress, (value) => mix(from.opacity, to.opacity, value))
  const transform = useTransform(progress, (value) => {
    const arc = Math.sin(value * Math.PI)
    const x = mix(from.x, to.x, value) + (moving ? arc * (index % 2 ? 0.55 : -0.55) : 0)
    const y = mix(from.y, to.y, value) - (moving ? arc * 0.6 : 0)
    const size = mix(from.opacity ? 1 : 0.45, to.opacity ? 1 : 0.45, value) - (moving ? arc * 0.11 : 0)
    return `translate(${x * pitch}px, ${y * pitch}px) scale(${size})`
  })

  return <motion.span className="theme-morph-pixel" style={{ opacity, transform }} />
}

const outline = 'M14 0.85 H32 A13.15 13.15 0 0 1 45.15 14 V32 A13.15 13.15 0 0 1 32 45.15 H14 A13.15 13.15 0 0 1 0.85 32 V14 A13.15 13.15 0 0 1 14 0.85 Z'

function Sweep({ position, strength, phase }: {
  position: MotionValue<number>; strength: MotionValue<number>; phase: MotionValue<number>
}) {
  const outlineId = useId()
  const path = `#${outlineId}`
  const haloOffset = useTransform(position, (value) => 15 - value)
  const softOffset = useTransform(position, (value) => 14 - value)
  const lineOffset = useTransform(position, (value) => 12 - value)
  const coreOffset = useTransform(position, (value) => 8 - value)
  const halo = useTransform(phase, [0, 1], ['#5d6aff', '#ffab29'])
  const edge = useTransform(phase, [0, 1], ['#9faeff', '#ffca50'])
  const highlight = useTransform(phase, [0, 1], ['#f3f6ff', '#fffadc'])

  return (
    <motion.svg className="theme-morph-sweep" viewBox="-9 -9 64 64" fill="none" aria-hidden="true" style={{ opacity: strength }}>
      <defs><path id={outlineId} d={outline} pathLength="100" /></defs>
      <motion.use className="theme-morph-halo" href={path} strokeWidth="6.5" strokeDasharray="30 70"
        strokeLinecap="round" style={{ strokeDashoffset: haloOffset, stroke: halo }} />
      <motion.use href={path} opacity="0.38" strokeWidth="1.8" strokeDasharray="28 72"
        strokeLinecap="round" style={{ strokeDashoffset: softOffset, stroke: edge }} />
      <motion.use href={path} opacity="0.9" strokeWidth="1.8" strokeDasharray="24 76"
        strokeLinecap="round" style={{ strokeDashoffset: lineOffset, stroke: edge }} />
      <motion.use href={path} strokeWidth="1.8" strokeDasharray="16 84"
        strokeLinecap="round" style={{ strokeDashoffset: coreOffset, stroke: highlight }} />
    </motion.svg>
  )
}

interface ThemeMorphToggleProps {
  theme: Theme
  onThemeChange: (next: Theme) => Promise<boolean>
  active: boolean
  pending: boolean
}

interface Drag {
  pointer: number
  start: number
  initialSlide: number
  initialEdge: number
  oppositeEdge: number
  position: number
  sample: number
  time: number
  speed: number
  moved: boolean
}

function clearThemePreview() {
  const root = document.documentElement
  if (!root.dataset.themePreview) return
  cancelAnimationFrame(titleBarFrame)
  delete root.dataset.themePreview
  root.style.removeProperty('--theme-day')
  root.style.removeProperty('--theme-ink-day')
  updateTitleBar(null)
}

function paintThemePreview(progress: number) {
  const root = document.documentElement
  root.style.setProperty('--theme-day', `${clamp(progress) * 100}%`)
  root.style.setProperty('--theme-ink-day', progress < 0.57 ? '0%' : '100%')
  const tone = progress < 0.51 ? 'dark' : 'light'
  if (root.dataset.themePreview !== tone) {
    root.dataset.themePreview = tone
    cancelAnimationFrame(titleBarFrame)
    // Let the renderer paint the new background before changing the native glyphs.
    titleBarFrame = requestAnimationFrame(() => {
      titleBarFrame = requestAnimationFrame(() => updateTitleBar(tone))
    })
  }
}

function updateTitleBar(tone: Theme | null) {
  void api.previewTitleBar(tone).catch((reason) => console.warn('无法更新标题栏预览。', reason))
}

export function ThemeMorphToggle({ theme, onThemeChange, active, pending }: ThemeMorphToggleProps) {
  const enabled = useMotionEnabled()
  const [visible, setVisible] = useState(() => !document.hidden)
  const [dragging, setDragging] = useState(false)
  const light = theme === 'light'
  const restGlow = light ? daylightGlow : inactiveGlow
  const slide = useMotionValue(light ? travel : 0)
  const phase = useMotionValue(light ? 1 : 0)
  const edge = useMotionValue(restingEdge(theme))
  const glow = useMotionValue(restGlow)
  const velocity = useVelocity(slide)
  const scaleX = useTransform(velocity, (value) => 1 + clamp(Math.abs(value) / 330) * 0.045)
  const scaleY = useTransform(velocity, (value) => 1 - clamp(Math.abs(value) / 330) * 0.027)
  const reflection = useTransform(glow, [inactiveGlow, 1], [0.33, 0.95])
  const reflectionColor = useTransform(phase, [0, 1], ['#7580ff', '#ff9f24'])
  const reflectionX = useTransform(edge, (value) => 8 * Math.sin(value * Math.PI / 50))
  const reflectionY = useTransform(edge, (value) => -7 * Math.cos(value * Math.PI / 50))
  const ink = useTransform(phase, [0, 0.52, 0.62, 1], ['#f9fbff', '#f9fbff', '#343137', '#343137'])
  const nightPhase = useTransform(phase, (progress) => 1 - progress)
  const committed = useRef(theme)
  const target = useRef(theme)
  const edgeDestination = useRef(restingEdge(theme))
  const preview = useRef(false)
  const canPreview = useRef(false)
  const requestInFlight = useRef(false)
  const drag = useRef<Drag>(undefined)
  const suppressClick = useRef(false)
  const playback = useRef<{ stop: () => void }[]>([])
  const shouldAnimate = enabled && active && visible

  const stopPlayback = useCallback(() => {
    for (const animation of playback.current) animation.stop()
    playback.current = []
  }, [])

  const finishPreview = useCallback(() => {
    const endpoint = committed.current === 'light' ? 1 : 0
    if (preview.current && !drag.current && target.current === committed.current && Math.abs(phase.get() - endpoint) < 0.001) {
      preview.current = false
      clearThemePreview()
    }
  }, [phase])

  useMotionValueEvent(phase, 'change', (progress) => {
    if (preview.current) paintThemePreview(progress)
  })

  useEffect(() => {
    function updateVisibility() { setVisible(!document.hidden) }
    document.addEventListener('visibilitychange', updateVisibility)
    return () => document.removeEventListener('visibilitychange', updateVisibility)
  }, [])

  useLayoutEffect(() => {
    canPreview.current = shouldAnimate
    return () => {
      canPreview.current = false
      drag.current = undefined
      stopPlayback()
      if (preview.current) clearThemePreview()
      preview.current = false
    }
  }, [shouldAnimate, stopPlayback])

  useLayoutEffect(() => {
    committed.current = theme
    if (!shouldAnimate || !preview.current) {
      target.current = theme
      slide.jump(light ? travel : 0)
      phase.jump(light ? 1 : 0)
      edgeDestination.current = restingEdge(theme)
      edge.jump(edgeDestination.current)
      glow.jump(restGlow)
      setDragging(false)
    }
    finishPreview()
  }, [edge, finishPreview, glow, light, phase, restGlow, shouldAnimate, slide, theme])

  function startPreview() {
    preview.current = true
    paintThemePreview(phase.get())
  }

  function settle(next: Theme, nextEdge: number, speed = slide.getVelocity()) {
    if (!canPreview.current) return
    stopPlayback()
    startPreview()
    target.current = next
    edgeDestination.current = nextEdge
    const day = next === 'light'
    const destination = day ? travel : 0
    const speedLimit = Math.min(250, 55 + Math.abs(destination - slide.get()) * 8)
    playback.current = [
      animate(slide, destination, {
        type: 'spring', stiffness: 370, damping: 25, mass: 0.82, velocity: Math.max(-speedLimit, Math.min(speedLimit, speed)),
      }),
      animate(phase, day ? 1 : 0, { duration: 0.32, ease: [0.25, 0.65, 0.3, 1], onComplete: finishPreview }),
      animate(edge, nextEdge, { duration: 0.46, ease: [0.2, 0.55, 0.25, 1] }),
      animate(glow, [glow.get(), 1, day ? daylightGlow : inactiveGlow], { duration: 0.46, times: [0, 0.25, 1], ease: 'easeInOut' }),
    ]
  }

  function selectTheme(next: Theme, speed?: number) {
    if (pending || requestInFlight.current || !active) return
    const changing = next !== committed.current
    const previousEdge = edgeDestination.current
    settle(next, changing ? counterclockwiseEdge(edge.get(), next) : previousEdge, speed)
    if (!changing) return
    requestInFlight.current = true
    void onThemeChange(next).then((saved) => {
      if (!saved && canPreview.current && target.current === next) settle(committed.current, previousEdge, 0)
    }).finally(() => {
      requestInFlight.current = false
    })
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (pending || requestInFlight.current || !active || !event.isPrimary || event.button !== 0 || drag.current) return
    suppressClick.current = false
    const initialSlide = canPreview.current ? slide.get() : committed.current === 'light' ? travel : 0
    const initialEdge = edge.get()
    const oppositeTheme = committed.current === 'light' ? 'dark' : 'light'
    drag.current = {
      pointer: event.pointerId, start: event.clientX, initialSlide, position: initialSlide,
      initialEdge, oppositeEdge: counterclockwiseEdge(Math.min(initialEdge, edgeDestination.current), oppositeTheme),
      sample: initialSlide, time: event.timeStamp, speed: 0, moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function updateDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current || event.pointerId !== current.pointer) return
    const delta = event.clientX - current.start
    if (!current.moved) {
      if (Math.abs(delta) < 3) return
      current.moved = true
      stopPlayback()
      setDragging(true)
      if (canPreview.current) startPreview()
    }
    const raw = current.initialSlide + delta
    current.position = clamp(raw, travel)
    const stretch = Math.max(-2, Math.min(2, (raw - current.position) * 0.16))
    const next = current.position + stretch
    current.speed = (next - current.sample) * 1000 / Math.max(8, event.timeStamp - current.time)
    current.sample = next
    current.time = event.timeStamp

    if (canPreview.current) {
      const progress = current.position / travel
      const startedLight = committed.current === 'light'
      const initialProgress = clamp(current.initialSlide / travel)
      const towardOther = startedLight ? 1 - progress : progress
      const initialTowardOther = startedLight ? 1 - initialProgress : initialProgress
      let sweep = current.initialEdge
      if (towardOther > initialTowardOther) {
        sweep = mix(sweep, current.oppositeEdge, (towardOther - initialTowardOther) / (1 - initialTowardOther))
      } else if (towardOther < initialTowardOther) {
        sweep = mix(sweep, edgeDestination.current, (initialTowardOther - towardOther) / initialTowardOther)
      }
      slide.set(next)
      phase.set(progress)
      edge.set(sweep)
      glow.set(1)
    }
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>, canceled = false) {
    const current = drag.current
    if (!current || event.pointerId !== current.pointer) return
    drag.current = undefined
    if (!current.moved) return

    suppressClick.current = true
    setDragging(false)
    if (canceled) {
      settle(committed.current, edgeDestination.current, 0)
      return
    }
    const next = current.position >= travel / 2 ? 'light' : 'dark'
    selectTheme(next, event.timeStamp - current.time < 60 ? current.speed : 0)
  }

  return (
    <Switch.Root type="button" className="theme-morph-toggle" aria-label="浅色主题" checked={light}
      aria-busy={pending} aria-disabled={pending || undefined} data-pending={pending || undefined} data-dragging={dragging || undefined}
      onPointerDown={startDrag} onPointerMove={updateDrag} onPointerUp={finishDrag}
      onPointerCancel={(event) => finishDrag(event, true)} onLostPointerCapture={(event) => finishDrag(event, true)}
      onClick={(event) => {
        if (event.detail > 0 && suppressClick.current) {
          suppressClick.current = false
          event.preventDefault()
        }
      }}
      onCheckedChange={(checked) => { if (!drag.current) selectTheme(checked ? 'light' : 'dark') }}>
      <motion.span className="theme-morph-track" aria-hidden="true" style={{ opacity: nightPhase }} />
      <motion.span className="theme-morph-track theme-morph-track-day" aria-hidden="true" style={{ opacity: phase }} />
      <Switch.Thumb asChild>
        <motion.span className="theme-morph-thumb" aria-hidden="true" style={{ x: slide, scaleX, scaleY }}>
          <motion.span className="theme-morph-reflection"
            style={{ opacity: reflection, color: reflectionColor, x: reflectionX, y: reflectionY }} />
          <motion.span className="theme-morph-face" style={{ opacity: nightPhase }} />
          <motion.span className="theme-morph-face theme-morph-face-day" style={{ opacity: phase }} />
          <motion.span className="theme-morph-glyph" style={{ color: ink }}>
            {particles.map((particle, index) => <Pixel key={index} particle={particle} index={index} phase={phase} />)}
          </motion.span>
          <Sweep position={edge} strength={glow} phase={phase} />
        </motion.span>
      </Switch.Thumb>
    </Switch.Root>
  )
}
