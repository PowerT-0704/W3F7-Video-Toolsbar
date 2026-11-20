import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Play, Square, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { AlertDialog } from 'radix-ui'
import type { CaptionStage, CaptionTask } from '../transcription'
import { useMotionEnabled } from '../ui/motion-policy'
import { Button } from '../ui/shadcn/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/shadcn/card'
import { Progress } from '../ui/shadcn/progress'
import { interfaceCopy } from '../workspace'

export const captionStateNames: Record<CaptionTask['state'], string> = {
  queued: '排队中', running: '处理中', review: '待校对', done: '已完成', warning: '待复核', failed: '失败', cancelled: '已取消',
}
export const captionWorking = (task?: CaptionTask) => task?.state === 'queued' || task?.state === 'running'

const stages: Record<CaptionStage, string> = {
  prepare: '准备素材', recognize: '识别语音', split: '字幕断句', correct: '校正字幕', translate: '翻译字幕',
  export: '导出字幕', synthesize: '合成视频',
}

type Particle = { x: number; y: number; delay: number; size: number }

function QueueProgress({ task, total, ended, completed, active, submitting }: {
  task?: CaptionTask; total: number; ended: number; completed: boolean; active: boolean; submitting: boolean
}) {
  const enabled = useMotionEnabled() && active
  const value = completed ? 100 : task?.progress ?? null
  const identity = task?.id + ':' + task?.stage
  const previous = useRef({ identity, value, completed })
  const [burst, setBurst] = useState<{ serial: number; left: number; particles: Particle[] }>()
  const serial = useRef(0)

  useEffect(() => {
    const before = previous.current
    previous.current = { identity, value, completed }
    const advanced = value !== null && value > (before.value ?? 0) && identity === before.identity
    if (!enabled || value === null || (!advanced && !(completed && !before.completed))) return
    setBurst({ serial: ++serial.current, left: value, particles: Array.from({ length: completed ? 14 : 8 }, () => ({
      x: Math.random() * 55 - 32, y: Math.random() * -24 - 5, delay: Math.random() * .15, size: 2 + Math.random() * 3,
    })) })
  }, [identity, value, completed, enabled])
  useEffect(() => {
    if (!burst) return
    const timer = window.setTimeout(() => setBurst(undefined), 640)
    return () => window.clearTimeout(timer)
  }, [burst])

  const running = task?.state === 'running'
  const stage = running && task?.stage ? stages[task.stage] : undefined
  const showingTrack = running || completed || task?.state === 'queued' || submitting
  return <div className="caption-queue-progress" data-animated={enabled} data-running={running}>
    <div className="caption-progress-info" role="status">
      <span className="min-w-0 truncate" title={task?.name}>{completed ? '本批处理完成' : task ? `${task.name} · ${stage ?? captionStateNames[task.state]}` : submitting ? '正在添加任务' : '本批处理结束'}</span>
      <span className="tabular-nums shrink-0">{total > 0 ? `${ended} / ${total} 项` : ''}{value !== null ? ` · ${value}%` : running ? ' · 进行中' : ''}</span>
    </div>
    {showingTrack && <div className="caption-progress-track" data-indeterminate={value === null}>
      <Progress value={value} aria-label="当前任务阶段进度" />
      {enabled && running && <div className="caption-progress-shine" aria-hidden="true" style={{ width: value === null ? '100%' : `${value}%` }}>
        <motion.span initial={{ x: '-100%' }} animate={{ x: '350%' }} transition={{ duration: 1.25, ease: 'linear', repeat: Infinity }} />
      </div>}
      {enabled && burst && <div key={burst.serial} className="caption-particle-source" aria-hidden="true" style={{ left: `${burst.left}%` }}>
        {burst.particles.map((particle, index) => <motion.i key={index} style={{ width: particle.size, height: particle.size }}
          initial={{ x: 0, y: 0, opacity: .9, scale: 1 }} animate={{ x: particle.x, y: particle.y, opacity: 0, scale: .28 }}
          transition={{ duration: .45, delay: particle.delay, ease: 'easeOut' }} />)}
      </div>}
    </div>}
  </div>
}

export function CaptionQueue({ tasks, selected, dirty, busy, active, progress, total, ended, completed, submitting, removing,
  onSelect, onRemove, onCancelAll, onReview, onSynthesis, children }: {
  tasks: CaptionTask[]; selected?: CaptionTask; dirty: boolean; busy: boolean; active: boolean; progress?: CaptionTask
  total: number; ended: number; completed: boolean; submitting: boolean; removing: boolean
  onSelect: (id: string) => void; onRemove: (ids: string[], clear: boolean) => void; onCancelAll: () => void
  onReview: () => void; onSynthesis: () => void; children?: React.ReactNode
}) {
  const [confirmation, setConfirmation] = useState<{ ids: string[]; clear: boolean; name?: string; stopping: number; losesDraft: boolean }>()
  const [dialogOpen, setDialogOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const queue = useRef<HTMLDivElement>(null)
  const animated = useMotionEnabled()
  function confirm(button: HTMLButtonElement, id?: string) {
    const targets = id ? tasks.filter((item) => item.id === id) : tasks
    if (!targets.length) return
    opener.current = button
    setConfirmation({
      ids: targets.map((item) => item.id), clear: !id, name: targets[0]?.name,
      stopping: targets.filter(captionWorking).length,
      losesDraft: dirty && targets.some((item) => item.id === selected?.id),
    })
    setDialogOpen(true)
  }

  return <Card ref={queue} tabIndex={-1} className="caption-queue-card" aria-label="任务队列">
    <CardHeader className="caption-queue-header">
      <div className="caption-queue-heading">
        <CardTitle><Play />任务队列 <span className="caption-queue-count">{tasks.length}</span></CardTitle>
        <Button size="sm" variant="ghost" disabled={removing || submitting || !tasks.length}
          onClick={(event) => confirm(event.currentTarget)}><Trash2 />清空列表</Button>
      </div>
      {(selected || busy) && <div className="caption-actions">
        {selected && <>
          {children}
          <Button size="sm" variant="ghost" disabled={removing || !selected.cues.length} onClick={onReview}>打开校对</Button>
          <Button size="sm" variant="ghost" disabled={removing || !selected.media?.video || !selected.cues.length} onClick={onSynthesis}>打开合成</Button>
        </>}
        {busy && <Button size="sm" variant="outline" disabled={removing} onClick={onCancelAll}><Square />取消全部</Button>}
      </div>}
    </CardHeader>
    <CardContent className="caption-stack">
      {tasks.length ? <ul className="caption-queue">
        {tasks.map((item) => <li key={item.id}>
          <button type="button" className="caption-queue-select" disabled={removing || dirty && item.id !== selected?.id}
            onClick={() => onSelect(item.id)} aria-pressed={selected?.id === item.id}>
            <span><strong title={item.name}>{item.name}</strong><small title={interfaceCopy(item.message)}>{captionStateNames[item.state]}{captionWorking(item) ? ' · ' + interfaceCopy(item.message) : ''}</small></span>
            <ChevronRight size={16} />
          </button>
          <Button size="icon-sm" variant="ghost" disabled={removing || submitting}
            aria-label={'删除任务 ' + item.name} title="删除任务记录" onClick={(event) => confirm(event.currentTarget, item.id)}><Trash2 /></Button>
        </li>)}
      </ul> : <p className="caption-muted">导入素材并开始处理后，任务会显示在这里</p>}
      {removing && <p className="caption-muted" role="status">正在删除任务…</p>}
      {(total > 0 || progress || submitting) && <QueueProgress task={progress} total={total} ended={ended} completed={completed} active={active} submitting={submitting} />}
    </CardContent>
    <AlertDialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="qr-overlay" data-reduced={!animated} />
        <AlertDialog.Content className="qr-dialog" data-reduced={!animated} onCloseAutoFocus={(event) => {
          event.preventDefault()
          const button = opener.current
          const focusTarget = button?.isConnected && !button.disabled ? button : queue.current
          focusTarget?.focus({ preventScroll: true })
        }}>
          <AlertDialog.Title className="font-semibold">{confirmation?.clear ? '清空任务列表？' : '删除任务？'}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="grid gap-2 text-muted-foreground text-sm break-words">
              <p>{confirmation?.clear ? `将删除列表中的 ${confirmation.ids.length} 项任务记录` : confirmation?.name}</p>
              {!!confirmation?.stopping && <p>{confirmation.stopping} 项运行中或排队任务会先停止，再移出列表</p>}
              {confirmation?.losesDraft && <p className="text-destructive">未保存的校对草稿将丢失</p>}
              <p>源文件和已导出的成品会保留</p>
            </div>
          </AlertDialog.Description>
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel asChild><Button variant="outline">取消</Button></AlertDialog.Cancel>
            <AlertDialog.Action asChild><Button variant="destructive" disabled={removing || submitting || !confirmation}
              onClick={() => {
                if (!confirmation) return
                opener.current = null
                onRemove(confirmation.ids, confirmation.clear)
              }}>{confirmation?.clear ? '确认清空' : '确认删除'}</Button></AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  </Card>
}
