import { useRef, useState } from 'react'
import type { ComponentProps, MouseEvent, PointerEvent } from 'react'
import { motion } from 'motion/react'
import { cn } from './class-names'
import { useMotionEnabled } from './motion-policy'
import { Button } from './shadcn/button'

type Ripple = { x: number; y: number; size: number; id: number }
type ActionProps = Omit<ComponentProps<typeof Button>, 'asChild'> & { shimmer?: 'hover' | 'ready' }

export function ActionButton({ shimmer, className, children, onPointerDown, onClick, ...props }: ActionProps) {
  const enabled = useMotionEnabled()
  const [ripple, setRipple] = useState<Ripple>()
  const sequence = useRef(0)

  // Adapted from Magic UI Ripple Button. Bound to one effect during rapid presses.
  function pulse(event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>, centered: boolean) {
    if (!enabled || props.disabled || event.defaultPrevented) return
    const rect = event.currentTarget.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height)
    const x = (centered ? rect.width / 2 : event.clientX - rect.left) - size / 2
    const y = (centered ? rect.height / 2 : event.clientY - rect.top) - size / 2
    setRipple({ x, y, size, id: ++sequence.current })
  }

  return (
    <Button {...props} className={cn('action-button', className)}
      data-shimmer={enabled && !props.disabled ? shimmer : undefined}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        if (event.button === 0) pulse(event, false)
      }}
      onClick={(event) => {
        if (event.detail === 0) pulse(event, true)
        onClick?.(event)
      }}>
      {enabled && shimmer && !props.disabled && (
        <span className="shimmer-outline" aria-hidden="true"><span className="shimmer-spark" /></span>
      )}
      {enabled && ripple && (
        <motion.span key={ripple.id} aria-hidden="true" className="button-ripple"
          style={{ left: ripple.x, top: ripple.y, width: ripple.size, height: ripple.size }}
          initial={{ scale: 0, opacity: 0.23 }} animate={{ scale: 2, opacity: 0 }}
          transition={{ duration: 0.32, ease: 'easeOut' }}
          onAnimationComplete={() => setRipple((current) => current?.id === ripple.id ? undefined : current)} />
      )}
      {children}
    </Button>
  )
}
