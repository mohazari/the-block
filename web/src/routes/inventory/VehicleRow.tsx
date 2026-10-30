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
 * Rows lay out by the width of their list, not the window's (container queries, sizes in
 * index.css), so they fit wherever they are: the run list beside the filters, My bids, or a page
 * narrowed by Lane's panel. From about 940px of list the run list is a table: one column per
 * fact, figures right-aligned, so prices and times line up down the list. Wider lists add
 * columns instead of stretching the gaps: odometer and reserve from about 1210px, location from
 * about 1460px (what the run list gets on 1280, 1600 and 1900px screens). Header and rows share
 * these.
 *
 *   row-table:  128 + vehicle + 144 + 128 + 136 + 40 (+ 5 gaps)              vehicle ≥ 264px
 *   row-wide:   136 + vehicle + 144 + 104 + 128 + 104 + 136 + 40 (+ 7)       vehicle ≥ 288px
 *   row-widest: 144 + vehicle + 152 + 104 + 176 + 136 + 104 + 144 + 40 (+ 8) vehicle ≥ 349px
 */
const TABLE_COLUMNS =
  '@row-table:grid-cols-[8rem_minmax(0,1fr)_9rem_8rem_8.5rem_2.5rem] @row-table:gap-x-4 @row-wide:grid-cols-[8.5rem_minmax(0,1fr)_9rem_6.5rem_8rem_6.5rem_8.5rem_2.5rem] @row-widest:grid-cols-[9rem_minmax(0,1fr)_9.5rem_6.5rem_11rem_8.5rem_6.5rem_9rem_2.5rem]'

/** Column labels over the run list's table layout (wide lists only). */
export function VehicleRowHeader() {
  return (
    <div
      aria-hidden
      className={cn(
        'border-line bg-surface text-ink-muted @row-table:grid sticky top-14 z-20 hidden rounded-t-[var(--radius-panel)] border-b px-3 py-2 text-xs',
        TABLE_COLUMNS,
      )}
    >
      <span />
      <span>Vehicle</span>
      <span>Condition</span>
      <span className="@row-wide:block hidden text-right">Odometer</span>
      <span className="@row-widest:block hidden">Location</span>
      <span className="text-right">Current bid</span>
      <span className="@row-wide:block hidden">Reserve</span>
      <span className="text-right">Ends</span>
      <span />
    </div>
  )
}

/**
 * One line of the run list: everything a buyer scans before deciding to open a car. Each fact is
 * rendered once and placed by grid areas: a compact card in a narrow list, two lines beside the
 * picture in a medium one, table columns in a wide one. The list must be an `@container`.
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
        "@row-split:grid-cols-[8.5rem_minmax(0,1fr)_9rem_2.5rem] @row-split:gap-x-4 @row-split:[grid-template-areas:'img_id_money_watch'_'img_cond_time_watch']",
        '@row-table:[grid-template-areas:none]',
        TABLE_COLUMNS,
        'hover:bg-surface-sunk/40 last:rounded-b-[var(--radius-panel)]',
        // Standing shows as a coloured edge so it reads while scanning down the list.
        'before:absolute before:inset-y-0 before:left-0 before:w-1',
        standing ? EDGE[standing] : 'before:bg-transparent',
        status === 'ended' && 'opacity-70',
      )}
    >
      <div className="@row-split:self-center @row-table:[grid-area:auto] self-start overflow-hidden rounded-[var(--radius-control)] [grid-area:img]">
        <CarIllustration
          bodyStyle={vehicle.body_style}
          paint={vehicle.exterior_color}
          className="aspect-[40/17] w-full"
        />
      </div>

      {/* Right padding on phones keeps text clear of the floating watch button. */}
      <div className="@row-split:pr-0 @row-table:self-center @row-table:[grid-area:auto] min-w-0 self-end pr-10 [grid-area:id]">
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
        <ul className="text-ink-muted @row-split:flex mt-1 hidden flex-wrap gap-x-3 text-sm">
          <li className="tabular @row-wide:hidden">{formatKm(vehicle.odometer_km)}</li>
          <li>{label(vehicle.drivetrain)}</li>
          <li>{label(vehicle.fuel_type)}</li>
          <li>{label(vehicle.transmission)}</li>
        </ul>
        <p className="text-ink-faint mt-0.5 truncate text-xs">
          <span className="tabular">Lot {vehicle.lot}</span>
          <span className="@row-widest:hidden">
            <span aria-hidden className="mx-1.5">
              /
            </span>
            {vehicle.city}, {vehicle.province}
          </span>
        </p>
        {note && <p className="text-ink-muted tabular mt-1 text-sm font-semibold">{note}</p>}
      </div>

      <p className="@row-split:self-auto @row-table:grid @row-table:grid-cols-[auto_1fr] @row-table:gap-y-0.5 @row-table:[grid-area:auto] flex items-center gap-2 self-start text-sm [grid-area:cond]">
        <LightDot light={light} />
        <span className="font-semibold">{LIGHT_LABEL[light]}</span>
        <span className="text-ink-muted tabular @row-table:col-start-2">
          Grade {vehicle.condition_grade.toFixed(1)}
        </span>
      </p>

      <p className="tabular @row-wide:block hidden text-right text-sm">
        {formatKm(vehicle.odometer_km)}
      </p>

      <p className="@row-widest:block hidden min-w-0 text-sm">
        <span className="block truncate">{vehicle.city}</span>
        <span className="text-ink-muted block truncate text-xs">{vehicle.province}</span>
      </p>

      <div className="@row-split:self-end @row-split:text-right @row-table:self-center @row-table:[grid-area:auto] self-end [grid-area:money]">
        <p className="text-ink-faint @row-table:sr-only text-xs">
          {hasBids ? 'Current bid' : 'Starting bid'}
        </p>
        <p className="tabular text-xl leading-tight font-bold">
          {formatMoney(auction.current_bid ?? auction.starting_bid)}
        </p>
        <p className="text-ink-muted text-sm">
          {hasBids ? plural(auction.bid_count, 'bid') : 'No bids yet'}
        </p>
        <p className="text-ink-muted @row-wide:hidden @row-split:block hidden text-xs">
          {RESERVE_TEXT[auction.reserve_status]}
        </p>
      </div>

      <p
        className={cn(
          '@row-wide:block hidden text-sm',
          auction.reserve_status === 'met' ? 'text-win font-semibold' : 'text-ink-muted',
        )}
      >
        {RESERVE_SHORT[auction.reserve_status]}
      </p>

      <div className="@row-split:self-start @row-table:self-center @row-table:[grid-area:auto] self-end text-right text-sm [grid-area:time]">
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
        '@row-split:relative @row-split:top-auto @row-split:right-auto @row-split:[grid-area:watch] @row-table:[grid-area:auto] absolute top-2 right-2 z-10 grid size-10 place-items-center rounded-full',
        vehicle.watching ? 'text-action' : 'text-ink-faint hover:text-ink',
      )}
    >
      <Star size={20} aria-hidden fill={vehicle.watching ? 'currentColor' : 'none'} />
    </button>
  )
}
