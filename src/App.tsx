import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Clapperboard, Info, Settings2 } from 'lucide-react'
import type { Page, Preferences } from './bridge'
import { api, errorText, type EngineStatus } from './workspace'
import { AboutPage } from './pages/AboutPage'
import { CoverPage } from './pages/CoverPage'
import { SettingsPage } from './pages/SettingsPage'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarInset, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from './ui/shadcn/sidebar'

const defaultPreferences: Preferences = { toolDirectory: '', outputDirectory: '', reduceMotion: false }
const pages = {
  cover: { label: '视频封面封装', icon: Clapperboard },
  settings: { label: '设置', icon: Settings2 },
  about: { label: '关于', icon: Info },
} as const

function NavigationItem({ page, current, onNavigate }: { page: Page; current: Page; onNavigate: (page: Page) => void }) {
  const { label, icon: Icon } = pages[page]
  const { isMobile, setOpenMobile } = useSidebar()
  function navigate() {
    onNavigate(page)
    if (isMobile) setOpenMobile(false)
  }
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={page === current} aria-current={page === current ? 'page' : undefined}
        tooltip={label} aria-label={label} onClick={navigate}>
        <Icon /><span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function App() {
  const [page, setPage] = useState<Page>('cover')
  const [preferences, setPreferences] = useState(defaultPreferences)
  const [engine, setEngine] = useState<EngineStatus>({ kind: 'checking' })
  const [settingsError, setSettingsError] = useState('')
  const engineRevision = useRef(0)

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
    void detect()
  }, [detect])

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
    <SidebarProvider className="desktop-shell" style={{ '--sidebar-width': '13rem' } as CSSProperties} data-reduced={preferences.reduceMotion}
      onDragOver={(event) => event.preventDefault()} onDrop={(event) => event.preventDefault()}>
      <header className="window-chrome">
        <div className="window-drag">
          <SidebarTrigger className="no-drag" aria-label="切换侧栏" />
          <span className="window-brand"><Clapperboard className="size-4" />W3F7のVideo_Toolsbar</span>
        </div>
      </header>
      <Sidebar collapsible="icon" aria-label="功能侧栏">
        <SidebarContent className="px-2 pt-2">
          <SidebarMenu aria-label="工具">
            <NavigationItem page="cover" current={page} onNavigate={setPage} />
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="pb-3">
          <SidebarMenu aria-label="应用">
            <NavigationItem page="settings" current={page} onNavigate={setPage} />
            <NavigationItem page="about" current={page} onNavigate={setPage} />
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="desktop-main">
        <div className="workspace-container">
          <div hidden={page !== 'cover'}>
            <CoverPage engine={engine} preferences={preferences}
              onChooseOutput={async () => { setPreferences(await api.chooseDirectory('outputDirectory')) }}
              onOpenSettings={() => setPage('settings')} onRetry={() => void detect()} />
          </div>
          {page === 'settings' && <SettingsPage preferences={preferences} engine={engine} error={settingsError}
            onSave={saveSettings} onRetry={() => void detect()} />}
          {page === 'about' && <AboutPage />}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
