import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { Tabs } from 'radix-ui'

const views = [['jobs', '任务设置'], ['polish', '字幕优化与翻译'], ['synthesis', '字幕视频合成']] as const
export type CaptionView = typeof views[number][0]

interface TabBox { x: number; y: number; width: number; height: number }
interface Press { id: number; x: number; y: number; target: CaptionView; held: boolean; cancelled: boolean; timer: number; listeners: AbortController }
const holdDelay = 180

export function CaptionTabs({ value, onChange, active, animated, children }: {
  value: CaptionView; onChange: (value: CaptionView) => void; active: boolean; animated: boolean; children: ReactNode
}) {
  const list = useRef<HTMLDivElement>(null)
  const press = useRef<Press>(undefined)
  const [rest, setRest] = useState<TabBox>()
  const [drag, setDrag] = useState<TabBox>()
  const [glow, setGlow] = useState(false)
  const flareTimer = useRef<number>(undefined)

  const tab = useCallback((view: CaptionView) => list.current?.querySelector<HTMLElement>(`[data-view-tab="${view}"]`), [])
  const box = useCallback((view: CaptionView) => {
    const button = tab(view)
    if (button) return { x: button.offsetLeft, y: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight }
  }, [tab])

  useLayoutEffect(() => {
    if (!active || !list.current) return
    const measure = () => setRest(box(value))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list.current)
    for (const [view] of views) {
      const button = tab(view)
      if (button) observer.observe(button)
    }
    return () => observer.disconnect()
  }, [active, value, box, tab])

  const clearPress = useCallback(() => {
    const current = press.current
    if (!current) return
    press.current = undefined
    window.clearTimeout(current.timer)
    current.listeners.abort()
    if (list.current?.hasPointerCapture(current.id)) list.current.releasePointerCapture(current.id)
    setDrag(undefined)
  }, [])

  useEffect(() => {
    if (!active) clearPress()
    window.addEventListener('blur', clearPress)
    return () => {
      window.removeEventListener('blur', clearPress)
      clearPress()
      window.clearTimeout(flareTimer.current)
    }
  }, [active, clearPress])

  useEffect(() => {
    if (!animated) setGlow(false)
  }, [animated])

  function flare() {
    if (!animated) return
    setGlow(true)
    window.clearTimeout(flareTimer.current)
    flareTimer.current = window.setTimeout(() => setGlow(false), 520)
  }

  function choose(next: CaptionView) {
    if (next !== value) onChange(next)
    flare()
  }

  function moveThumb(clientX: number) {
    const track = list.current
    if (!track) return
    const boxes = views.map(([view]) => box(view))
    const [first, middle, last] = boxes
    if (!first || !middle || !last) return
    const bounds = track.getBoundingClientRect()
    if (!bounds.width) return
    const center = (item: TabBox) => item.x + item.width / 2
    const x = Math.max(center(first), Math.min(center(last),
      (clientX - bounds.left) * track.offsetWidth / bounds.width - track.clientLeft))
    const [from, to] = x < center(middle) ? [first, middle] : [middle, last]
    const ratio = (x - center(from)) / (center(to) - center(from) || 1)
    const width = from.width + (to.width - from.width) * ratio
    setDrag({ x: x - width / 2, width, y: from.y, height: from.height })
  }

  function onDown(event: PointerEvent<HTMLDivElement>) {
    const track = list.current
    if (!active || !track || press.current || !event.isPrimary || event.button !== 0) return
    const button = event.target instanceof Element && event.target.closest<HTMLElement>('[data-view-tab]')
    if (!button || !track.contains(button)) return
    const current: Press = { id: event.pointerId, x: event.clientX, y: event.clientY,
      target: button.dataset.viewTab as CaptionView, held: false, cancelled: false, timer: 0, listeners: new AbortController() }
    press.current = current
    const options = { capture: true, signal: current.listeners.signal }
    window.addEventListener('pointermove', onMove, options)
    window.addEventListener('pointerup', onUp, options)
    window.addEventListener('pointercancel', (pointer) => { if (current.id === pointer.pointerId) clearPress() }, options)
    window.addEventListener('keydown', (key) => { if (key.key === 'Escape') clearPress() }, options)
    current.timer = window.setTimeout(() => {
      if (press.current !== current || current.cancelled) return
      current.held = true
      moveThumb(current.x)
    }, holdDelay)
    track.setPointerCapture(event.pointerId)
  }

  function onMove(event: globalThis.PointerEvent) {
    const current = press.current
    if (!current || current.id !== event.pointerId) return
    if (current.held) moveThumb(event.clientX)
    else if (Math.abs(event.clientX - current.x) > 8 || Math.abs(event.clientY - current.y) > 8) {
      current.cancelled = true
      window.clearTimeout(current.timer)
    }
  }

  function onUp(event: globalThis.PointerEvent) {
    const current = press.current
    if (!current || current.id !== event.pointerId) return
    const bounds = list.current?.getBoundingClientRect()
    const inside = bounds && event.clientX >= bounds.left && event.clientX <= bounds.right &&
      event.clientY >= bounds.top && event.clientY <= bounds.bottom
    let next = value
    if (inside && !current.cancelled) {
      if (current.held) {
        let distance = Infinity
        for (const [view] of views) {
          const item = tab(view)?.getBoundingClientRect()
          if (!item) continue
          const gap = Math.abs(event.clientX - (item.left + item.width / 2))
          if (gap < distance) { next = view; distance = gap }
        }
      } else next = current.target
    }
    // Focus before clearing the press so Radix focus activation cannot select the starting tab.
    tab(next)?.focus({ preventScroll: true })
    clearPress()
    if (inside && !current.cancelled) choose(next)
  }

  const thumb = drag ?? rest
  return <Tabs.Root className="caption-tabs" value={value} onValueChange={(next) => {
    if (!press.current) choose(next as CaptionView)
  }}>
    <Tabs.List ref={list} className="caption-tabs-list" aria-label="语音转录工作区"
      data-measured={Boolean(thumb)} data-animated={animated} data-dragging={Boolean(drag)} data-glow={animated && (Boolean(drag) || glow)}
      onPointerDown={onDown}
      onContextMenu={(event) => { if (press.current?.held) event.preventDefault() }}>
      {thumb && <span className="caption-tab-selection" aria-hidden="true"
        style={{ width: thumb.width, height: thumb.height, transform: 'translate(' + thumb.x + 'px,' + thumb.y + 'px)' }}>
        <span className="caption-tab-light" />
      </span>}
      {views.map(([id, label]) => <Tabs.Trigger key={id} value={id} data-view-tab={id} className="caption-tab">{label}</Tabs.Trigger>)}
    </Tabs.List>
    {children}
  </Tabs.Root>
}
