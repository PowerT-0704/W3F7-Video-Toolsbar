import { useEffect, useState } from 'react'
import { AlertDialog } from 'radix-ui'
import { AlertCircle, FolderOpen, HardDrive, Trash2 } from 'lucide-react'
import type { MediaCacheMove, MediaCacheStatus, Preferences } from '../bridge'
import { api, errorText, interfaceCopy } from '../workspace'
import { useMotionEnabled } from '../ui/motion-policy'
import { Alert, AlertDescription } from '../ui/shadcn/alert'
import { Button } from '../ui/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/shadcn/card'

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1048576).toFixed(1)} MiB`
}

export function StorageSettings({ directory, onPreferences }: {
  directory: string; onPreferences: (preferences: Preferences) => void
}) {
  const [status, setStatus] = useState<MediaCacheStatus>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const animated = useMotionEnabled()

  useEffect(() => {
    let mounted = true
    void api.cacheStatus().then((result) => { if (mounted) setStatus(result) })
      .catch((reason) => { if (mounted) setError(errorText(reason)) })
    return () => { mounted = false }
  }, [])

  async function run(action: () => Promise<string>) {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      setMessage(await action())
      setStatus(await api.cacheStatus())
    } catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false) }
  }

  function move(action: () => Promise<MediaCacheMove | null>) {
    return run(async () => {
      const result = await action()
      if (!result) return ''
      onPreferences(result.preferences)
      return `已更新缓存位置，迁移 ${size(result.moved)}${result.incomplete ? ' · 旧位置有个别副本未能删除' : ''}`
    })
  }

  return (
    <Card aria-busy={busy}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><HardDrive className="text-muted-foreground size-4" />存储与缓存</CardTitle>
        <CardDescription>管理抽帧图片和从视频生成的临时封面</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3.5">
        <div className="cache-location grid min-w-0 gap-1.5">
          <span className="text-sm font-medium">当前缓存位置</span>
          <span className="text-muted-foreground break-all text-sm" title={status?.directory}>{status?.directory ?? '正在读取缓存位置…'}</span>
          {status && <span className="text-muted-foreground text-xs tabular-nums">已占用 {size(status.bytes)} · 使用中 {size(status.activeBytes)}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy || !status} onClick={() => void move(api.chooseCacheDirectory)}>更改位置</Button>
          <Button variant="outline" disabled={busy || !status} onClick={() => void run(async () => { await api.openCacheDirectory(); return '' })}><FolderOpen />打开目录</Button>
          {directory && <Button variant="ghost" aria-label="恢复默认缓存位置" disabled={busy || !status} onClick={() => void move(api.resetCacheDirectory)}>恢复默认</Button>}
          <AlertDialog.Root>
            <AlertDialog.Trigger asChild><Button variant="ghost" disabled={busy || !status}><Trash2 />清理缓存</Button></AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="qr-overlay" data-reduced={!animated} />
              <AlertDialog.Content className="qr-dialog" data-reduced={!animated}>
                <AlertDialog.Title className="font-semibold">清理媒体缓存？</AlertDialog.Title>
                <AlertDialog.Description className="text-muted-foreground text-sm">将清理闲置的抽帧图片与临时封面。正在显示的帧、选中的封面和已导出的文件会保留</AlertDialog.Description>
                <div className="flex justify-end gap-2">
                  <AlertDialog.Cancel asChild><Button variant="outline">取消</Button></AlertDialog.Cancel>
                  <AlertDialog.Action asChild><Button variant="destructive" onClick={() => void run(async () => {
                    const result = await api.clearMediaCache()
                    return `已释放 ${size(result.released)}${result.incomplete ? ' · 部分闲置文件暂时无法删除' : ''}`
                  })}>确认清理</Button></AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </div>
        {status?.warning && <Alert><AlertCircle /><AlertDescription>{interfaceCopy(status.warning)}</AlertDescription></Alert>}
        {error && <Alert variant="destructive"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert>}
        <div role="status" className="text-muted-foreground text-sm empty:hidden">{busy ? '正在处理缓存…' : message}</div>
      </CardContent>
    </Card>
  )
}
