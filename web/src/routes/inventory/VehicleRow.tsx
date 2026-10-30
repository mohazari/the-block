import { Star } from 'lucide-react'
import { Link, useMatch } from 'react-router'
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

/*
 * Rows lay out by the width of their list, not the window's (container queries, sizes in
 * index.css), so they fit wherever they are: the inventory beside the filters, My bids, or a page
 * narrowed by Lane's panel. From about 940px of list the inventory is a table, and wider lists add
 * columns instead of stretching the gaps: odometer from about 1210px, location from about 1460px
 * (what the inventory gets on 1280, 1600 and 1900px screens). Header and rows share these.
 *
 * Only the vehicle column stretches; every other column is sized to its content, with the same
 * 32px between all of them. Text columns (condition, location) sit left and figures (odometer,
 * price, time) right, so like alignments sit together: a right-aligned figure against
 * left-aligned text reads as one phrase. The reserve sits under the price it qualifies.
 *
 *   row-table:  128 + vehicle + 120 + 112 + 144 + 40 (+ 5 × 32, + 24 row padding)  vehicle ≥ 208px
 *   row-wide:   + odometer 104 (+ 32)                                              vehicle ≥ 344px
 *   row-widest: + location 144 (+ 32)                                              vehicle ≥ 424px
 * The time column fits "Opens Thu 12:00 p.m." for upcoming auctions.
 */
const TABLE_COLUMNS =
  '@row-table:grid-cols-[8rem_minmax(0,1fr)_7.5rem_7rem_9rem_2.5rem] @row-table:gap-x-8 @row-wide:grid-cols-[8rem_minmax(0,1fr)_7.5rem_6.5rem_7rem_9rem_2.5rem] @row-widest:grid-cols-[8rem_minmax(0,1fr)_7.5rem_9rem_6.5rem_7rem_9rem_2.5rem]'

/** Column labels over the inventory's table layout (wide lists only). */
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
      <span className="@row-widest:block hidden">Location</span>
      <span className="@row-wide:block hidden text-right">Odometer</span>
      <span className="text-right">Current bid</span>
      <span className="text-right">Ends</span>
      <span />
    </div>
  )
}

/**
 * One line of the inventory: everything a buyer scans before deciding to open a car. Each fact is
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
  // The vehicle page's "Inventory" link goes back (keeping filters and page) only from here.
  const onInventory = useMatch('/') !== null

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
        {/* In the table the trim joins the name line, to keep rows short. It sits beside the
            heading, not in it, so the car's accessible name stays its name; when the line is
            tight the trim gives way first. */}
        <div className="@row-table:flex @row-table:gap-1.5 min-w-0 items-baseline">
          <h3 className="min-w-0 truncate text-base leading-snug font-semibold">
            {/* Stretched link: the whole row opens the vehicle, with one link for screen readers. */}
            <Link
              to={`/vehicles/${vehicle.id}`}
              state={onInventory ? { fromInventory: true } : undefined}
              className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-[var(--focus)]"
            >
              {name}
            </Link>
          </h3>
          <span className="text-ink-muted @row-table:text-base block min-w-0 shrink-[100] truncate text-sm">
            {vehicle.trim}
          </span>
        </div>
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

      <p className="@row-widest:block hidden min-w-0 text-sm">
        <span className="block truncate">{vehicle.city}</span>
        <span className="text-ink-muted block truncate text-xs">{vehicle.province}</span>
      </p>

      <p className="tabular @row-wide:block hidden text-right text-sm">
        {formatKm(vehicle.odometer_km)}
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
        <p
          className={cn(
            '@row-split:block hidden text-xs',
            auction.reserve_status === 'met' ? 'text-win font-semibold' : 'text-ink-muted',
          )}
        >
          {RESERVE_TEXT[auction.reserve_status]}
        </p>
      </div>

      <div className="@row-split:self-start @row-table:self-center @row-table:[grid-area:auto] self-end text-right text-sm [grid-area:time]">
        <AuctionClock
          auction={auction}
          className="block"
          // The column header already says "Ends"; screen readers still hear it.
          labelClassName="@row-table:sr-only"
        />
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
