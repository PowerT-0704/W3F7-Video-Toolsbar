import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { useMotionEnabled } from './motion-policy'

// Page and item entrances adapted from Magic UI Blur Fade.
const variants = {
  hidden: { opacity: 0, y: 7, filter: 'blur(3px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
}

export function BlurFade({ children, active = true, delay = 0, className }: {
  children: ReactNode; active?: boolean; delay?: number; className?: string
}) {
  const enabled = useMotionEnabled()
  return (
    <motion.div className={className} hidden={!active} variants={variants}
      initial={enabled ? 'hidden' : false}
      animate={!active ? 'hidden' : 'visible'}
      transition={{ duration: enabled && active ? 0.25 : 0, delay: enabled && active ? delay : 0, ease: 'easeOut' }}
      data-entrance={enabled && active ? 'blur-fade' : undefined}>
      {children}
    </motion.div>
  )
}
