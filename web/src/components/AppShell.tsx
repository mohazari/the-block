import { Moon, Sun } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { useAuctionEvents } from '../api/liveEvents'
import { useMyBids } from '../api/queries'
import { useTheme } from '../app/theme'
import { needsAttention } from '../routes/mybids/groupMyBids'
import { useServerNow } from '../lib/serverClock'
import { ConnectionStatus } from './ConnectionStatus'
import { LaneButton, LanePanel } from './lane/LanePanel'
import { LaneProvider } from './lane/LaneProvider'
import { useLane } from './lane/laneState'
import { Toaster } from './toasts/Toaster'
import { MARK } from './blockMark'
import { cn } from '../lib/cn'

const navLink = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-full px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors',
    // The current page is a neutral pill: blue is kept for things you can act on.
    isActive ? 'bg-surface-sunk text-ink' : 'text-ink-muted hover:text-ink',
  )

export function AppShell() {
  return (
    <LaneProvider>
      <Shell />
      <LanePanel />
    </LaneProvider>
  )
}

function Shell() {
  const [theme, toggleTheme] = useTheme()
  const { open: laneOpen } = useLane()
  useAuctionEvents()

  return (
    // Lane docks on the right from 1280px: the page makes room for it instead of hiding under it.
    <div className={cn('flex min-h-dvh flex-col', laneOpen && 'xl:pr-[var(--lane-width)]')}>
      <a
        href="#main"
        className="bg-surface sr-only z-50 rounded px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="border-line bg-surface sticky top-0 z-30 border-b">
        <div className="frame flex h-14 items-center gap-2 sm:gap-4">
          <NavLink to="/" className="mr-auto flex items-center gap-2.5" aria-label="The Block home">
            <BlockMark />
            <span className="text-lg leading-none font-semibold tracking-tight whitespace-nowrap">
              The Block
            </span>
            <span
              className={cn(
                'text-ink-faint hidden text-xs whitespace-nowrap',
                // With Lane docked the header is narrower: the tagline goes first.
                laneOpen ? '2xl:inline' : 'sm:inline',
              )}
            >
              Live dealer auctions
            </span>
          </NavLink>
          <nav aria-label="Main" className="flex items-center gap-1">
            <NavLink to="/" end className={navLink}>
              Inventory
            </NavLink>
            <NavLink to="/my-bids" className={navLink}>
              My bids
              <AttentionBadge />
            </NavLink>
          </nav>
          <ConnectionStatus />
          <LaneButton />
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="text-ink-muted hover:bg-surface-sunk hover:text-ink grid size-10 place-items-center rounded-full"
          >
            {theme === 'dark' ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
          </button>
        </div>
      </header>
      <main id="main" className="frame flex-1 py-6">
        <Outlet />
      </main>
      <Toaster />
      <footer className="border-line text-ink-faint border-t text-xs">
        <p className="frame py-4">
          Prototype for the OPENLANE coding challenge. Vehicles, bids and rival dealers are
          simulated.
        </p>
      </footer>
    </div>
  )
}

/** How many open auctions you've been outbid on: the thing to act on next. */
function AttentionBadge() {
  const now = useServerNow()
  const { data } = useMyBids()
  const count = data ? needsAttention(data, now) : 0
  if (count === 0) return null
  return (
    <span className="bg-outbid tabular ml-1.5 inline-grid min-w-5 place-items-center rounded-full px-1 text-xs leading-5 font-bold text-white">
      {count}
      <span className="sr-only"> outbid</span>
    </span>
  )
}

/**
 * The product's mark (geometry in blockMark.ts). It follows the theme here; the tab's copy stays
 * OPENLANE Blue, since a favicon can't see the app's theme.
 */
function BlockMark() {
  return (
    <svg viewBox={MARK.viewBox} aria-hidden className="size-6 shrink-0">
      <rect width="24" height="24" rx={MARK.tileRadius} fill="var(--action)" />
      <path d={MARK.block} stroke="var(--action-ink)" strokeWidth={MARK.stroke} fill="none" />
      <path
        d={MARK.bar}
        stroke="var(--action-ink)"
        strokeWidth={MARK.stroke}
        strokeLinecap="round"
        opacity={MARK.barOpacity}
      />
    </svg>
  )
}
