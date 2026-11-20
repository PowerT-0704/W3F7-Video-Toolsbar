import { ArrowUpRight } from 'lucide-react'
import { version } from '../../package.json'
import { api } from '../workspace'
import { BlurFade } from '../ui/blur-fade'
import { Badge } from '../ui/shadcn/badge'
import { Button } from '../ui/shadcn/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/shadcn/card'

const releases = [
  {
    version,
    date: import.meta.env.VITE_BUILT_AT as string,
    changes: [
      '新增语音转录工作台，支持批量处理、字幕校对和软硬字幕合成。',
      '必剪可免 Key 转录，字幕模型默认 DeepSeek Flash。可接入自备 Whisper 程序和模型。',
      '引擎说明和模型与 API 加入侧栏，字幕支持 SRT、ASS、VTT、TXT 和 JSON。',
      '视频封面可仅内嵌、仅添加至第一帧，或同时执行两项。默认仅内嵌封面。',
      '首帧方式只编码新增的封面帧，原视频画面和音轨直接流复制。支持单主视频轨的 8 位 H.264 SDR MP4。',
      '单文件 BAT 拖入素材后显示三种方式的选择菜单、输出说明和作者信息。',
    ],
  },
  {
    version: '1.2.3',
    date: '2026-11-19',
    changes: [
      '设置页的标题和卡片随窗口宽度在工作区居中。',
      '切换深浅主题时，滑块边缘流光沿逆时针方向绕成一圈。',
    ],
  },
  {
    version: '1.2.2',
    date: '2026-11-19T09:16:26Z',
    changes: [
      '可裁剪并更换音乐正面封面，也可将新封面和本地歌词一次写入同格式音频副本。',
      '音乐页加入带流光进度条的播放预览，带时间戳的内嵌歌词和本地 LRC 随进度高亮。',
      '修复从侧栏底部跳转到上方工具时短暂出现的滚动条。',
    ],
  },
  {
    version: '1.2.1',
    date: '2026-11-19T06:58:10.632Z',
    changes: [
      '新增音乐封面解析，支持预览和导出 FLAC、MP3 的内嵌封面与歌词。',
      '导入 LRC 可生成同格式的音频副本，保留原始音频数据和内嵌封面。',
      '起始页提供视频封面封装和音乐封面解析入口。',
    ],
  },
  {
    version: '1.1.1',
    date: '2026-11-18T13:42:18+08:00',
    changes: [
      '放慢起始页胶片标识的循环，旋转和漂浮在每圈交界处连续。',
      '定位视频时保持同一个预览画面，状态变化不再改变时间轴的布局。',
      '视频工作区置顶，封面预览独立成卡，素材与输出放在下方。',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-11-18T13:05:00+08:00',
    changes: [
      '起始页的胶片标识加入变速旋转和漂浮，深浅主题共用动效。',
      '视频预览加入剪辑式时间轴和播放头。当前帧可设为封面或按原分辨率导出 PNG。',
      '调整预览、素材和输出布局，封面缩略图可以放大查看。',
      '设置中可自定义媒体缓存位置，迁移缓存或清理闲置文件。',
      '首次启动显示欢迎弹窗，检测 FFmpeg 和 Windows 动画设置。',
      '启动后检查 GitHub 正式版，关于页提供手动检查。',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-11-17T20:18:56+08:00',
    changes: [
      '发布 Windows x64 正式版，包含桌面便携包与单文件拖放批处理。',
      '侧栏新增分组分割线，固定展开时点击工作区空白即可收回。',
      '起始页底部加入居中的版本信息，关于页对齐作者和赞助卡片并放大收款码。',
    ],
  },
  {
    version: '0.1.0-preview.4',
    date: '2026-11-17T19:29:00+08:00',
    changes: [
      '恢复首版切页节奏，增加旧页离场和侧栏选中项的弹簧滑动。',
      '新增浅色主题，支持记住配色并同步 Windows 原生标题栏。',
      '桌面侧栏可悬停展开、离开收回，也可手动固定。',
    ],
  },
  {
    version: '0.1.0-preview.3',
    date: '2026-11-17T14:05:49+08:00',
    changes: [
      '新增启动动画、起始页和开发日志，侧栏按 Tools_list、About APP、More 分组。',
      '恢复页面切换、拖入光效和按钮扫光，增加素材、导出、设置和收款码的交互反馈。',
      '按作者原文更新关于页，加入赞助收款码、社交链接和检查更新入口。',
    ],
  },
  {
    version: '0.1.0-preview.2',
    date: '2026-11-17T12:38:56+08:00',
    changes: [
      '采用 shadcn/ui Neutral 暗色组件，标题区融入窗口。设置和关于移到侧栏底部。',
      '支持双文件或逐件拖入，加入自动检测 FFmpeg、离线头像与项目链接。',
    ],
  },
  {
    version: '0.1.0-preview.1',
    date: '2026-11-17T11:51:50+08:00',
    changes: [
      '发布单文件 BAT 和首个 Windows x64 桌面预览。',
      '支持 PNG、JPG、JPEG 封面与 MP4 流复制，校验原始音视频和内嵌封面。',
    ],
  },
] as const

const credits = [
  { name: 'FFmpeg', id: 'ffmpeg' },
  { name: 'shadcn/ui', id: 'shadcn' },
  { name: 'Magic UI', id: 'magicui' },
  { name: 'React Bits', id: 'reactbits' },
] as const

const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

export function ChangelogPage() {
  return (
    <section className="page-layout changelog-page">
      <header className="page-header">
        <div className="grid gap-1.5"><h1>开发日志</h1><p>版本更新与致谢 · 北京时间</p></div>
      </header>
      <ol className="changelog-list">
        {releases.map((release, index) => (
          <li key={release.version}>
            <BlurFade delay={index * 0.055}>
              <Card className="changelog-entry gap-3 py-4">
                <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle><Badge variant={index === 0 ? 'secondary' : 'outline'}>v{release.version}</Badge></CardTitle>
                  <time dateTime={release.date} className="text-muted-foreground text-xs tabular-nums">{dateFormat.format(new Date(release.date))}</time>
                </CardHeader>
                <CardContent><ul className="text-muted-foreground list-disc space-y-2 pl-4 text-sm leading-relaxed">
                  {release.changes.map((change) => <li key={change}>{change}</li>)}
                </ul></CardContent>
              </Card>
            </BlurFade>
          </li>
        ))}
      </ol>
      <BlurFade delay={0.16}>
        <Card className="gap-2 py-4">
          <CardHeader><CardTitle>致谢</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-2 text-sm">感谢参与开发、测试和反馈的朋友，以及提供媒体处理、界面组件和动效参考的开源项目。</p>
            <div className="flex flex-wrap gap-1">
              {credits.map(({ name, id }) => (
                <Button key={id} size="sm" variant="ghost" onClick={() => void api.openLink(id)}>{name}<ArrowUpRight /></Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </BlurFade>
    </section>
  )
}
