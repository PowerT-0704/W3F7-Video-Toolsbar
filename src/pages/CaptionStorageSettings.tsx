import { useEffect, useState } from 'react'
import { AlertDialog } from 'radix-ui'
import { AlertCircle, FolderOpen, HardDrive, Trash2 } from 'lucide-react'
import type { CaptionCacheStatus } from '../transcription'
import { api, errorText } from '../workspace'
import { useMotionEnabled } from '../ui/motion-policy'
import { Alert, AlertDescription } from '../ui/shadcn/alert'
import { Button } from '../ui/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/shadcn/card'

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1048576).toFixed(1)} MiB`
}

export function CaptionStorageSettings() {
  const captions = api.transcription
  const animated = useMotionEnabled()
  const [status, setStatus] = useState<CaptionCacheStatus>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let open = true
    void captions.cacheStatus().then((result) => { if (open) setStatus(result) })
      .catch((reason) => { if (open) setError(errorText(reason)) })
    return () => { open = false }
  }, [captions])

  async function run(action: () => Promise<string>) {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      setMessage(await action())
      setStatus(await captions.cacheStatus())
    } catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false) }
  }

  const disabled = busy || !status
  return <Card aria-busy={busy}>
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><HardDrive className="text-muted-foreground size-4" />转录缓存</CardTitle>
      <CardDescription>管理音频分块、识别缓存和兼容预览。微软翻译只提交字幕文本。</CardDescription>
    </CardHeader>
    <CardContent className="grid gap-3.5">
      <div className="cache-location grid min-w-0 gap-1.5">
        <span className="text-sm font-medium">当前转录缓存位置</span>
        <span className="text-muted-foreground break-all text-sm" title={status?.directory}>{status?.directory ?? '正在读取缓存位置…'}</span>
        {status && <span className="text-muted-foreground text-xs tabular-nums">已占用 {size(status.bytes)} · 使用中 {size(status.activeBytes)}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={disabled} onClick={() => void run(async () =>
          await captions.chooseCache() ? '新任务将使用所选位置。' : '')}>更改转录缓存位置</Button>
        <Button variant="outline" disabled={disabled} onClick={() => void run(async () => { await captions.openCache(); return '' })}>
          <FolderOpen />打开目录</Button>
        {status?.custom && <Button variant="ghost" disabled={disabled} onClick={() => void run(async () => {
          await captions.resetCache(); return '已恢复默认转录缓存位置。'
        })}>恢复默认</Button>}
        <AlertDialog.Root>
          <AlertDialog.Trigger asChild><Button variant="ghost" disabled={disabled}><Trash2 />清理闲置缓存</Button></AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="qr-overlay" data-reduced={!animated} />
            <AlertDialog.Content className="qr-dialog" data-reduced={!animated}>
              <AlertDialog.Title className="font-semibold">清理闲置的转录缓存？</AlertDialog.Title>
              <AlertDialog.Description className="text-muted-foreground text-sm">会清理当前和旧位置的闲置转录缓存。正在使用的预览和磁盘成品会保留。</AlertDialog.Description>
              <div className="flex justify-end gap-2">
                <AlertDialog.Cancel asChild><Button variant="outline">取消</Button></AlertDialog.Cancel>
                <AlertDialog.Action asChild><Button variant="destructive" onClick={() => void run(async () => {
                  const result = await captions.clearCache()
                  return `已释放 ${size(result.released)}。${result.incomplete ? '部分缓存目录或文件暂不可清理。' : ''}`
                })}>确认清理</Button></AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
      {status?.warning && <Alert><AlertCircle /><AlertDescription>{status.warning}</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert>}
      <div role="status" className="text-muted-foreground text-sm empty:hidden">{busy ? '正在处理转录缓存…' : message}</div>
    </CardContent>
  </Card>
}
