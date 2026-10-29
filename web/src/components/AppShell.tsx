import { Moon, Sun } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { useAuctionEvents } from '../api/liveEvents'
import { useMyBids } from '../api/queries'
import { useTheme } from '../app/theme'
import { needsAttention } from '../routes/mybids/groupMyBids'
import { useServerNow } from '../lib/serverClock'
import { ConnectionStatus } from './ConnectionStatus'
import { Toaster } from './toasts/Toaster'
import { cn } from '../lib/cn'

const navLink = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-full px-3 py-2 text-sm font-semibold transition-colors',
    // The current page is a neutral pill: blue is kept for things you can act on.
    isActive ? 'bg-surface-sunk text-ink' : 'text-ink-muted hover:text-ink',
  )

export function AppShell() {
  const [theme, toggleTheme] = useTheme()
  useAuctionEvents()

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="bg-surface sr-only z-50 rounded px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="border-line bg-surface sticky top-0 z-30 border-b">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:gap-4">
          <NavLink to="/" className="mr-auto flex items-center gap-2.5" aria-label="The Block home">
            <BlockMark />
            <span className="text-lg leading-none font-semibold tracking-tight">The Block</span>
            <span className="text-ink-faint hidden text-xs sm:inline">Live dealer auctions</span>
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
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <Toaster />
      <footer className="border-line text-ink-faint border-t py-4 text-center text-xs">
        Prototype for the OPENLANE coding challenge. Vehicles, bids and rival dealers are simulated.
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

/** The product's mark: a run list (three lots, the first one up) in OPENLANE Blue. */
function BlockMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-6 shrink-0">
      <rect width="24" height="24" rx="6" fill="var(--action)" />
      <rect x="5" y="6" width="14" height="3" rx="1.5" fill="var(--action-ink)" />
      <rect x="5" y="10.5" width="10" height="3" rx="1.5" fill="var(--action-ink)" opacity="0.7" />
      <rect x="5" y="15" width="7" height="3" rx="1.5" fill="var(--action-ink)" opacity="0.45" />
    </svg>
  )
}
