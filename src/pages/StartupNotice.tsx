import { useState } from 'react'
import { Clapperboard, MonitorCog } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { version } from '../../package.json'
import { api, errorText, type EngineStatus } from '../workspace'
import { Badge } from '../ui/shadcn/badge'
import { Button } from '../ui/shadcn/button'

export function StartupNotice({ mode, systemReduced, engine, customTools, onClose, onSettings }: {
  mode: 'welcome' | 'animations'
  systemReduced: boolean
  engine: EngineStatus
  customTools: boolean
  onClose: () => Promise<void>
  onSettings: () => Promise<void>
}) {
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState('')
  const welcome = mode === 'welcome'
  let tools = '正在检测…'
  if (engine.kind === 'missing') tools = engine.inPath ? '系统 PATH 可用，当前配置需修正' : '需要配置 FFmpeg 与 FFprobe'
  if (engine.kind === 'ready') {
    if (!customTools) tools = '系统 PATH 可用'
    else tools = engine.inPath ? '手动配置可用，系统 PATH 也可用' : '手动配置可用，系统 PATH 未找到'
  }

  async function close(settings = false) {
    if (closing) return
    setClosing(true)
    try { await (settings ? onSettings() : onClose()) }
    catch (reason) { setError(errorText(reason)) }
    finally { setClosing(false) }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) void close() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="qr-overlay" />
        <Dialog.Content className="qr-dialog startup-dialog">
          <div className="flex items-center gap-3">
            <span className="bg-muted grid size-10 shrink-0 place-items-center rounded-lg">
              {welcome ? <Clapperboard className="size-5" /> : <MonitorCog className="size-5" />}
            </span>
            <div>
              <Dialog.Title className="text-lg font-semibold">{welcome ? '欢迎使用 W3F7のVideo_Toolsbar' : 'Windows 动画效果已关闭'}</Dialog.Title>
              {welcome && <Badge variant="outline">v{version}</Badge>}
            </div>
          </div>
          <Dialog.Description className="text-muted-foreground text-sm leading-relaxed">
            {welcome ? '从起始页进入视频封面封装或音乐封面解析，在本地处理 MP4、FLAC 和 MP3。' :
              '应用正在遵循系统设置，界面会省略部分过渡和动画。'}
          </Dialog.Description>
          {welcome && <dl className="startup-checks" aria-live="polite">
            <div><dt>Windows 动画</dt><dd>{systemReduced ? '已关闭，应用将减少动效' : '已开启'}</dd></div>
            <div><dt>FFmpeg</dt><dd>{tools}</dd></div>
          </dl>}
          {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {systemReduced && <Button variant="outline" onClick={() => void api.openAnimationSettings().catch((reason) => setError(errorText(reason)))}>
              打开 Windows 动画设置
            </Button>}
            {welcome && engine.kind === 'missing' && <Button variant="outline" disabled={closing} onClick={() => void close(true)}>配置 FFmpeg</Button>}
            <Button disabled={closing} onClick={() => void close()}>{welcome ? '开始使用' : '知道了'}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
