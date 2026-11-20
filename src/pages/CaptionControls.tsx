import type { ComponentProps, ReactNode } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '../ui/shadcn/button'
import { Input } from '../ui/shadcn/input'
import type { CaptionFormat, CaptionLayout } from '../transcription'

export const captionFormats = ['srt', 'ass', 'vtt', 'txt', 'json'] as const
export const layouts: Record<CaptionLayout, string> = {
  'source-first': '原文在上', 'translation-first': '译文在上', source: '仅原文', translation: '仅译文',
}
export const engineNames = {
  bijian: '必剪 · 免 Key', jianying: '剪映 · 免 Key', 'whisper-api': 'Whisper API',
  'whisper-cpp': 'whisper.cpp · 本地', 'faster-whisper': 'Faster Whisper · 本地',
} as const

export const targetLanguages: Array<[string, string]> = [
  ['zh-Hans', '简体中文'], ['zh-Hant', '繁體中文'], ['en', '英语'], ['ja', '日语'], ['ko', '韩语'], ['fr', '法语'],
  ['de', '德语'], ['es', '西班牙语'], ['pt', '葡萄牙语'], ['ru', '俄语'], ['ar', '阿拉伯语'],
  ['hi', '印地语'], ['th', '泰语'], ['vi', '越南语'], ['id', '印度尼西亚语'], ['it', '意大利语'], ['nl', '荷兰语'],
]

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="caption-field"><span>{label}</span>{children}</label>
}

export function CaptionSelect<T extends string>({ label, value, onChange, choices, disabled = false }: {
  label: string; value: T; onChange: (value: T) => void; choices: ReadonlyArray<readonly [T, string]>; disabled?: boolean
}) {
  return <Field label={label}><select value={value} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value as T)}>
    {choices.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
  </select></Field>
}

export function TextField({ label, ...props }: ComponentProps<typeof Input> & { label: string }) {
  return <Field label={label}><Input {...props} /></Field>
}

export function NumberField({ label, value, onChange, min, max, step = 1 }: {
  label: string; value: number; onChange: (value: number) => void; min: number; max: number; step?: number
}) {
  return <TextField label={label} type="number" value={value} min={min} max={max} step={step}
    onChange={(event) => {
      const next = event.currentTarget.valueAsNumber
      if (Number.isFinite(next)) onChange(next)
    }} />
}

export function CaptionToggle({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean
}) {
  return <label className="caption-check"><input type="checkbox" checked={checked} disabled={disabled}
    onChange={(event) => onChange(event.currentTarget.checked)} /><span>{label}</span></label>
}

export function FormatChecks({ formats, onChange }: { formats: CaptionFormat[]; onChange: (value: CaptionFormat[]) => void }) {
  return <fieldset className="caption-format"><legend>字幕格式</legend><div className="caption-actions">
    {captionFormats.map((format) => <CaptionToggle key={format} label={format.toUpperCase()} checked={formats.includes(format)}
      onChange={(checked) => {
        const next = checked ? [...formats, format] : formats.filter((item) => item !== format)
        if (next.length) onChange(next)
      }} />)}
  </div></fieldset>
}

export function LayoutSelect({ value, onChange }: { value: CaptionLayout; onChange: (value: CaptionLayout) => void }) {
  return <CaptionSelect label="字幕布局" value={value} onChange={onChange} choices={Object.entries(layouts) as Array<[CaptionLayout, string]>} />
}

export function PathField({ label, value, onChoose, onClear }: { label: string; value: string; onChoose: () => void; onClear?: () => void }) {
  return <div className="caption-field"><span>{label}</span><div className="caption-path">
    <Button type="button" variant="outline" className="min-w-0 justify-start" onClick={onChoose} title={value || label}>
      <FolderOpen /><span className="truncate">{value || '选择'}</span>
    </Button>
    {value && onClear && <Button type="button" variant="ghost" size="sm" onClick={onClear}>清除</Button>}
  </div></div>
}

export function timeLabel(value: number) {
  const pad = (number: number, size = 2) => String(Math.floor(number)).padStart(size, '0')
  return [pad(value / 3600000), pad(value / 60000 % 60), pad(value / 1000 % 60)].join(':') + '.' + pad(value % 1000, 3)
}

export function parseTime(value: string) {
  const parts = /^(\d+):([0-5]\d):([0-5]\d)[.，,](\d{1,3})$/.exec(value.trim())
  return parts ? ((+parts[1] * 60 + +parts[2]) * 60 + +parts[3]) * 1000 + +parts[4].padEnd(3, '0') : NaN
}
