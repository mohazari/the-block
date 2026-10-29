import type { AuctionSnapshot } from '../../api/types'
import { ENDING_SOON_MS, statusAt } from '../../lib/auction'
import { cn } from '../../lib/cn'
import { formatClockTime, formatDuration, label } from '../../lib/format'
import { useServerNow } from '../../lib/serverClock'

type Props = {
  auction: Pick<AuctionSnapshot, 'starts_at' | 'ends_at' | 'outcome'>
  className?: string
}

/** "Ends in 3h 12m" · "Opens Thu 2:00 p.m." · "Sold" — ticking on the server's clock. */
export function AuctionClock({ auction, className }: Props) {
  const now = useServerNow()
  const status = statusAt(auction, now)

  if (status === 'upcoming') {
    return (
      <span className={cn('text-ink-muted', className)}>
        Opens <time dateTime={auction.starts_at}>{formatClockTime(auction.starts_at)}</time>
      </span>
    )
  }
  if (status === 'ended') {
    return (
      <span className={cn('text-ink-muted', className)}>
        {auction.outcome ? label(auction.outcome) : 'Ended'}
      </span>
    )
  }
  const remaining = Date.parse(auction.ends_at) - now
  return (
    <span className={cn(remaining < ENDING_SOON_MS && 'text-caution font-semibold', className)}>
      Ends in{' '}
      <time dateTime={auction.ends_at} className="tabular">
        {formatDuration(remaining)}
      </time>
    </span>
  )
}
