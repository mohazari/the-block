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
    'rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold transition-colors',
    isActive ? 'bg-action-soft text-action' : 'text-ink-muted hover:text-ink',
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
      <header className="border-line bg-surface/95 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:gap-4">
          <NavLink to="/" className="mr-auto flex items-baseline gap-2" aria-label="The Block home">
            <span className="font-display text-2xl leading-none font-bold tracking-tight">
              The Block
            </span>
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
            className="text-ink-muted hover:bg-surface-sunk hover:text-ink grid size-10 place-items-center rounded-[var(--radius-control)]"
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
