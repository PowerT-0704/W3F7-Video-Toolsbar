import { useEffect, useRef, useState } from 'react'
import type { FocusEvent, PointerEvent } from 'react'
import { useIsMobile } from './shadcn/use-mobile'

export function useHoverSidebar() {
  const mobile = useIsMobile()
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const pointerInside = useRef(false)
  const timer = useRef<number>(undefined)

  useEffect(() => {
    function resetHover() {
      window.clearTimeout(timer.current)
      pointerInside.current = false
      setHovered(false)
    }
    resetHover()
    window.addEventListener('blur', resetHover)
    return () => {
      window.removeEventListener('blur', resetHover)
      window.clearTimeout(timer.current)
    }
  }, [mobile])

  function enter(event: PointerEvent<HTMLDivElement>) {
    if (mobile || event.pointerType !== 'mouse' || event.buttons) return
    pointerInside.current = true
    window.clearTimeout(timer.current)
    if (!pinned && !hovered) timer.current = window.setTimeout(() => setHovered(true), 120)
  }

  function collapseLater() {
    window.clearTimeout(timer.current)
    if (pinned || !hovered) return
    timer.current = window.setTimeout(() => {
      if (!pointerInside.current && !panel.current?.querySelector(':focus-visible')) setHovered(false)
    }, 180)
  }

  function leave(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse') return
    pointerInside.current = false
    collapseLater()
  }

  function blur(event: FocusEvent<HTMLDivElement>) {
    if (!pointerInside.current && !event.currentTarget.contains(event.relatedTarget)) collapseLater()
  }

  function togglePin() {
    window.clearTimeout(timer.current)
    setHovered(false)
    // Clicking the trigger while a hover panel is open pins it in place.
    setPinned((value) => !value)
  }

  return { mobile, open: pinned || hovered, pinned, togglePin, panel, enter, leave, blur }
}
