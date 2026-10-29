import type { BidOut } from '../../api/types'
import { cn } from '../../lib/cn'
import { formatMoney } from '../../lib/format'
import { useServerNow } from '../../lib/serverClock'

function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

export function BidHistory({ bids, total }: { bids: BidOut[]; total: number }) {
  const now = useServerNow()
  return (
    <section aria-labelledby="bid-history-heading" className="border-line border-t p-5">
      <h3 id="bid-history-heading" className="text-sm font-semibold">
        Recent bids
      </h3>
      {bids.length === 0 ? (
        <p className="text-ink-muted mt-2 text-sm">No bids yet. The starting bid opens it.</p>
      ) : (
        <ol className="divide-line mt-2 divide-y">
          {bids.map((bid, index) => (
            <li key={bid.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span className={cn('tabular font-semibold', index === 0 && 'text-ink')}>
                {formatMoney(bid.amount)}
              </span>
              <span
                className={cn(
                  'flex-1 truncate',
                  bid.is_you ? 'text-action font-semibold' : 'text-ink-muted',
                )}
              >
                {bid.is_you ? 'You' : bid.bidder}
              </span>
              <time dateTime={bid.placed_at} className="text-ink-faint text-xs">
                {ago(bid.placed_at, now)}
              </time>
            </li>
          ))}
        </ol>
      )}
      {total > bids.length && (
        <p className="text-ink-faint mt-1 text-xs">
          Showing the latest {bids.length} of {total} bids.
        </p>
      )}
    </section>
  )
}
