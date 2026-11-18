import { AlertCircle, ArrowUpRight, FolderOpen, MonitorPlay, Moon, RotateCw, Sun } from 'lucide-react'
import type { Preferences } from '../bridge'
import { api, type EngineStatus } from '../workspace'
import { Alert, AlertDescription } from '../ui/shadcn/alert'
import { Button } from '../ui/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/shadcn/card'
import { Separator } from '../ui/shadcn/separator'
import { Switch } from '../ui/shadcn/switch'
import { StorageSettings } from './StorageSettings'

type DirectorySetting = 'toolDirectory' | 'outputDirectory'

export function SettingsPage({ preferences, engine, error, systemReduced, onSave, onRetry, onPreferences }: {
  preferences: Preferences; engine: EngineStatus; error: string; systemReduced: boolean
  onSave: (action: () => Promise<Preferences>, recheck?: boolean) => Promise<void>
  onRetry: () => void
  onPreferences: (preferences: Preferences) => void
}) {
  const tools = engine.kind === 'ready' ? engine.tools : undefined

  function chooseDirectory(key: DirectorySetting) {
    void onSave(() => api.chooseDirectory(key), key === 'toolDirectory')
  }

  function resetDirectory(key: DirectorySetting) {
    void onSave(() => api.resetDirectory(key), key === 'toolDirectory')
  }

  return (
    <section className="page-layout settings-layout">
      <header className="page-header">
        <div className="grid gap-1.5"><h1>设置</h1><p>管理外观、动效、FFmpeg、默认输出位置和媒体缓存。</p></div>
      </header>
      {error && <Alert variant="destructive"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert>}
      <Card>
        <CardHeader><CardTitle>外观</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div className="setting-row">
            <span className="text-sm font-medium">主题</span>
            <div className="theme-options" role="group" aria-label="主题">
              <Button size="sm" variant="ghost" aria-pressed={preferences.theme === 'dark'}
                onClick={() => void onSave(() => api.setTheme('dark'))}><Moon />深色</Button>
              <Button size="sm" variant="ghost" aria-pressed={preferences.theme === 'light'}
                onClick={() => void onSave(() => api.setTheme('light'))}><Sun />浅色</Button>
            </div>
          </div>
          <Separator />
          <div className="setting-row">
            <div>
              <label htmlFor="reduce-motion" className="text-sm font-medium">减少动效</label>
              <p id="motion-description" className="text-muted-foreground text-sm">{systemReduced
                ? 'Windows 已启用减少动效，应用正在遵循系统偏好。'
                : 'Windows 动画已开启。可在此单独减少应用动效。'}</p>
            </div>
            <Switch id="reduce-motion" aria-label="减少动效" aria-describedby="motion-description" checked={preferences.reduceMotion}
              onCheckedChange={(value) => void onSave(() => api.setReducedMotion(value))} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>FFmpeg</CardTitle><CardDescription>使用同一个 FFmpeg 构建中的 ffmpeg.exe 和 ffprobe.exe。</CardDescription></CardHeader>
        <CardContent className="grid gap-4">
          <div className="setting-row">
            <div className="min-w-0">
              <p className="text-sm font-medium">程序目录</p>
              <p className="text-muted-foreground truncate text-sm" title={preferences.toolDirectory}>{preferences.toolDirectory || '使用系统 PATH'}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {preferences.toolDirectory && <Button variant="ghost" onClick={() => resetDirectory('toolDirectory')}>使用 PATH</Button>}
              <Button variant="outline" onClick={() => chooseDirectory('toolDirectory')}><FolderOpen />选择 bin 文件夹</Button>
            </div>
          </div>
          {tools && <>
            <Separator />
            <dl className="tool-info text-sm">
              <dt>版本</dt><dd>{tools.version}</dd>
              <dt>FFmpeg</dt><dd title={tools.ffmpeg}>{tools.ffmpeg}</dd>
              <dt>FFprobe</dt><dd title={tools.ffprobe}>{tools.ffprobe}</dd>
            </dl>
          </>}
          {engine.kind !== 'checking' && <p className="text-muted-foreground text-sm">
            {engine.inPath ? '系统 PATH 中已找到可用的 FFmpeg 和 FFprobe。' : '系统 PATH 中未找到可用的 FFmpeg 和 FFprobe。'}
            {preferences.toolDirectory && !tools && ' 当前选择的目录也不可用。'}
          </p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onRetry} disabled={engine.kind === 'checking'}><RotateCw />重新检测</Button>
            <Button variant="ghost" onClick={() => void api.openLink('ffmpeg')}>获取 FFmpeg<ArrowUpRight /></Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>输出</CardTitle></CardHeader>
        <CardContent>
          <div className="setting-row">
            <div className="min-w-0">
              <p className="text-sm font-medium">默认输出文件夹</p>
              <p className="text-muted-foreground truncate text-sm" title={preferences.outputDirectory}>{preferences.outputDirectory || '视频所在文件夹'}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {preferences.outputDirectory && <Button variant="ghost" onClick={() => resetDirectory('outputDirectory')}>恢复默认</Button>}
              <Button variant="outline" onClick={() => chooseDirectory('outputDirectory')}><FolderOpen />选择文件夹</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <StorageSettings directory={preferences.cacheDirectory} onPreferences={onPreferences} />

      <Card className="gap-0">
        <CardContent className="setting-row">
          <div>
            <p className="text-sm font-medium">资源管理器缩略图</p>
            <p className="text-muted-foreground text-sm">如果缩略图仍取自影片画面，可手动配置 Icaros。</p>
          </div>
          <Button variant="outline" onClick={() => void api.openLink('icaros')}><MonitorPlay />Icaros 设置说明<ArrowUpRight /></Button>
        </CardContent>
      </Card>
    </section>
  )
}
