import { Link } from 'react-router'
import { withNewestSeen } from '../../api/auctionLedger'
import type { LanePick } from '../../api/types'
import { LIGHT_LABEL, conditionLight } from '../../lib/condition'
import { formatKm, formatMoney } from '../../lib/format'
import { useServerNow } from '../../lib/serverClock'
import { vehicleName } from '../../lib/vehicle'
import { AuctionClock } from '../auction/AuctionClock'
import { LightDot } from '../auction/ConditionLight'
import { CarIllustration } from '../CarIllustration'

/**
 * One car Lane recommends: the facts it's judged on, live from the auction, and Lane's reason.
 * The whole card opens the vehicle.
 */
export function LanePickCard({ pick, onOpen }: { pick: LanePick; onOpen?: () => void }) {
  // The reply carries the car as it was when Lane answered; live events since (a rival's bid, a
  // close pushed back, a sale) are in the ledger. The server clock's tick re-reads it each second.
  useServerNow()
  const { reason } = pick
  const vehicle = withNewestSeen(pick.vehicle)
  const { auction } = vehicle
  const name = vehicleName(vehicle)
  const light = conditionLight(vehicle)
  const price = auction.current_bid ?? auction.starting_bid

  return (
    <article
      aria-label={name}
      className="border-line bg-surface hover:bg-surface-sunk/40 relative grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-[var(--radius-panel)] border p-3"
    >
      <div className="overflow-hidden rounded-[var(--radius-control)]">
        <CarIllustration
          bodyStyle={vehicle.body_style}
          paint={vehicle.exterior_color}
          className="aspect-[40/17] w-full"
        />
      </div>
      <div className="min-w-0">
        <h3 className="truncate text-sm leading-snug font-semibold">
          {/* Stretched link: the card opens the vehicle, with one link for screen readers. */}
          <Link
            to={`/vehicles/${vehicle.id}`}
            onClick={onOpen}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-[var(--radius-panel)] focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-[var(--focus)]"
          >
            {name}
          </Link>
        </h3>
        <p className="text-ink-muted flex gap-x-2 text-xs">
          <span className="truncate">{vehicle.trim}</span>
          <span className="tabular shrink-0">{formatKm(vehicle.odometer_km)}</span>
        </p>
        <p className="text-ink-muted mt-1 flex items-center gap-1.5 text-xs">
          <LightDot light={light} />
          <span>{LIGHT_LABEL[light]}</span>
          <span className="tabular">Grade {vehicle.condition_grade.toFixed(1)}</span>
        </p>
      </div>
      <div className="col-span-2 flex items-baseline justify-between gap-3 text-sm">
        <span>
          <span className="tabular font-bold">{formatMoney(price)}</span>{' '}
          <span className="text-ink-faint text-xs">
            {auction.current_bid === null ? 'starting bid' : 'current bid'}
          </span>
        </span>
        <AuctionClock auction={auction} className="text-xs" />
      </div>
      <p className="text-ink-muted col-span-2 text-sm">{reason}</p>
    </article>
  )
}
