import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Tabs } from 'radix-ui'

const views = [['jobs', '任务设置'], ['polish', '字幕优化与翻译'], ['synthesis', '字幕视频合成']] as const
export type CaptionView = typeof views[number][0]

interface TabBox { x: number; y: number; width: number; height: number }
interface Sweep { id: number; direction: 'left' | 'right' }

export function CaptionTabs({ value, onChange, active, animated, children }: {
  value: CaptionView; onChange: (value: CaptionView) => void; active: boolean; animated: boolean; children: ReactNode
}) {
  const list = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<TabBox>()
  const [sweeps, setSweeps] = useState<Sweep[]>([])
  const previousView = useRef(value)
  const sweepId = useRef(0)

  useLayoutEffect(() => {
    const track = list.current
    if (!active || !track) return
    const button = track.querySelector<HTMLElement>(`[data-view-tab="${value}"]`)
    if (!button) return
    const measure = () => setThumb({ x: button.offsetLeft, y: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    for (const trigger of track.querySelectorAll('[data-view-tab]')) observer.observe(trigger)
    return () => observer.disconnect()
  }, [active, value])

  useLayoutEffect(() => {
    const previous = previousView.current
    previousView.current = value
    if (!active || !animated) {
      setSweeps((current) => current.length ? [] : current)
      return
    }
    if (previous === value) return
    const forward = views.findIndex(([view]) => view === value) > views.findIndex(([view]) => view === previous)
    const sweep: Sweep = { id: sweepId.current++, direction: forward ? 'right' : 'left' }
    setSweeps((current) => [...current, sweep])
  }, [active, animated, value])

  return <Tabs.Root className="caption-tabs" value={value} onValueChange={(next) => onChange(next as CaptionView)}>
    <Tabs.List ref={list} className="caption-tabs-list" aria-label="语音转录工作区"
      data-measured={Boolean(thumb)} data-animated={animated}>
      {thumb && <span className="caption-tab-selection" aria-hidden="true"
        style={{ width: thumb.width, height: thumb.height, top: thumb.y, transform: 'translateX(' + thumb.x + 'px)' }}>
        {sweeps.map(({ id, direction }) => <span key={id} className="caption-tab-light" data-direction={direction}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) setSweeps((current) => current.filter((sweep) => sweep.id !== id))
          }}>
          <span className="caption-tab-light-edge"><span className="caption-tab-light-band" /></span>
        </span>)}
      </span>}
      {views.map(([id, label]) => <Tabs.Trigger key={id} value={id} data-view-tab={id} className="caption-tab"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          if (event.ctrlKey) return
          event.currentTarget.focus({ preventScroll: true })
          onChange(id)
        }}>{label}</Tabs.Trigger>)}
    </Tabs.List>
    {children}
  </Tabs.Root>
}
