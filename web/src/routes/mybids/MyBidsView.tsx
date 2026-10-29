import { Link } from 'react-router'
import { useInventory, useMyBids } from '../../api/queries'
import type { InventoryQuery, VehicleSummary } from '../../api/types'
import { formatMoney } from '../../lib/format'
import { useServerNow } from '../../lib/serverClock'
import { VehicleRow } from '../inventory/VehicleRow'
import { groupMyBids } from './groupMyBids'

const WATCHED: InventoryQuery = {
  watching: true,
  status: ['live', 'upcoming', 'ended'],
  page_size: 100,
}

export function MyBidsView() {
  const now = useServerNow()
  const bids = useMyBids()
  const watched = useInventory(WATCHED)

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
          className="bg-action text-action-ink mt-3 h-10 rounded-[var(--radius-control)] px-4 font-semibold"
        >
          Try again
        </button>
      </div>
    )
  }

  const groups = groupMyBids(bids.data, watched.data.items, now)
  const empty = bids.data.length === 0 && groups.watching.length === 0

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-display text-3xl font-bold tracking-tight">My bids</h1>
      <p className="text-ink-muted text-sm">
        Auctions you've bid on or are watching, sorted by what needs your attention.
      </p>

      {empty ? (
        <div className="border-line bg-surface mt-8 rounded-[var(--radius-panel)] border px-6 py-12 text-center">
          <h2 className="font-display text-2xl font-bold">No bids or watched vehicles yet</h2>
          <p className="text-ink-muted mt-1">Bid on a vehicle or tap its star to follow it here.</p>
          <Link
            to="/"
            className="bg-action text-action-ink hover:bg-action-hover mt-4 inline-block rounded-[var(--radius-control)] px-4 py-2 font-semibold"
          >
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
          <Group
            title="Watching"
            hint={
              watched.data.total > watched.data.items.length
                ? `Vehicles you've starred. Showing the first ${watched.data.items.length} of ${watched.data.total}.`
                : "Vehicles you've starred."
            }
            vehicles={groups.watching}
          />
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
      <h2 id={id} className="font-display flex items-baseline gap-2 text-2xl font-bold">
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
