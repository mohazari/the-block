import { ArrowLeft, MapPin, Star } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ApiError } from '../api/client'
import { useVehicle, useWatch } from '../api/queries'
import type { VehicleDetail } from '../api/types'
import { AuctionClock } from '../components/auction/AuctionClock'
import { statusAt } from '../lib/auction'
import { cn } from '../lib/cn'
import { formatMoney, label } from '../lib/format'
import { useServerNow } from '../lib/serverClock'
import { vehicleName } from '../lib/vehicle'
import { BidPanel } from './vehicle/BidPanel'
import { ConditionReport } from './vehicle/ConditionReport'
import { Gallery } from './vehicle/Gallery'
import { SpecSheet } from './vehicle/SpecSheet'

/**
 * The desktop layout, shared with the loading skeleton so nothing moves when the data lands.
 *
 * From 1024px: everything about the car in one column (photos, condition, specs and seller),
 * the bid panel in a column on the right, sticky. With 88rem of room (a 1536px screen, or a wider
 * one with Lane docked) the condition report moves up between the photos and the bid panel, so
 * the price and what's wrong with the car share the first screen, and specs and seller run full
 * width under both: no empty band on a wide monitor. The switch is a container query on the
 * page's own width, so docking Lane brings the condition report back under the photos.
 * The last row is 1fr: the tall bid column's extra height lands there, not as gaps between
 * sections.
 */
const LAYOUT = {
  grid: 'grid items-start gap-x-8 gap-y-10 2xl:gap-x-12 lg:grid-cols-[minmax(0,1fr)_clamp(22rem,26vw,27.5rem)] lg:grid-rows-[auto_auto_1fr] @min-[88rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_clamp(22rem,24vw,27.5rem)] @min-[88rem]:grid-rows-[auto_1fr]',
  photos: 'min-w-0 lg:col-start-1 lg:row-start-1',
  bid: 'lg:col-start-2 lg:row-span-3 lg:row-start-1 @min-[88rem]:col-start-3 @min-[88rem]:row-span-2',
  condition:
    'min-w-0 lg:col-start-1 lg:row-start-2 @min-[88rem]:col-start-2 @min-[88rem]:row-start-1',
  details: 'min-w-0 lg:col-start-1 lg:row-start-3 @min-[88rem]:col-span-2 @min-[88rem]:row-start-2',
}

export function VehicleDetailPage() {
  const { vehicleId = '' } = useParams()
  // A new vehicle gets fresh component state (draft bids, errors, selected view).
  return <VehicleDetailContent key={vehicleId} vehicleId={vehicleId} />
}

function VehicleDetailContent({ vehicleId }: { vehicleId: string }) {
  const query = useVehicle(vehicleId)

  if (query.isPending) return <DetailSkeleton />
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404
    return (
      <section className="mx-auto max-w-md py-16 text-center" role="alert">
        <h1 className="text-2xl font-semibold tracking-tight">
          {missing ? 'This vehicle isn’t on the run list' : 'Couldn’t load this vehicle'}
        </h1>
        <p className="text-ink-muted mt-2">
          {missing ? 'It may have been removed, or the link is wrong.' : query.error.message}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          {!missing && (
            <button type="button" onClick={() => void query.refetch()} className="btn btn-primary">
              Try again
            </button>
          )}
          <Link to="/" className="btn btn-plain">
            Back to the run list
          </Link>
        </div>
      </section>
    )
  }

  const vehicle = query.data
  return (
    <article aria-labelledby="vehicle-heading" className="pb-24 lg:pb-0">
      <BackLink />
      <Header vehicle={vehicle} />
      {/* One bid panel, placed by the grid: after the photos on phones, a column on desktop. */}
      <div className="@container mt-6">
        <div className={LAYOUT.grid}>
          <div className={LAYOUT.photos}>
            <Gallery vehicle={vehicle} />
          </div>
          <aside aria-label="Bidding" id="bid" className={cn('scroll-mt-20', LAYOUT.bid)}>
            <div className="lg:sticky lg:top-20">
              <BidPanel vehicle={vehicle} />
            </div>
          </aside>
          <div className={LAYOUT.condition}>
            <ConditionReport vehicle={vehicle} />
          </div>
          <div className={cn('space-y-10', LAYOUT.details)}>
            <SpecSheet vehicle={vehicle} />
            <Seller vehicle={vehicle} />
          </div>
        </div>
      </div>
      <MobileBidBar vehicle={vehicle} />
    </article>
  )
}

/** Back to the run list as the buyer left it (filters, page) when they came from it. */
function BackLink() {
  const navigate = useNavigate()
  const location = useLocation()
  // Go back only when we came from the run list, so its filters and page are restored. From
  // anywhere else (My bids, a toast, a shared link) this is a plain link to the run list.
  const fromRunList = (location.state as { fromRunList?: boolean } | null)?.fromRunList === true
  return (
    <Link
      to="/"
      onClick={(event) => {
        if (!fromRunList) return
        event.preventDefault()
        void navigate(-1)
      }}
      className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-sm font-semibold"
    >
      <ArrowLeft size={16} aria-hidden />
      Run list
    </Link>
  )
}

function Header({ vehicle }: { vehicle: VehicleDetail }) {
  const watch = useWatch()
  const name = vehicleName(vehicle)
  return (
    <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1
          id="vehicle-heading"
          className="text-2xl leading-tight font-semibold tracking-tight lg:text-[1.75rem]"
        >
          {name}
        </h1>
        <p className="text-ink-muted mt-1">
          {vehicle.trim} {label(vehicle.body_style)}
          <span aria-hidden className="text-ink-faint mx-2">
            /
          </span>
          <span className="tabular">Lot {vehicle.lot}</span>
        </p>
      </div>
      <button
        type="button"
        aria-pressed={vehicle.watching}
        onClick={() => watch.mutate({ vehicleId: vehicle.id, watching: !vehicle.watching })}
        className={cn(
          'btn px-4',
          vehicle.watching ? 'border-action bg-action-soft text-ink' : 'btn-plain',
        )}
      >
        <Star size={16} aria-hidden fill={vehicle.watching ? 'currentColor' : 'none'} />
        {vehicle.watching ? 'Watching' : 'Watch'}
      </button>
    </header>
  )
}

function Seller({ vehicle }: { vehicle: VehicleDetail }) {
  return (
    <section aria-labelledby="seller-heading">
      <h2 id="seller-heading" className="mb-3 text-lg font-semibold">
        Seller
      </h2>
      {/* Sized to its two lines, not stretched across the column. */}
      <div className="border-line bg-surface inline-flex flex-col rounded-[var(--radius-panel)] border px-4 py-3">
        <p className="font-semibold">{vehicle.selling_dealership}</p>
        <p className="text-ink-muted mt-1 inline-flex items-center gap-1.5 text-sm">
          <MapPin size={15} aria-hidden />
          {vehicle.city}, {vehicle.province}
        </p>
      </div>
    </section>
  )
}

/** Phones: price and time stay in reach while reading the condition report. */
function MobileBidBar({ vehicle }: { vehicle: VehicleDetail }) {
  const { auction } = vehicle
  const open = statusAt(auction, useServerNow()) !== 'ended'
  return (
    <div className="border-line bg-surface fixed inset-x-0 bottom-0 z-20 border-t py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
      <div className="frame flex items-center justify-between gap-3">
        <div>
          <p className="tabular text-xl leading-none font-bold">
            {formatMoney(auction.current_bid ?? auction.starting_bid)}
          </p>
          <AuctionClock auction={auction} className="text-sm" />
        </div>
        {open && (
          <a href="#bid" className="btn btn-primary h-11 px-6 text-base">
            Bid
          </a>
        )}
      </div>
    </div>
  )
}

function DetailSkeleton() {
  return (
    // The final layout in flat grey: no shimmer, and nothing moves when the data lands.
    <div aria-busy="true" aria-label="Loading vehicle">
      <div className="bg-surface-sunk h-4 w-24 rounded" />
      <div className="bg-surface-sunk mt-4 h-9 w-72 rounded" />
      <div className="@container mt-6">
        <div className={LAYOUT.grid}>
          <div
            className={cn(
              LAYOUT.photos,
              'bg-surface-sunk aspect-[40/17] rounded-[var(--radius-panel)]',
            )}
          />
          <div className={cn(LAYOUT.bid, 'bg-surface-sunk h-96 rounded-[var(--radius-panel)]')} />
          <div
            className={cn(LAYOUT.condition, 'bg-surface-sunk h-40 rounded-[var(--radius-panel)]')}
          />
        </div>
      </div>
    </div>
  )
}
