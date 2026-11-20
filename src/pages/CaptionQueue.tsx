import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Play, Square, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import type { CaptionStage, CaptionTask } from '../transcription'
import { useMotionEnabled } from '../ui/motion-policy'
import { Button } from '../ui/shadcn/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/shadcn/card'
import { Progress } from '../ui/shadcn/progress'

export const captionStateNames: Record<CaptionTask['state'], string> = {
  queued: '排队中', running: '处理中', review: '待校对', done: '已完成', warning: '待复核', failed: '失败', cancelled: '已取消',
}
export const captionWorking = (task?: CaptionTask) => task?.state === 'queued' || task?.state === 'running'
const canRemove = (task: CaptionTask) => !captionWorking(task) && task.state !== 'review'

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

export function CaptionQueue({ tasks, selected, dirty, busy, active, progress, total, ended, completed, submitting,
  onSelect, onRemove, onCancelAll, onReview, onSynthesis, start, children }: {
  tasks: CaptionTask[]; selected?: CaptionTask; dirty: boolean; busy: boolean; active: boolean; progress?: CaptionTask
  total: number; ended: number; completed: boolean; submitting: boolean
  onSelect: (id: string) => void; onRemove: (id: string) => void; onCancelAll: () => void
  onReview: () => void; onSynthesis: () => void; start: React.ReactNode; children?: React.ReactNode
}) {
  return <Card className="caption-queue-dock" aria-label="任务队列">
    <CardHeader className="caption-queue-header">
      <CardTitle><Play />任务队列 <span className="caption-queue-count">{tasks.length}</span></CardTitle>
      <div className="caption-actions">
        {selected && <>
          {children}
          <Button size="sm" variant="ghost" disabled={!selected.cues.length} onClick={onReview}>打开校对</Button>
          <Button size="sm" variant="ghost" disabled={!selected.media?.video || !selected.cues.length} onClick={onSynthesis}>打开合成</Button>
        </>}
        {busy && <Button size="sm" variant="outline" onClick={onCancelAll}><Square />取消全部</Button>}
        {start}
      </div>
    </CardHeader>
    <CardContent className="caption-stack">
      {tasks.length ? <ul className="caption-queue">
        {tasks.map((item) => <li key={item.id}>
          <button type="button" className="caption-queue-select" disabled={dirty && item.id !== selected?.id}
            onClick={() => onSelect(item.id)} aria-pressed={selected?.id === item.id}>
            <span><strong title={item.name}>{item.name}</strong><small title={item.message}>{captionStateNames[item.state]}{captionWorking(item) ? ' · ' + item.message : ''}</small></span>
            <ChevronRight size={16} />
          </button>
          {canRemove(item) && <Button size="icon-sm" variant="ghost" disabled={dirty && item.id === selected?.id}
            aria-label={'移除任务 ' + item.name} title="移除任务记录" onClick={() => onRemove(item.id)}><Trash2 /></Button>}
        </li>)}
      </ul> : <p className="caption-muted">导入素材并开始处理后，任务会显示在这里。</p>}
      {(total > 0 || progress || submitting) && <QueueProgress task={progress} total={total} ended={ended} completed={completed} active={active} submitting={submitting} />}
    </CardContent>
  </Card>
}
