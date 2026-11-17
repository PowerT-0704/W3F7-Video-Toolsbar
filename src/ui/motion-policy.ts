import { createContext, useContext, useSyncExternalStore } from 'react'

export const MotionEnabledContext = createContext(false)
const systemMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

function subscribeToSystemMotion(onChange: () => void) {
  systemMotion.addEventListener('change', onChange)
  return () => systemMotion.removeEventListener('change', onChange)
}

export function useMotionEnabled() {
  return useContext(MotionEnabledContext)
}

export function useSystemReducedMotion() {
  return useSyncExternalStore(subscribeToSystemMotion, () => systemMotion.matches)
}
