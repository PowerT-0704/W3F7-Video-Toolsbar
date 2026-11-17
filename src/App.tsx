import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Clapperboard, History, House, Info, Settings2 } from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import type { Page, Preferences } from './bridge'
import { api, errorText, type EngineStatus } from './workspace'
import { AboutPage } from './pages/AboutPage'
import { ChangelogPage } from './pages/ChangelogPage'
import { CoverPage } from './pages/CoverPage'
import { HomePage, Startup } from './pages/HomePage'
import { SettingsPage } from './pages/SettingsPage'
import { BlurFade } from './ui/blur-fade'
import { MotionEnabledContext, useMotionEnabled, useSystemReducedMotion } from './ui/motion-policy'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarInset, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from './ui/shadcn/sidebar'

const defaultPreferences: Preferences = { toolDirectory: '', outputDirectory: '', reduceMotion: false }
const pages = {
  home: { label: '起始页', icon: House },
  cover: { label: '视频封面封装', icon: Clapperboard },
  changelog: { label: '开发日志', icon: History },
  settings: { label: '设置', icon: Settings2 },
  about: { label: '关于', icon: Info },
} as const

function NavigationItem({ page, current, onNavigate }: { page: Page; current: Page; onNavigate: (page: Page) => void }) {
  const { label, icon: Icon } = pages[page]
  const { isMobile, setOpenMobile } = useSidebar()
  const animated = useMotionEnabled()
  const active = page === current
  function navigate() {
    onNavigate(page)
    if (isMobile) setOpenMobile(false)
  }
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} aria-current={active ? 'page' : undefined}
        className={animated ? 'animated-nav data-[active=true]:bg-transparent' : undefined}
        tooltip={label} aria-label={label} onClick={navigate}>
        {animated && active && (
          <motion.span layoutId="active-tool" aria-hidden="true" className="nav-highlight"
            initial={false} transition={{ duration: 0.24, ease: 'easeOut' }} />
        )}
        <Icon /><span className="nav-label">{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function App() {
  const [page, setPage] = useState<Page>('home')
  const [preferences, setPreferences] = useState(defaultPreferences)
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)
  const [startupFinished, setStartupFinished] = useState(false)
  const [engine, setEngine] = useState<EngineStatus>({ kind: 'checking' })
  const [settingsError, setSettingsError] = useState('')
  const engineRevision = useRef(0)
  const main = useRef<HTMLElement>(null)
  const reduced = useSystemReducedMotion() || preferences.reduceMotion
  const ready = preferencesLoaded && (startupFinished || reduced)

  const detect = useCallback(async () => {
    const revision = ++engineRevision.current
    setEngine({ kind: 'checking' })
    try {
      const tools = await api.detect()
      if (revision === engineRevision.current) setEngine({ kind: 'ready', tools })
    } catch (reason) {
      if (revision === engineRevision.current) setEngine({ kind: 'missing', message: errorText(reason) })
    }
  }, [])

  useEffect(() => {
    void api.settings().then(setPreferences).catch((reason) => setSettingsError(errorText(reason)))
      .finally(() => setPreferencesLoaded(true))
    void detect()
  }, [detect])

  useEffect(() => {
    if (!preferencesLoaded || startupFinished) return
    if (reduced) {
      setStartupFinished(true)
      return
    }
    const timeout = window.setTimeout(() => setStartupFinished(true), 450)
    return () => window.clearTimeout(timeout)
  }, [preferencesLoaded, reduced, startupFinished])

  useLayoutEffect(() => {
    document.documentElement.dataset.reduced = String(reduced)
    return () => { delete document.documentElement.dataset.reduced }
  }, [reduced])

  useLayoutEffect(() => {
    main.current?.scrollTo({ top: 0 })
  }, [page])

  async function saveSettings(action: () => Promise<Preferences>, recheck = false) {
    setSettingsError('')
    try {
      setPreferences(await action())
      if (recheck) await detect()
    } catch (reason) {
      setSettingsError(errorText(reason))
    }
  }

  return (
    <MotionEnabledContext.Provider value={!reduced}>
      <SidebarProvider className="desktop-shell" style={{ '--sidebar-width': '13rem' } as CSSProperties} data-reduced={reduced}
        onDragOver={(event) => event.preventDefault()} onDrop={(event) => event.preventDefault()}>
        <header className="window-chrome">
          <div className="window-drag">
            {ready && <SidebarTrigger className="no-drag" aria-label="切换侧栏" />}
            <span className="window-brand"><Clapperboard className="size-4" />W3F7のVideo_Toolsbar</span>
          </div>
        </header>
        {ready ? <>
          <LayoutGroup>
            <Sidebar collapsible="icon" aria-label="功能侧栏">
              <SidebarContent className="pt-2">
                <SidebarGroup>
                  <SidebarMenu aria-label="起始页"><NavigationItem page="home" current={page} onNavigate={setPage} /></SidebarMenu>
                </SidebarGroup>
                <SidebarGroup>
                  <SidebarGroupLabel>Tools_list</SidebarGroupLabel>
                  <SidebarMenu aria-label="Tools_list"><NavigationItem page="cover" current={page} onNavigate={setPage} /></SidebarMenu>
                </SidebarGroup>
                <SidebarGroup>
                  <SidebarGroupLabel>About APP</SidebarGroupLabel>
                  <SidebarMenu aria-label="About APP"><NavigationItem page="changelog" current={page} onNavigate={setPage} /></SidebarMenu>
                </SidebarGroup>
                <SidebarGroup><SidebarGroupLabel>More</SidebarGroupLabel></SidebarGroup>
              </SidebarContent>
              <SidebarFooter className="pb-3">
                <SidebarMenu aria-label="应用">
                  <NavigationItem page="settings" current={page} onNavigate={setPage} />
                  <NavigationItem page="about" current={page} onNavigate={setPage} />
                </SidebarMenu>
              </SidebarFooter>
            </Sidebar>
          </LayoutGroup>

          <SidebarInset ref={main} className="desktop-main">
            <div className="workspace-container">
              {page === 'home' && <BlurFade><HomePage onOpenCover={() => setPage('cover')} onOpenLog={() => setPage('changelog')} /></BlurFade>}
              <BlurFade active={page === 'cover'}>
                <CoverPage active={page === 'cover'} engine={engine} preferences={preferences}
                  onChooseOutput={async () => { setPreferences(await api.chooseDirectory('outputDirectory')) }}
                  onOpenSettings={() => setPage('settings')} onRetry={() => void detect()} />
              </BlurFade>
              {page === 'changelog' && <BlurFade><ChangelogPage /></BlurFade>}
              {page === 'settings' && <BlurFade><SettingsPage preferences={preferences} engine={engine} error={settingsError}
                onSave={saveSettings} onRetry={() => void detect()} /></BlurFade>}
              {page === 'about' && <BlurFade><AboutPage /></BlurFade>}
            </div>
          </SidebarInset>
        </> : <Startup key={preferencesLoaded ? 'playing' : 'loading'} animated={preferencesLoaded && !reduced} />}
      </SidebarProvider>
    </MotionEnabledContext.Provider>
  )
}
