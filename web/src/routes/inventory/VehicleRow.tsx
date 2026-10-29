import { Star } from 'lucide-react'
import { Link } from 'react-router'
import { useWatch } from '../../api/queries'
import type { VehicleSummary } from '../../api/types'
import { AuctionClock } from '../../components/auction/AuctionClock'
import { ConditionLight } from '../../components/auction/ConditionLight'
import { StandingTag } from '../../components/auction/StandingTag'
import { CarIllustration } from '../../components/CarIllustration'
import { RESERVE_TEXT, standingAt, statusAt } from '../../lib/auction'
import { cn } from '../../lib/cn'
import { formatKm, formatMoney, label, plural } from '../../lib/format'
import { useServerNow } from '../../lib/serverClock'
import { vehicleName } from '../../lib/vehicle'

const EDGE = {
  leading: 'before:bg-win',
  won: 'before:bg-win',
  outbid: 'before:bg-outbid',
  lost: 'before:bg-transparent',
} as const

/** One line of the run list: everything a buyer scans before deciding to open a car. */
/** `note` adds a line under the condition light, e.g. "Your top bid $23,300" on My bids. */
export function VehicleRow({ vehicle, note }: { vehicle: VehicleSummary; note?: string }) {
  const now = useServerNow()
  const { auction } = vehicle
  const status = statusAt(auction, now)
  const standing = standingAt(auction, status)
  const hasBids = auction.current_bid !== null
  const name = vehicleName(vehicle)

  return (
    <article
      aria-label={name}
      className={cn(
        'group border-line bg-surface relative grid grid-cols-[104px_1fr] gap-x-3 gap-y-2 border-b p-3',
        'sm:grid-cols-[168px_1fr] sm:gap-x-4 lg:grid-cols-[168px_minmax(0,1fr)_170px_150px_44px] lg:items-center',
        'hover:bg-surface-sunk/40',
        // Standing shows as a coloured edge so it reads while scanning down the list.
        'before:absolute before:inset-y-0 before:left-0 before:w-1',
        standing ? EDGE[standing] : 'before:bg-transparent',
        status === 'ended' && 'opacity-70',
      )}
    >
      <div className="overflow-hidden rounded-[var(--radius-control)] sm:row-span-2 lg:row-span-1">
        <CarIllustration
          bodyStyle={vehicle.body_style}
          paint={vehicle.exterior_color}
          className="aspect-[40/17] w-full"
        />
      </div>

      {/* Right padding on small screens keeps text clear of the floating watch button. */}
      <div className="min-w-0 pr-10 lg:pr-0">
        <p className="text-ink-faint tabular truncate text-xs">
          Lot {vehicle.lot} <span aria-hidden>/</span> {vehicle.city}, {vehicle.province}
        </p>
        <h3 className="font-display truncate text-xl leading-tight font-semibold">
          {/* Stretched link: the whole row opens the vehicle, with one link for screen readers. */}
          <Link
            to={`/vehicles/${vehicle.id}`}
            state={{ fromRunList: true }}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-[var(--focus)]"
          >
            {name}
          </Link>
        </h3>
        <p className="text-ink-muted truncate text-sm">{vehicle.trim}</p>
        <ul className="text-ink-muted mt-1.5 hidden flex-wrap gap-x-3 gap-y-1 text-sm sm:flex">
          <li className="tabular">{formatKm(vehicle.odometer_km)}</li>
          <li>{label(vehicle.drivetrain)}</li>
          <li>{label(vehicle.fuel_type)}</li>
          <li>{label(vehicle.transmission)}</li>
        </ul>
        <ConditionLight
          title_status={vehicle.title_status}
          worst_damage={vehicle.worst_damage}
          condition_grade={vehicle.condition_grade}
          className="mt-2"
        />
        {note && <p className="text-ink-muted tabular mt-1 text-sm font-semibold">{note}</p>}
      </div>

      <div className="col-span-2 flex flex-wrap items-baseline justify-between gap-x-3 sm:col-span-1 sm:col-start-2 lg:col-start-auto lg:block lg:text-right">
        <div>
          <p className="text-ink-faint text-xs">{hasBids ? 'Current bid' : 'Starting bid'}</p>
          <p className="font-display tabular text-2xl leading-none font-bold">
            {formatMoney(auction.current_bid ?? auction.starting_bid)}
          </p>
        </div>
        <p className="text-ink-muted text-sm">
          {hasBids ? plural(auction.bid_count, 'bid') : 'No bids yet'}
          <span className="hidden lg:block">{RESERVE_TEXT[auction.reserve_status]}</span>
        </p>
      </div>

      <div className="col-span-2 flex items-center justify-between gap-2 text-sm sm:col-span-1 sm:col-start-2 lg:col-start-auto lg:block lg:text-right">
        <AuctionClock auction={auction} className="block" />
        <StandingTag standing={standing} className="lg:mt-1" />
      </div>

      <WatchButton vehicle={vehicle} name={name} />
    </article>
  )
}

function WatchButton({ vehicle, name }: { vehicle: VehicleSummary; name: string }) {
  const watch = useWatch()
  return (
    <button
      type="button"
      aria-pressed={vehicle.watching}
      aria-label={vehicle.watching ? `Stop watching ${name}` : `Watch ${name}`}
      onClick={() => watch.mutate({ vehicleId: vehicle.id, watching: !vehicle.watching })}
      className={cn(
        'absolute top-2 right-2 z-10 grid size-10 place-items-center rounded-[var(--radius-control)] lg:relative lg:top-auto lg:right-auto',
        vehicle.watching ? 'text-action' : 'text-ink-faint hover:text-ink',
      )}
    >
      <Star size={20} aria-hidden fill={vehicle.watching ? 'currentColor' : 'none'} />
    </button>
  )
}
