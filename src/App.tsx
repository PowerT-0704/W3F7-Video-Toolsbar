import { useEffect, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import {
  ArrowDownToLine, ArrowUpRight, Check, ChevronRight, CircleAlert, Clapperboard, FileVideo,
  Film, FolderOpen, GitBranch, Heart, Image as ImageIcon, ImagePlus, Info, LoaderCircle,
  MessageCircle, MonitorPlay, RefreshCw, Settings2, SquareArrowOutUpRight, Terminal, Globe,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { Asset, AssetKind, Page, Preferences, ToolStatus, VideoDetails } from './bridge'
import { BorderBeam } from './ui/border-beam'
import { BlurFade } from './ui/blur-fade'
import { ShimmerButton } from './ui/shimmer-button'

const api = window.videoTools
const defaultPrefs: Preferences = { toolDirectory: '', outputDirectory: '', reduceMotion: false }
const pages = [
  { id: 'cover', label: '视频封面', icon: Clapperboard },
  { id: 'settings', label: '设置', icon: Settings2 },
  { id: 'about', label: '关于', icon: Info },
] as const

function displaySize(bytes: number) {
  const megabyte = 1024 * 1024
  return bytes >= megabyte ? (bytes / megabyte).toFixed(1) + ' MB' : Math.ceil(bytes / 1024) + ' KB'
}

function displayDuration(seconds: number) {
  const rounded = Math.round(seconds)
  return [Math.floor(rounded / 60), rounded % 60].map((part) => String(part).padStart(2, '0')).join(':')
}

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function imageDimensions(event: React.SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget
  return image.naturalWidth + ' × ' + image.naturalHeight
}

function FileSlot({ kind, asset, details, disabled, onPick }: {
  kind: AssetKind; asset?: Asset; details: string; disabled: boolean; onPick: () => void
}) {
  const video = kind === 'video'
  const icon = video ? <FileVideo size={19} /> : <ImageIcon size={19} />
  const label = video ? '视频文件' : '封面图片'
  return (
    <div className="file-field">
      <label className="file-label">{label}</label>
      <button className={'file-slot' + (asset ? ' has-file' : '')} disabled={disabled} onClick={onPick}
        aria-label={(asset ? '更换' : '选择') + (video ? '视频' : '封面')} title={asset?.path}>
        <span className="slot-icon">{icon}</span>
        <span className="slot-text">
          <strong>{asset?.name || (video ? '选择 MP4' : '选择封面')}</strong>
          <small>{asset ? details || displaySize(asset.bytes) : video ? 'MP4' : 'PNG · JPG · JPEG'}</small>
        </span>
        {asset ? <ChevronRight size={16} className="slot-tail" /> : <FolderOpen size={16} className="slot-tail" />}
      </button>
    </div>
  )
}

function SectionHeading({ title, children }: { title: string; children: ReactNode }) {
  return <header className="page-heading"><h1>{title}</h1><p>{children}</p></header>
}

export function App() {
  const [page, setPage] = useState<Page>('cover')
  const [preferences, setPreferences] = useState(defaultPrefs)
  const [tools, setTools] = useState<ToolStatus>()
  const [toolMessage, setToolMessage] = useState('')
  const [checkingTools, setCheckingTools] = useState(true)
  const [video, setVideo] = useState<Asset>()
  const [cover, setCover] = useState<Asset>()
  const [details, setDetails] = useState<VideoDetails>()
  const [coverSize, setCoverSize] = useState('')
  const [coverError, setCoverError] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const dragDepth = useRef(0)
  const selectionBusy = useRef(false)
  const toolCheck = useRef(0)
  const exporting = useRef(false)
  const OSReduced = useReducedMotion()
  const reduced = Boolean(OSReduced || preferences.reduceMotion)
  const ableToExport = Boolean(tools && video && cover && !coverError && !busy)

  async function detectTools() {
    const revision = ++toolCheck.current
    setCheckingTools(true)
    setToolMessage('')
    try {
      const status = await api.detect()
      if (revision === toolCheck.current) setTools(status)
    } catch (reason) {
      if (revision === toolCheck.current) {
        setTools(undefined)
        setToolMessage(errorText(reason))
      }
    } finally {
      if (revision === toolCheck.current) setCheckingTools(false)
    }
  }

  useEffect(() => {
    void api.settings().then(setPreferences).catch((reason) => setSettingsError(errorText(reason)))
    void detectTools()
    return api.onProgress((value) => setProgress((previous) => Math.max(previous, value)))
  }, [])

  useEffect(() => {
    setDetails(undefined)
    let active = true
    if (video && tools) {
      void api.inspect(video.id).then((info) => {
        if (active) setDetails(info)
      }).catch((reason) => {
        if (active) setError(errorText(reason))
      })
    }
    return () => { active = false }
  }, [video, tools])

  function accept(assets: Asset[]) {
    for (const asset of assets) {
      if (asset.kind === 'video') setVideo(asset)
      else {
        setCover(asset)
        setCoverSize('')
        setCoverError(false)
      }
    }
    if (assets.length) {
      setError('')
      setOutput('')
    }
  }

  async function select(action: () => Promise<Asset[]>) {
    if (selectionBusy.current || exporting.current) return
    selectionBusy.current = true
    try { accept(await action()) } catch (reason) { setError(errorText(reason)) }
    finally { selectionBusy.current = false }
  }

  function pick(kind: AssetKind) {
    void select(async () => {
      const asset = await api.pick(kind)
      return asset ? [asset] : []
    })
  }

  function dragEnter(event: DragEvent) {
    event.preventDefault()
    if (!event.dataTransfer.types.includes('Files') || exporting.current) return
    dragDepth.current++
    setDragging(true)
  }

  function dragLeave(event: DragEvent) {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (!dragDepth.current) setDragging(false)
  }

  function drop(event: DragEvent) {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length) void select(() => api.drop(files))
  }

  async function exportCover() {
    if (!video || !cover || !ableToExport || exporting.current || selectionBusy.current) return
    exporting.current = true
    setBusy(true)
    setProgress(0)
    setError('')
    setOutput('')
    try {
      const result = await api.exportCover(video.id, cover.id)
      setProgress(100)
      setOutput(result.path)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      exporting.current = false
      setBusy(false)
    }
  }

  async function saveSettings(action: () => Promise<Preferences>, recheck = false) {
    setSettingsError('')
    try {
      setPreferences(await action())
      if (recheck) await detectTools()
    } catch (reason) { setSettingsError(errorText(reason)) }
  }

  const videoDetails = details
    ? [details.width + ' × ' + details.height, displayDuration(details.duration), details.codec.toUpperCase()].join(' · ')
    : ''
  const coverDetails = cover && coverSize ? [coverSize, displaySize(cover.bytes)].join(' · ') : ''
  const outputDir = preferences.outputDirectory || video?.path.replace(/[\\/][^\\/]*$/, '') || '视频所在文件夹'

  let screen: ReactNode
  if (page === 'cover') {
    screen = (
      <div className="cover-page" onDragEnter={dragEnter} onDragLeave={dragLeave} onDrop={drop}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy' }}>
        <SectionHeading title="视频封面">为 MP4 写入自定义封面，保留原始画质和音轨。</SectionHeading>
        <div className="workspace-grid">
          <section className="preview-panel" aria-label="封面预览">
            <div className="panel-heading"><span><ImageIcon size={16} /> 封面预览</span><small>{coverSize || '原始比例'}</small></div>
            <div className={'stage' + (dragging ? ' drop-active' : '') + (cover && !coverError ? ' has-preview' : '')}
              onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                event.currentTarget.style.setProperty('--light-x', (event.clientX - rect.left) + 'px')
                event.currentTarget.style.setProperty('--light-y', (event.clientY - rect.top) + 'px')
              }}>
              <div className="stage-grid" aria-hidden="true" />
              <div className="stage-spotlight" aria-hidden="true" />
              <span className="crop tl" aria-hidden="true" /><span className="crop tr" aria-hidden="true" />
              <span className="crop bl" aria-hidden="true" /><span className="crop br" aria-hidden="true" />
              {cover && !coverError && (
                <motion.img key={cover.id} className="cover-image" alt="所选视频封面" src={cover.preview}
                  initial={reduced ? false : { opacity: 0, scale: 0.983 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: reduced ? 0 : 0.32 }}
                  onLoad={(event) => setCoverSize(imageDimensions(event))} onError={() => setCoverError(true)} />
              )}
              <button className="stage-action" disabled={busy} onClick={() => pick('cover')} aria-label="从预览区选择封面">
                {cover && !coverError && !dragging ? <span className="replace-label"><ImagePlus size={16} /> 更换封面</span> : (
                  <span className="stage-message">
                    <span className="stage-icon"><ImagePlus size={32} strokeWidth={1.5} /></span>
                    <strong>{dragging ? '松开鼠标，导入素材' : coverError ? '无法预览这张图片' : '拖入视频和封面'}</strong>
                    <small>{dragging ? 'MP4 + PNG / JPG / JPEG' : '也可以点击选择封面图片'}</small>
                  </span>
                )}
              </button>
              {dragging && !reduced && <BorderBeam duration={2.7} size={130} borderWidth={2} colorFrom="#9daeff" colorTo="#b483ff" />}
            </div>
          </section>
          <section className="materials-panel" aria-label="素材与输出">
            <div className="panel-heading"><span><Film size={16} /> 素材与输出</span></div>
            <FileSlot kind="video" asset={video} details={videoDetails} disabled={busy} onPick={() => pick('video')} />
            <FileSlot kind="cover" asset={cover} details={coverDetails} disabled={busy} onPick={() => pick('cover')} />
            <div className="output-path">
              <span><FolderOpen size={15} /> 输出文件夹</span>
              <button disabled={busy} title={outputDir} aria-label="选择成品输出文件夹"
                onClick={() => void saveSettings(() => api.chooseDirectory('outputDirectory'))}>
                <span>{outputDir}</span><SquareArrowOutUpRight size={14} />
              </button>
            </div>
          </section>
        </div>
        <section className={'export-bar' + (output ? ' export-done' : '')} aria-label="封装状态">
          <div className="export-state" role="status">
            <span className="state-icon">
              {busy ? <LoaderCircle className="spinner" size={20} /> : output ? <Check size={20} /> : <Clapperboard size={20} />}
            </span>
            <div className="export-label">
              <strong>{busy ? '正在封装 · ' + progress + '%' : output ? '封装完成' : '输出 MP4'}</strong>
              <small title={output}>{output || (busy ? '复制视频和音轨并写入封面' : '编码保持原样 · 原文件保留')}</small>
            </div>
          </div>
          {output && <button className="button secondary reveal-button" onClick={() => void api.revealOutput()}><FolderOpen size={16} /> 查看成品</button>}
          <ShimmerButton type="button" disabled={!ableToExport || checkingTools} className="export-button"
            shimmerColor="#dfd4ff" shimmerDuration="3.6s" borderRadius="11px" background="#6651c7"
            onClick={() => void exportCover()}>
            <ArrowDownToLine size={18} /> {busy ? '封装中' : '封装封面'}
          </ShimmerButton>
          {busy && <div className="progress-track" aria-label="封装进度" role="progressbar" aria-valuenow={progress}>
            <span style={{ width: progress + '%' }} />
          </div>}
        </section>
        {(error || settingsError || (toolMessage && !checkingTools)) && (
          <div className="feedback" role="alert"><CircleAlert size={17} />
            <span>{error || settingsError || '需要 FFmpeg 和 FFprobe 才能封装视频。'}</span>
            {!tools && <button className="text-button" onClick={() => setPage('settings')}>打开设置 <ChevronRight size={14} /></button>}
          </div>
        )}
      </div>
    )
  } else if (page === 'settings') {
    screen = (
      <>
        <SectionHeading title="设置">配置封装工具、输出位置和界面动效。</SectionHeading>
        <div className="settings-list">
          <section className="setting-panel">
            <div className="setting-title"><span className="slot-icon"><Terminal size={19} /></span><div><h2>FFmpeg</h2><p>封装和校验需要 FFmpeg 与 FFprobe。</p></div></div>
            <div className="setting-row">
              <div><strong>程序位置</strong><small title={preferences.toolDirectory}>{preferences.toolDirectory || '使用系统 PATH'}</small></div>
              <div className="row-actions">
                {preferences.toolDirectory && <button className="button secondary" disabled={busy} onClick={() => void saveSettings(() => api.resetDirectory('toolDirectory'), true)}>使用 PATH</button>}
                <button className="button secondary" disabled={busy} onClick={() => void saveSettings(() => api.chooseDirectory('toolDirectory'), true)}><FolderOpen size={16} /> 选择 bin 文件夹</button>
              </div>
            </div>
            <div className="setting-row">
              <div>
                <strong>{checkingTools ? '正在检测' : tools ? 'FFmpeg ' + tools.version : '暂不可用'}</strong>
                <small title={tools?.ffmpeg}>{tools?.ffmpeg || toolMessage || '正在检查 FFmpeg 和 FFprobe'}</small>
              </div>
              <div className="row-actions">
                <button className="button secondary" onClick={() => void api.openLink('ffmpeg')}>安装指南 <ArrowUpRight size={15} /></button>
                <button className="button secondary" disabled={checkingTools} onClick={() => void detectTools()}><RefreshCw size={15} /> 重新检测</button>
              </div>
            </div>
          </section>
          <section className="setting-panel">
            <div className="setting-title"><span className="slot-icon"><FolderOpen size={19} /></span><div><h2>输出与显示</h2><p>设置默认保存位置与工作区表现。</p></div></div>
            <div className="setting-row"><div><strong>默认输出文件夹</strong><small title={preferences.outputDirectory}>{preferences.outputDirectory || '视频所在文件夹'}</small></div>
              <div className="row-actions">
                {preferences.outputDirectory && <button className="button secondary" disabled={busy} onClick={() => void saveSettings(() => api.resetDirectory('outputDirectory'))}>恢复默认</button>}
                <button className="button secondary" disabled={busy} onClick={() => void saveSettings(() => api.chooseDirectory('outputDirectory'))}>选择文件夹</button>
              </div>
            </div>
            <div className="setting-row"><div><strong>减少动效</strong><small>{OSReduced ? '当前 Windows 已启用减少动效。' : '减少光效和界面过渡，保留进度及状态。'}</small></div>
              <button className="switch" role="switch" aria-label="减少动效" aria-checked={preferences.reduceMotion}
                onClick={() => void saveSettings(() => api.setReducedMotion(!preferences.reduceMotion))}><span /></button>
            </div>
          </section>
          <section className="setting-panel shell-help">
            <div className="setting-title"><span className="slot-icon"><MonitorPlay size={19} /></span><div><h2>资源管理器缩略图</h2><p>若仍显示视频画面，可手动启用支持内嵌封面的缩略图扩展。</p></div></div>
            <button className="button secondary" onClick={() => void api.openLink('icaros')}>Icaros 设置说明 <ArrowUpRight size={15} /></button>
          </section>
        </div>
        {settingsError && <div className="feedback" role="alert"><CircleAlert size={17} />{settingsError}</div>}
      </>
    )
  } else {
    screen = (
      <>
        <SectionHeading title="关于">W3F7のVideo_Toolsbar · v0.1.0-preview.1</SectionHeading>
        <div className="about-grid">
          <section className="about-panel author-panel">
            <span className="brand-mark about-mark"><Clapperboard size={27} /></span>
            <h2>W3F7</h2>
            <p>成都理工大学宜宾校区在读。喜欢做顺手的桌面小工具，也喜欢折腾 After Effects 脚本。</p>
            <button className="button secondary" onClick={() => void api.openLink('github')}><GitBranch size={17} /> PowerT-0704 <ArrowUpRight size={15} /></button>
          </section>
          <section className="about-panel sponsor-panel">
            <div className="setting-title"><span className="slot-icon"><Heart size={19} /></span><div><h2>支持作者</h2><p>赞助收款码待补</p></div></div>
            <div className="sponsor-placeholder" aria-hidden="true"><Heart size={25} strokeWidth={1.4} /></div>
          </section>
          <section className="about-panel community-panel" aria-label="后续链接">
            {[{ name: '个人主页', icon: Globe }, { name: 'B 站', icon: MonitorPlay }, { name: '粉丝群', icon: MessageCircle }].map(({ name, icon: Icon }) => (
              <div className="community-item" key={name}><Icon size={18} /><div><strong>{name}</strong><small>链接待补</small></div></div>
            ))}
          </section>
        </div>
      </>
    )
  }

  return (
    <div className="app" data-reduced={reduced} onDragOver={(event) => event.preventDefault()} onDrop={(event) => event.preventDefault()}>
      <div className="titlebar"><Clapperboard size={14} /> <span>W3F7のVideo_Toolsbar</span></div>
      <aside className="sidebar" aria-label="功能侧栏">
        <div className="brand">
          <span className="brand-mark"><Clapperboard size={22} strokeWidth={1.8} /></span>
          <div><strong>Video Toolsbar</strong><small>W3F7</small></div>
        </div>
        <nav aria-label="工具页面">
          {pages.map(({ id, label, icon: Icon }) => (
            <button type="button" key={id} title={label} aria-label={label}
              aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)} className="nav-button">
              {page === id && <motion.span className="nav-indicator" aria-hidden="true"
                layoutId={reduced ? undefined : 'nav-indicator'} transition={{ type: 'spring', stiffness: 520, damping: 42 }} />}
              <Icon size={18} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="engine-status" onClick={() => setPage('settings')}>
          <span className={'engine-dot ' + (tools ? 'engine-ready' : checkingTools ? 'engine-check' : 'engine-missing')} />
          <span>{checkingTools ? '检测 FFmpeg' : tools ? 'FFmpeg 已就绪' : '配置 FFmpeg'}</span>
        </button>
      </aside>
      <main className="main">
        {reduced ? <div className="page-body">{screen}</div> :
          <BlurFade key={page} className="page-body" duration={0.25} blur="3px" offset={7}>{screen}</BlurFade>}
      </main>
    </div>
  )
}
