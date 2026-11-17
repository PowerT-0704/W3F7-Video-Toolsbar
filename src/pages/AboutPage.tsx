import { ArrowUpRight, CodeXml, ExternalLink, Globe, Heart, MessageCircle, MonitorPlay, QrCode, Wifi } from 'lucide-react'
import { version } from '../../package.json'
import avatar from '../assets/w3f7-avatar.jpg'
import { api } from '../workspace'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/shadcn/avatar'
import { Badge } from '../ui/shadcn/badge'
import { Button } from '../ui/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/shadcn/card'

const projects = [
  { id: 'ezqr', name: '易码 EzQR-Tools', description: '桌面二维码识别与生成工具。', icon: QrCode },
  { id: 'campuslink', name: 'CampusLink', description: '面向成都理工大学宜宾校区，支持校园网自动连接和掉线重连。', icon: Wifi },
] as const

const community = [
  { name: '个人主页', icon: Globe },
  { name: 'B 站', icon: MonitorPlay },
  { name: '粉丝群', icon: MessageCircle },
] as const

export function AboutPage() {
  return (
    <section className="page-layout">
      <header className="page-header">
        <div className="grid gap-1.5"><h1>关于</h1><p>W3F7のVideo_Toolsbar</p></div>
        <Badge variant="outline">v{version}</Badge>
      </header>
      <div className="about-grid">
        <Card className="min-w-0 gap-5">
          <CardHeader className="flex items-center gap-4">
            <Avatar className="size-16 rounded-xl">
              <AvatarImage src={avatar} alt="W3F7 的 GitHub 头像" />
              <AvatarFallback className="rounded-xl">W3</AvatarFallback>
            </Avatar>
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-xl">W3F7</CardTitle>
              <CardDescription>@PowerT-0704</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="text-muted-foreground grid max-w-prose gap-4 text-sm leading-relaxed">
            <p>我在成都理工大学宜宾校区读书。平时喜欢做顺手的桌面小工具，也会写 After Effects 脚本，把视频制作里重复的操作交给脚本处理。</p>
            <p>我把做出来的工具和实验放在 GitHub 上。这个视频工具箱从 MP4 封面封装开始，先把拖文件、换封面和导出的流程做顺手，再逐步加入其他视频处理功能。</p>
            <Button className="justify-self-start" variant="outline" onClick={() => void api.openLink('github')}><CodeXml />查看 GitHub 主页<ArrowUpRight /></Button>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader><CardTitle className="flex items-center gap-2"><Heart className="text-muted-foreground size-4" />支持作者</CardTitle></CardHeader>
          <CardContent>
            <div className="border-border text-muted-foreground grid min-h-32 place-items-center rounded-lg border border-dashed text-sm">赞助收款码待补</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>GitHub 项目</CardTitle></CardHeader>
        <CardContent className="grid gap-2">
          {projects.map(({ id, name, description, icon: Icon }) => (
            <Button key={id} variant="outline" className="h-auto min-w-0 justify-start gap-3 p-3 text-left"
              onClick={() => void api.openLink(id)}>
              <Icon /><span className="min-w-0 grow space-y-0.5 whitespace-normal">
                <span className="block font-medium">{name}</span><span className="text-muted-foreground block text-xs">{description}</span>
              </span><ExternalLink className="text-muted-foreground" />
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card className="gap-3 py-4">
        <CardHeader><CardTitle>其他链接</CardTitle></CardHeader>
        <CardContent className="community-grid">
          {community.map(({ name, icon: Icon }) => (
            <div key={name} className="text-muted-foreground flex items-center gap-2 text-sm"><Icon className="size-4" />{name}<span className="text-xs">待补</span></div>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}
