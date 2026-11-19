import { useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import { RotateCcw } from 'lucide-react'
import type { MusicImage, SquareCrop } from '../bridge'
import { useMotionEnabled } from '../ui/motion-policy'
import { Button } from '../ui/shadcn/button'

export function MusicCropDialog({ image, busy, error, onCancel, onConfirm }: {
  image: MusicImage; busy: boolean; error: string; onCancel: () => void; onConfirm: (crop: SquareCrop) => void
}) {
  const maximum = Math.min(image.width, image.height)
  function fit(x: number, y: number, size: number) {
    return { x: Math.max(0, Math.min(image.width - size, Math.round(x))),
      y: Math.max(0, Math.min(image.height - size, Math.round(y))), size }
  }
  function centered() { return fit((image.width - maximum) / 2, (image.height - maximum) / 2, maximum) }
  const [crop, setCrop] = useState(centered)
  const surface = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; startX: number; startY: number; x: number; y: number; scaleX: number; scaleY: number }>(undefined)
  const animated = useMotionEnabled()

  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onCancel() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="qr-overlay" data-reduced={!animated} />
      <Dialog.Content className="qr-dialog music-crop-dialog" data-reduced={!animated} aria-busy={busy}
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }}
        onPointerDownOutside={(event) => { if (busy) event.preventDefault() }}>
        <Dialog.Title className="font-semibold">裁剪正面封面</Dialog.Title>
        <Dialog.Description className="text-muted-foreground text-sm">拖动选框或使用方向键移动，选择要保留的正方形区域。</Dialog.Description>
        <div ref={surface} className="music-crop-surface"
          style={{ aspectRatio: image.width / image.height, width: 'min(100%, 36rem, ' + (46 * image.width / image.height) + 'dvh)' }}>
          <img src={image.preview} alt={image.name} draggable={false} />
          <div className="music-crop-square" role="group" tabIndex={0} aria-label="正方形裁剪选区"
            style={{ left: crop.x / image.width * 100 + '%', top: crop.y / image.height * 100 + '%',
              width: crop.size / image.width * 100 + '%', height: crop.size / image.height * 100 + '%' }}
            onPointerDown={(event) => {
              if (busy || event.button !== 0 || !surface.current) return
              const rect = surface.current.getBoundingClientRect()
              event.currentTarget.setPointerCapture(event.pointerId)
              drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: crop.x, y: crop.y,
                scaleX: image.width / rect.width, scaleY: image.height / rect.height }
            }}
            onPointerMove={(event) => {
              const start = drag.current
              if (busy || !start || event.pointerId !== start.id) return
              setCrop(fit(start.x + (event.clientX - start.startX) * start.scaleX,
                start.y + (event.clientY - start.startY) * start.scaleY, crop.size))
            }}
            onLostPointerCapture={() => { drag.current = undefined }}
            onKeyDown={(event) => {
              if (busy || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
              event.preventDefault()
              const step = event.shiftKey ? Math.max(1, Math.round(maximum / 50)) : 1
              const x = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
              const y = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
              setCrop(fit(crop.x + x, crop.y + y, crop.size))
            }} />
        </div>
        <label className="music-crop-size">
          <span>选区大小</span>
          <input type="range" min={1} max={maximum} value={crop.size} disabled={busy || maximum === 1}
            onChange={(event) => {
              const size = Number(event.currentTarget.value)
              const offset = (crop.size - size) / 2
              setCrop(fit(crop.x + offset, crop.y + offset, size))
            }} />
          <span className="text-muted-foreground text-xs tabular-nums">{crop.size} × {crop.size}</span>
        </label>
        {error && <p role="alert" className="text-destructive text-sm break-words">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setCrop(centered())}><RotateCcw />重置</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>取消</Button>
          <Button size="sm" disabled={busy} onClick={() => onConfirm(crop)}>{busy ? '正在处理' : '使用此封面'}</Button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
