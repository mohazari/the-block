import { Link } from 'react-router'
import { useMyBids, useWatchlist } from '../../api/queries'
import type { VehicleSummary } from '../../api/types'
import { formatMoney } from '../../lib/format'
import { useServerNow } from '../../lib/serverClock'
import { VehicleRow } from '../inventory/VehicleRow'
import { groupMyBids } from './groupMyBids'

export function MyBidsView() {
  const now = useServerNow()
  const bids = useMyBids()
  const watched = useWatchlist()

  if (bids.isPending || watched.isPending) {
    return <p className="text-ink-muted">Loading your bids…</p>
  }
  if (bids.isError || watched.isError) {
    return (
      <div role="alert" className="text-center">
        <p className="font-semibold">Couldn't load your bids.</p>
        <button
          type="button"
          onClick={() => {
            void bids.refetch()
            void watched.refetch()
          }}
          className="btn btn-primary mt-3"
        >
          Try again
        </button>
      </div>
    )
  }

  const groups = groupMyBids(bids.data, watched.data, now)
  const empty = bids.data.length === 0 && groups.watching.length === 0

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">My bids</h1>
      <p className="text-ink-muted text-sm">
        Auctions you've bid on or are watching, sorted by what needs your attention.
      </p>

      {empty ? (
        <div className="border-line bg-surface mt-8 rounded-[var(--radius-panel)] border px-6 py-12 text-center">
          <h2 className="text-lg font-semibold">No bids or watched vehicles yet</h2>
          <p className="text-ink-muted mt-1">Bid on a vehicle or tap its star to follow it here.</p>
          <Link to="/" className="btn btn-primary mt-4">
            Browse the run list
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-10">
          <Group
            title="Outbid"
            hint="Still open. Bid again to get back in front."
            vehicles={groups.outbid}
            tone="text-outbid"
          />
          <Group
            title="Winning"
            hint="You're the high bidder."
            vehicles={groups.leading}
            tone="text-win"
          />
          <Group title="Watching" hint="Vehicles you've starred." vehicles={groups.watching} />
          <Group
            title="Finished"
            hint="Closed auctions you took part in."
            vehicles={groups.finished}
          />
        </div>
      )}
    </div>
  )
}

function Group({
  title,
  hint,
  vehicles,
  tone,
}: {
  title: string
  hint: string
  vehicles: (VehicleSummary & { my_top_bid?: number })[]
  tone?: string
}) {
  if (vehicles.length === 0) return null
  const id = `group-${title.toLowerCase()}`
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="flex items-baseline gap-2 text-lg font-semibold">
        <span className={tone}>{title}</span>
        <span className="text-ink-faint tabular text-base">{vehicles.length}</span>
      </h2>
      <p className="text-ink-muted mb-3 text-sm">{hint}</p>
      <div className="border-line overflow-hidden rounded-[var(--radius-panel)] border">
        {vehicles.map((vehicle) => (
          <VehicleRow
            key={vehicle.id}
            vehicle={vehicle}
            note={
              vehicle.my_top_bid !== undefined
                ? `Your top bid ${formatMoney(vehicle.my_top_bid)}`
                : undefined
            }
          />
        ))}
      </div>
    </section>
  )
}
