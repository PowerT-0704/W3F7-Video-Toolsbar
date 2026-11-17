import type { PointerEvent } from 'react'

export function positionSpotlight(event: PointerEvent<HTMLElement>) {
  const element = event.currentTarget
  const bounds = element.getBoundingClientRect()
  element.style.setProperty('--spot-x', (event.clientX - bounds.left) + 'px')
  element.style.setProperty('--spot-y', (event.clientY - bounds.top) + 'px')
}
