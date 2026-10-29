import { useConnection } from '../api/liveEvents'
import { cn } from '../lib/cn'

/** Prices on screen are only trustworthy while the live stream is up, so say when it isn't. */
export function ConnectionStatus() {
  const connection = useConnection()
  const live = connection === 'live'
  return (
    <span
      role="status"
      aria-label={`Live updates: ${live ? 'connected' : 'reconnecting'}`}
      className={cn(
        'hidden items-center gap-1.5 text-xs sm:inline-flex',
        live ? 'text-ink-faint' : 'text-caution',
      )}
    >
      <span
        aria-hidden
        className={cn('size-2 rounded-full', live ? 'bg-win' : 'bg-caution-bright animate-pulse')}
      />
      {live ? 'Live' : connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
    </span>
  )
}
