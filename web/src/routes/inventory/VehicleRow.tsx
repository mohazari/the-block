import { Star } from 'lucide-react'
import { Link } from 'react-router'
import { useWatch } from '../../api/queries'
import type { VehicleSummary } from '../../api/types'
import { AuctionClock } from '../../components/auction/AuctionClock'
import { LightDot } from '../../components/auction/ConditionLight'
import { StandingTag } from '../../components/auction/StandingTag'
import { CarIllustration } from '../../components/CarIllustration'
import { RESERVE_TEXT, standingAt, statusAt } from '../../lib/auction'
import { cn } from '../../lib/cn'
import { LIGHT_LABEL, conditionLight } from '../../lib/condition'
import { formatKm, formatMoney, label, plural } from '../../lib/format'
import { useServerNow } from '../../lib/serverClock'
import { vehicleName } from '../../lib/vehicle'

const EDGE = {
  leading: 'before:bg-win',
  won: 'before:bg-win',
  outbid: 'before:bg-outbid',
  lost: 'before:bg-transparent',
} as const

/** The reserve column's header already says "Reserve". */
const RESERVE_SHORT = { met: 'Met', not_met: 'Not met', no_reserve: 'None' } as const

/*
 * From 1280px the run list is a table: one column per fact, figures right-aligned, so prices
 * and times line up down the list. Wider screens add columns instead of stretching the gaps:
 * odometer and reserve from 1600px, location from 1900px. Header and rows share these.
 *
 *   1280: 128 + vehicle + 144 + 128 + 136 + 40 (+ 5 gaps)            vehicle ≥ 264px
 *   1600: 136 + vehicle + 144 + 104 + 128 + 104 + 136 + 40 (+ 7)     vehicle ≥ 288px
 *   1900: 144 + vehicle + 152 + 104 + 176 + 136 + 104 + 144 + 40 (+ 8) vehicle ≥ 349px
 */
const TABLE_COLUMNS =
  'xl:grid-cols-[8rem_minmax(0,1fr)_9rem_8rem_8.5rem_2.5rem] xl:gap-x-4 3xl:grid-cols-[8.5rem_minmax(0,1fr)_9rem_6.5rem_8rem_6.5rem_8.5rem_2.5rem] 4xl:grid-cols-[9rem_minmax(0,1fr)_9.5rem_6.5rem_11rem_8.5rem_6.5rem_9rem_2.5rem]'

/** Column labels over the run list's table layout (1280px and up). */
export function VehicleRowHeader() {
  return (
    <div
      aria-hidden
      className={cn(
        'border-line bg-surface text-ink-muted sticky top-14 z-20 hidden rounded-t-[var(--radius-panel)] border-b px-3 py-2 text-xs xl:grid',
        TABLE_COLUMNS,
      )}
    >
      <span />
      <span>Vehicle</span>
      <span>Condition</span>
      <span className="3xl:block hidden text-right">Odometer</span>
      <span className="4xl:block hidden">Location</span>
      <span className="text-right">Current bid</span>
      <span className="3xl:block hidden">Reserve</span>
      <span className="text-right">Ends</span>
      <span />
    </div>
  )
}

/**
 * One line of the run list: everything a buyer scans before deciding to open a car. Each fact is
 * rendered once and placed by grid areas: a compact card on phones, two lines beside the picture
 * on tablets, table columns from 1280px.
 * `note` adds a line under the vehicle, e.g. "Your top bid $23,300" on My bids.
 */
export function VehicleRow({ vehicle, note }: { vehicle: VehicleSummary; note?: string }) {
  const now = useServerNow()
  const { auction } = vehicle
  const status = statusAt(auction, now)
  const standing = standingAt(auction, status)
  const hasBids = auction.current_bid !== null
  const name = vehicleName(vehicle)
  const light = conditionLight(vehicle)

  return (
    <article
      aria-label={name}
      className={cn(
        'group border-line bg-surface relative grid items-center gap-x-3 gap-y-2 border-b p-3 last:border-b-0',
        // Phones: picture and name, the condition under the name, then price and time.
        "grid-cols-[6rem_minmax(0,1fr)_auto] [grid-template-areas:'img_id_id'_'img_cond_cond'_'money_money_time']",
        // Tablets: the money and the clock in a right-hand column.
        "sm:grid-cols-[8.5rem_minmax(0,1fr)_9rem_2.5rem] sm:gap-x-4 sm:[grid-template-areas:'img_id_money_watch'_'img_cond_time_watch']",
        'xl:[grid-template-areas:none]',
        TABLE_COLUMNS,
        'hover:bg-surface-sunk/40 last:rounded-b-[var(--radius-panel)]',
        // Standing shows as a coloured edge so it reads while scanning down the list.
        'before:absolute before:inset-y-0 before:left-0 before:w-1',
        standing ? EDGE[standing] : 'before:bg-transparent',
        status === 'ended' && 'opacity-70',
      )}
    >
      <div className="self-start overflow-hidden rounded-[var(--radius-control)] [grid-area:img] sm:self-center xl:[grid-area:auto]">
        <CarIllustration
          bodyStyle={vehicle.body_style}
          paint={vehicle.exterior_color}
          className="aspect-[40/17] w-full"
        />
      </div>

      {/* Right padding on phones keeps text clear of the floating watch button. */}
      <div className="min-w-0 self-end pr-10 [grid-area:id] sm:pr-0 xl:self-center xl:[grid-area:auto]">
        <h3 className="truncate text-base leading-snug font-semibold">
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
        <ul className="text-ink-muted mt-1 hidden flex-wrap gap-x-3 text-sm sm:flex">
          <li className="tabular 3xl:hidden">{formatKm(vehicle.odometer_km)}</li>
          <li>{label(vehicle.drivetrain)}</li>
          <li>{label(vehicle.fuel_type)}</li>
          <li>{label(vehicle.transmission)}</li>
        </ul>
        <p className="text-ink-faint mt-0.5 truncate text-xs">
          <span className="tabular">Lot {vehicle.lot}</span>
          <span className="4xl:hidden">
            <span aria-hidden className="mx-1.5">
              /
            </span>
            {vehicle.city}, {vehicle.province}
          </span>
        </p>
        {note && <p className="text-ink-muted tabular mt-1 text-sm font-semibold">{note}</p>}
      </div>

      <p className="flex items-center gap-2 self-start text-sm [grid-area:cond] sm:self-auto xl:grid xl:grid-cols-[auto_1fr] xl:gap-y-0.5 xl:[grid-area:auto]">
        <LightDot light={light} />
        <span className="font-semibold">{LIGHT_LABEL[light]}</span>
        <span className="text-ink-muted tabular xl:col-start-2">
          Grade {vehicle.condition_grade.toFixed(1)}
        </span>
      </p>

      <p className="tabular 3xl:block hidden text-right text-sm">{formatKm(vehicle.odometer_km)}</p>

      <p className="4xl:block hidden min-w-0 text-sm">
        <span className="block truncate">{vehicle.city}</span>
        <span className="text-ink-muted block truncate text-xs">{vehicle.province}</span>
      </p>

      <div className="self-end [grid-area:money] sm:self-end sm:text-right xl:self-center xl:[grid-area:auto]">
        <p className="text-ink-faint text-xs xl:sr-only">
          {hasBids ? 'Current bid' : 'Starting bid'}
        </p>
        <p className="tabular text-xl leading-tight font-bold">
          {formatMoney(auction.current_bid ?? auction.starting_bid)}
        </p>
        <p className="text-ink-muted text-sm">
          {hasBids ? plural(auction.bid_count, 'bid') : 'No bids yet'}
        </p>
        <p className="text-ink-muted 3xl:hidden hidden text-xs sm:block">
          {RESERVE_TEXT[auction.reserve_status]}
        </p>
      </div>

      <p
        className={cn(
          '3xl:block hidden text-sm',
          auction.reserve_status === 'met' ? 'text-win font-semibold' : 'text-ink-muted',
        )}
      >
        {RESERVE_SHORT[auction.reserve_status]}
      </p>

      <div className="self-end text-right text-sm [grid-area:time] sm:self-start xl:self-center xl:[grid-area:auto]">
        <AuctionClock auction={auction} className="block" />
        <StandingTag standing={standing} className="mt-1" />
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
        'absolute top-2 right-2 z-10 grid size-10 place-items-center rounded-full sm:relative sm:top-auto sm:right-auto sm:[grid-area:watch] xl:[grid-area:auto]',
        vehicle.watching ? 'text-action' : 'text-ink-faint hover:text-ink',
      )}
    >
      <Star size={20} aria-hidden fill={vehicle.watching ? 'currentColor' : 'none'} />
    </button>
  )
}
