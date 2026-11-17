import { useState } from 'react'
import { Dialog } from 'radix-ui'
import { AlertCircle, ArrowUpRight, CodeXml, ExternalLink, Globe, Heart, Maximize2, QrCode, RefreshCw, Wifi, X } from 'lucide-react'
import { version } from '../../package.json'
import avatar from '../assets/w3f7-avatar.jpg'
import bilibili from '../assets/bilibili.svg'
import qq from '../assets/qq.svg'
import sponsor from '../assets/w3f7-sponsor.png'
import { aboutCopy } from './about-copy'
import { api, errorText } from '../workspace'
import type { ExternalLinkId } from '../bridge'
import { ActionButton } from '../ui/action-button'
import { BlurFade } from '../ui/blur-fade'
import { Alert, AlertDescription } from '../ui/shadcn/alert'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/shadcn/avatar'
import { Badge } from '../ui/shadcn/badge'
import { Button } from '../ui/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/shadcn/card'

const projects = [
  { id: 'ezqr', name: '易码 EzQR-Tools', description: '桌面二维码识别与生成工具。', icon: QrCode },
  { id: 'campuslink', name: 'CampusLink', description: '面向成都理工大学宜宾校区，支持校园网自动连接和掉线重连。', icon: Wifi },
] as const

const community = [
  { id: 'website', name: '个人主页', image: undefined },
  { id: 'bilibili', name: 'B 站', image: bilibili },
  { id: 'qq', name: 'QQ 粉丝群', image: qq },
] as const

function SponsorCard() {
  return (
    <Card className="min-w-0 gap-3">
      <CardHeader><CardTitle className="flex items-center gap-2"><Heart className="text-muted-foreground size-4" />支持作者</CardTitle></CardHeader>
      <CardContent className="grid grow">
        <Dialog.Root>
          <Dialog.Trigger asChild>
            <Button variant="outline" className="sponsor-preview" aria-label="放大赞助收款码">
              <img src={sponsor} alt="W3F7 个人赞助收款码" />
              <span><Maximize2 />放大收款码</span>
            </Button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="qr-overlay" />
            <Dialog.Content className="qr-dialog" aria-describedby={undefined}>
              <div className="flex items-center justify-between gap-3">
                <Dialog.Title className="font-semibold">W3F7 个人赞助</Dialog.Title>
                <Dialog.Close asChild><Button type="button" size="icon-sm" variant="ghost" aria-label="关闭收款码"><X /></Button></Dialog.Close>
              </div>
              <img src={sponsor} alt="放大的 W3F7 个人赞助收款码" />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </CardContent>
    </Card>
  )
}

export function AboutPage() {
  const [notice, setNotice] = useState(0)
  const [linkError, setLinkError] = useState('')

  function openLink(id: ExternalLinkId) {
    setLinkError('')
    void api.openLink(id).catch((reason) => setLinkError(errorText(reason)))
  }

  return (
    <section className="page-layout">
      <header className="page-header">
        <div className="grid gap-1.5"><h1>关于</h1><p>W3F7のVideo_Toolsbar</p></div>
        <Badge variant="outline">v{version}</Badge>
      </header>
      {linkError && <BlurFade><Alert variant="destructive"><AlertCircle /><AlertDescription>{linkError}</AlertDescription></Alert></BlurFade>}
      <div className="about-grid">
        <BlurFade>
          <Card className="min-w-0 gap-5">
            <BlurFade delay={0.04}>
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
            </BlurFade>
            <CardContent className="text-muted-foreground grid max-w-prose gap-4 text-sm leading-relaxed">
              <p className="whitespace-pre-line" data-about-copy>{aboutCopy}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => openLink('github')}><CodeXml />查看 GitHub 主页<ArrowUpRight /></Button>
                <ActionButton variant="outline" onClick={() => setNotice((count) => count + 1)}><RefreshCw />检查更新</ActionButton>
              </div>
              <div role="status">{notice > 0 && <BlurFade key={notice}>更新服务待接入</BlurFade>}</div>
            </CardContent>
          </Card>
        </BlurFade>
        <BlurFade delay={0.06}><SponsorCard /></BlurFade>
      </div>

      <BlurFade delay={0.1}>
        <Card className="gap-3 py-4">
          <CardHeader><CardTitle>其他链接</CardTitle></CardHeader>
          <CardContent className="community-grid">
            {community.map(({ id, name, image }) => (
              <Button key={id} variant="outline" className="community-link justify-start" onClick={() => openLink(id)}>
                {image ? <img src={image} alt="" /> : <Globe />}<span className="grow text-left">{name}</span><ArrowUpRight />
              </Button>
            ))}
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade delay={0.15}>
        <Card>
          <CardHeader><CardTitle>GitHub 项目</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {projects.map(({ id, name, description, icon: Icon }) => (
              <Button key={id} variant="outline" className="h-auto min-w-0 justify-start gap-3 p-3 text-left" onClick={() => openLink(id)}>
                <Icon /><span className="min-w-0 grow space-y-0.5 whitespace-normal">
                  <span className="block font-medium">{name}</span><span className="text-muted-foreground block text-xs">{description}</span>
                </span><ExternalLink className="text-muted-foreground" />
              </Button>
            ))}
          </CardContent>
        </Card>
      </BlurFade>
    </section>
  )
}
