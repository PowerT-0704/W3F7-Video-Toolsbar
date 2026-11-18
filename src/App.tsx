import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import { Clapperboard, History, House, Info, Settings2 } from 'lucide-react'
import { LayoutGroup, motion } from 'motion/react'
import type { Page, Preferences, UpdateResult } from './bridge'
import { api, applyTheme, errorText, initialTheme, type EngineStatus } from './workspace'
import { AboutPage } from './pages/AboutPage'
import { ChangelogPage } from './pages/ChangelogPage'
import { CoverPage } from './pages/CoverPage'
import { HomePage, Startup } from './pages/HomePage'
import { SettingsPage } from './pages/SettingsPage'
import { StartupNotice } from './pages/StartupNotice'
import { useHoverSidebar } from './ui/hover-sidebar'
import { MotionEnabledContext, useMotionEnabled, useSystemReducedMotion } from './ui/motion-policy'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarInset, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, SidebarSeparator, SidebarTrigger, useSidebar,
} from './ui/shadcn/sidebar'

const defaultPreferences: Preferences = { toolDirectory: '', outputDirectory: '', cacheDirectory: '', reduceMotion: false, theme: initialTheme, welcomeSeen: false }
const pages = {
  home: { label: '起始页', icon: House },
  cover: { label: '视频封面封装', icon: Clapperboard },
  changelog: { label: '开发日志', icon: History },
  settings: { label: '设置', icon: Settings2 },
  about: { label: '关于', icon: Info },
} as const
type Navigation = { page: Page; outgoing?: { page: Page; style: CSSProperties } }

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
            initial={false} transition={{ type: 'spring', stiffness: 520, damping: 42 }} />
        )}
        <Icon /><span className="nav-label">{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function App() {
  const [navigation, setNavigation] = useState<Navigation>({ page: 'home' })
  const { page } = navigation
  const [preferences, setPreferences] = useState(defaultPreferences)
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)
  const [startupFinished, setStartupFinished] = useState(false)
  const [engine, setEngine] = useState<EngineStatus>({ kind: 'checking' })
  const [settingsError, setSettingsError] = useState('')
  const [notice, setNotice] = useState<'welcome' | 'animations'>()
  const [update, setUpdate] = useState<UpdateResult>()
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const startupChecked = useRef(false)
  const engineRevision = useRef(0)
  const main = useRef<HTMLElement>(null)
  const movePageFocus = useRef(false)
  const systemReduced = useSystemReducedMotion()
  const reduced = systemReduced || preferences.reduceMotion
  const outgoing = reduced ? undefined : navigation.outgoing
  const ready = preferencesLoaded && (startupFinished || reduced)
  const sidebar = useHoverSidebar()

  function dismissSidebarOnBackground(event: MouseEvent<HTMLElement>) {
    const target = event.target
    if (event.defaultPrevented || event.button !== 0 || !(target instanceof HTMLElement)) return
    if (target === event.currentTarget || target.matches('.workspace-container, .page-viewport, .page-transition, .page-layout, .page-header, .home-hero')) {
      sidebar.dismissPin()
    }
  }

  function navigate(next: Page) {
    if (next === page) return
    movePageFocus.current = sidebar.mobile || Boolean(main.current?.contains(document.activeElement))
    const surface = main.current?.querySelector('[data-page-state="active"] > .page-transition')
    if (reduced || !surface) {
      setNavigation({ page: next })
      return
    }
    const frame = getComputedStyle(surface)
    const style = {
      '--exit-opacity': frame.opacity,
      '--exit-transform': frame.transform,
      '--exit-filter': frame.filter,
    } as CSSProperties
    setNavigation({ page: next, outgoing: { page, style } })
  }

  const detect = useCallback(async () => {
    const revision = ++engineRevision.current
    setEngine({ kind: 'checking' })
    try {
      const { tools, inPath, message } = await api.detect()
      if (revision === engineRevision.current) setEngine(tools ? { kind: 'ready', tools, inPath } :
        { kind: 'missing', message: message || '未找到可用的 FFmpeg 和 FFprobe。', inPath })
    } catch (reason) {
      if (revision === engineRevision.current) setEngine({ kind: 'missing', message: errorText(reason), inPath: false })
    }
  }, [])

  const checkUpdates = useCallback(async () => {
    setCheckingUpdate(true)
    try { setUpdate(await api.checkUpdates()) }
    catch { setUpdate({ kind: 'error', message: '暂时无法检查更新，请稍后重试。' }) }
    finally { setCheckingUpdate(false) }
  }, [])

  useEffect(() => {
    if (!ready || startupChecked.current) return
    startupChecked.current = true
    if (!preferences.welcomeSeen) setNotice('welcome')
    else if (systemReduced) setNotice('animations')
    void checkUpdates()
  }, [ready, preferences.welcomeSeen, systemReduced, checkUpdates])

  async function dismissNotice() {
    if (notice === 'welcome') setPreferences(await api.completeWelcome())
    setNotice(undefined)
  }

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
    applyTheme(preferences.theme)
  }, [preferences.theme])

  useLayoutEffect(() => {
    const activePage = main.current?.querySelector<HTMLElement>('[data-page-state="active"]')
    activePage?.scrollTo({ top: 0 })
    if (movePageFocus.current) activePage?.focus({ preventScroll: true })
    movePageFocus.current = false
  }, [page])

  useEffect(() => {
    if (!navigation.outgoing) return
    const finish = () => setNavigation((current) => current === navigation ? { page } : current)
    if (reduced) {
      finish()
      return
    }
    // Also retire the old page when Chromium suspends animations in the background.
    const timeout = window.setTimeout(finish, 180)
    return () => window.clearTimeout(timeout)
  }, [navigation, page, reduced])

  async function saveSettings(action: () => Promise<Preferences>, recheck = false) {
    setSettingsError('')
    try {
      setPreferences(await action())
      if (recheck) await detect()
    } catch (reason) {
      setSettingsError(errorText(reason))
    }
  }

  const views = {
    home: <HomePage active={page === 'home'} onOpenCover={() => navigate('cover')} onOpenLog={() => navigate('changelog')} update={update} />,
    cover: <CoverPage active={page === 'cover'} engine={engine} preferences={preferences}
      onChooseOutput={async () => { setPreferences(await api.chooseDirectory('outputDirectory')) }}
      onOpenSettings={() => navigate('settings')} onRetry={() => void detect()} />,
    changelog: <ChangelogPage />,
    settings: <SettingsPage preferences={preferences} engine={engine} error={settingsError} systemReduced={systemReduced}
      onSave={saveSettings} onRetry={() => void detect()} onPreferences={setPreferences} />,
    about: <AboutPage update={update} checking={checkingUpdate} onCheck={checkUpdates} />,
  }

  return (
    <MotionEnabledContext.Provider value={!reduced}>
      <SidebarProvider className="desktop-shell" style={{ '--sidebar-width': '13rem' } as CSSProperties}
        open={sidebar.open} onOpenChange={sidebar.togglePin} data-reduced={reduced}
        onDragOver={(event) => event.preventDefault()} onDrop={(event) => event.preventDefault()}>
        <header className="window-chrome">
          <div className="window-drag">
            {ready && <SidebarTrigger className="no-drag" aria-label="切换侧栏"
              aria-pressed={sidebar.mobile ? undefined : sidebar.pinned}
              title={sidebar.mobile ? '打开侧栏' : sidebar.pinned ? '取消固定侧栏 (Ctrl+B)' : '固定展开侧栏 (Ctrl+B)'} />}
            <span className="window-brand"><Clapperboard className="size-4" />W3F7のVideo_Toolsbar</span>
          </div>
        </header>
        {ready ? <>
          <LayoutGroup>
            <Sidebar collapsible="icon" aria-label="功能侧栏" ref={sidebar.panel}
              onPointerEnter={sidebar.enter} onPointerLeave={sidebar.leave} onBlur={sidebar.blur}>
              <SidebarContent className="pt-2">
                <SidebarGroup>
                  <SidebarMenu aria-label="起始页"><NavigationItem page="home" current={page} onNavigate={navigate} /></SidebarMenu>
                </SidebarGroup>
                <SidebarSeparator />
                <SidebarGroup>
                  <SidebarGroupLabel>Tools_list</SidebarGroupLabel>
                  <SidebarMenu aria-label="Tools_list"><NavigationItem page="cover" current={page} onNavigate={navigate} /></SidebarMenu>
                </SidebarGroup>
                <SidebarSeparator />
                <SidebarGroup>
                  <SidebarGroupLabel>About APP</SidebarGroupLabel>
                  <SidebarMenu aria-label="About APP"><NavigationItem page="changelog" current={page} onNavigate={navigate} /></SidebarMenu>
                </SidebarGroup>
                <SidebarGroup><SidebarGroupLabel>More</SidebarGroupLabel></SidebarGroup>
              </SidebarContent>
              <SidebarFooter className="pb-3">
                <SidebarMenu aria-label="应用">
                  <NavigationItem page="settings" current={page} onNavigate={navigate} />
                  <NavigationItem page="about" current={page} onNavigate={navigate} />
                </SidebarMenu>
              </SidebarFooter>
            </Sidebar>
          </LayoutGroup>

          <SidebarInset ref={main} className="desktop-main" onClick={sidebar.pinned ? dismissSidebarOnBackground : undefined}>
            <div className="workspace-container">
              {(Object.keys(views) as Page[]).map((id) => {
                const phase = id === page ? 'active' : id === outgoing?.page ? 'exiting' : 'idle'
                if (phase === 'idle' && id !== 'cover') return null
                return (
                  <div key={id} className="page-viewport" data-page={id} data-page-state={phase}
                    hidden={phase === 'idle'} inert={phase !== 'active'} tabIndex={-1}>
                    <div className="page-transition" data-motion={!reduced} style={phase === 'exiting' ? outgoing?.style : undefined}>
                      {views[id]}
                    </div>
                  </div>
                )
              })}
            </div>
          </SidebarInset>
          {notice && <StartupNotice mode={notice} systemReduced={systemReduced} engine={engine}
            customTools={Boolean(preferences.toolDirectory)} onClose={dismissNotice}
            onSettings={async () => { await dismissNotice(); navigate('settings') }} />}
        </> : <Startup key={preferencesLoaded ? 'playing' : 'loading'} animated={preferencesLoaded && !reduced} />}
      </SidebarProvider>
    </MotionEnabledContext.Provider>
  )
}
