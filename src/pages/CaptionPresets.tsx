import { useEffect, useRef, useState } from 'react'
import { BookmarkPlus, Trash2 } from 'lucide-react'
import { Dialog } from 'radix-ui'
import type { CaptionOptions, CaptionPreset } from '../transcription'
import { useMotionEnabled } from '../ui/motion-policy'
import { Button } from '../ui/shadcn/button'
import { api, errorText } from '../workspace'
import { CaptionSelect, TextField } from './CaptionControls'

export function CaptionPresets({ options, onApply }: { options: CaptionOptions; onApply: (options: CaptionOptions) => void }) {
  const [presets, setPresets] = useState<CaptionPreset[]>([])
  const [selected, setSelected] = useState<{ preset: CaptionPreset; applied: CaptionOptions }>()
  const [dialog, setDialog] = useState<'save' | 'remove'>()
  const [name, setName] = useState('')
  const [duplicate, setDuplicate] = useState<CaptionPreset>()
  const [pending, setPending] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const saveTrigger = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef<HTMLButtonElement>(null)
  const animated = useMotionEnabled()
  const current = selected?.applied === options ? selected.preset : undefined

  useEffect(() => {
    let active = true
    void api.transcription.listPresets().then((items) => {
      if (active) { setPresets(items); setReady(true) }
    }).catch((reason) => { if (active) setError(errorText(reason)) })
    return () => { active = false }
  }, [])

  function apply(id: string) {
    const preset = presets.find((item) => item.id === id)
    if (!preset) { setSelected(undefined); return }
    const applied = { ...preset.options, output: options.output, style: { ...preset.options.style, fontFile: options.style.fontFile } }
    setSelected({ preset, applied })
    onApply(applied)
    setStatus('已应用「' + preset.name + '」')
  }

  function open(kind: 'save' | 'remove', trigger: HTMLButtonElement) {
    setError('')
    setStatus('')
    setDuplicate(undefined)
    setName(kind === 'save' ? current?.name ?? '' : '')
    restoreFocus.current = trigger
    setDialog(kind)
  }

  async function save(replaceId?: string) {
    setPending(true)
    setError('')
    try {
      const result = await api.transcription.savePreset(name, options, replaceId)
      if ('duplicate' in result) { setDuplicate(result.duplicate); return }
      setPresets(result.presets)
      setSelected({ preset: result.saved, applied: options })
      setStatus('已保存「' + result.saved.name + '」')
      setDialog(undefined)
    } catch (reason) { setError(errorText(reason)) } finally { setPending(false) }
  }

  async function remove() {
    if (!current) return
    setPending(true)
    setError('')
    try {
      setPresets(await api.transcription.removePreset(current.id))
      setSelected(undefined)
      setStatus('已删除「' + current.name + '」')
      setDialog(undefined)
    } catch (reason) { setError(errorText(reason)) } finally { setPending(false) }
  }

  return <div className="caption-presets">
    <CaptionSelect label="选用预设" value={current?.id ?? ''} onChange={apply} disabled={!ready || !presets.length}
      choices={([['', '当前设置']] as [string, string][]).concat(presets.map(({ id, name }) => [id, name]))} />
    <Button ref={saveTrigger} type="button" variant="outline" size="sm" disabled={!ready}
      onClick={(event) => open('save', event.currentTarget)}><BookmarkPlus />保存为预设</Button>
    {current && <Button type="button" variant="ghost" size="icon-sm" aria-label="删除选中预设" title="删除选中预设"
      onClick={(event) => open('remove', event.currentTarget)}><Trash2 /></Button>}
    {!dialog && error && <p className="caption-preset-note text-destructive" role="alert">{error}</p>}
    {status && <p className="caption-preset-note caption-muted" role="status">{status}</p>}
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !pending) setDialog(undefined) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="qr-overlay" data-reduced={!animated} />
        <Dialog.Content className="qr-dialog" data-reduced={!animated} onCloseAutoFocus={(event) => {
          event.preventDefault()
          const trigger = restoreFocus.current?.isConnected ? restoreFocus.current : saveTrigger.current
          trigger?.focus()
        }}>
          <Dialog.Title className="font-semibold">{dialog === 'remove' ? '删除操作预设？' : '保存操作预设'}</Dialog.Title>
          <Dialog.Description className="caption-muted">{dialog === 'remove'
            ? '删除「' + current?.name + '」后，表单会保留当前设置'
            : '为当前处理和输出设置命名'}</Dialog.Description>
          <form className="caption-stack" onSubmit={(event) => {
            event.preventDefault()
            if (!pending) void (dialog === 'remove' ? remove() : save(duplicate?.id))
          }}>
            {dialog === 'save' && <TextField label="预设名称" value={name} maxLength={64} required disabled={pending}
              onChange={(event) => { setName(event.currentTarget.value); setDuplicate(undefined); setError('') }} />}
            {duplicate && <p className="caption-muted" role="status">已有同名预设，可修改名称或确认覆盖「{duplicate.name}」</p>}
            {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
            <div className="caption-actions justify-end">
              <Dialog.Close asChild><Button type="button" variant="outline" disabled={pending}>取消</Button></Dialog.Close>
              <Button type="submit" variant={dialog === 'remove' ? 'destructive' : 'default'}
                disabled={pending || dialog === 'save' && !name.trim()}>
                {dialog === 'remove' ? '确认删除' : duplicate ? '确认覆盖' : '保存预设'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>
}
