import { Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Capacitor } from '@capacitor/core'
import { useMediaQuery } from '../hooks/useMediaQuery'
import BottomTabBar from './BottomTabBar'
import TopNavBar from './TopNavBar'
import PageTransition from './PageTransition'
import SyncToastHost from './SyncToastHost'

const DESKTOP_BREAKPOINT = '(min-width: 1024px)'
const isNative = Capacitor.isNativePlatform()

function AppShell() {
  const isDesktop = useMediaQuery(DESKTOP_BREAKPOINT)
  const location = useLocation()

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-forest text-cream">
      <SyncToastHost />
      {isDesktop && <TopNavBar />}

      <main className="flex-1 overflow-y-auto pt-safe-top pb-tab-bar lg:pb-safe-bottom">
        <div className="container mx-auto px-4 py-6 lg:py-8">
          {isNative ? (
            <PageTransition key={location.pathname}>
              <Outlet />
            </PageTransition>
          ) : (
            <AnimatePresence mode="wait">
              <PageTransition key={location.pathname || location.key}>
                <Outlet />
              </PageTransition>
            </AnimatePresence>
          )}
        </div>
      </main>

      {!isDesktop && <BottomTabBar />}
    </div>
  )
}

export default AppShell
