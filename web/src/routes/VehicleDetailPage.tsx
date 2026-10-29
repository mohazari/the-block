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
        <h1 className="font-display text-3xl font-bold">
          {missing ? 'This vehicle isn’t on the run list' : 'Couldn’t load this vehicle'}
        </h1>
        <p className="text-ink-muted mt-2">
          {missing ? 'It may have been removed, or the link is wrong.' : query.error.message}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          {!missing && (
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="bg-action text-action-ink h-10 rounded-[var(--radius-control)] px-4 font-semibold"
            >
              Try again
            </button>
          )}
          <Link
            to="/"
            className="border-line-strong h-10 content-center rounded-[var(--radius-control)] border px-4 font-semibold"
          >
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
      {/* One bid panel, placed by the grid: after the photos on phones, a sticky column spanning
          every row on desktop. */}
      <div className="mt-6 grid gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 lg:col-start-1">
          <Gallery vehicle={vehicle} />
        </div>
        <aside
          aria-label="Bidding"
          id="bid"
          className="scroll-mt-20 lg:col-start-2 lg:row-span-4 lg:row-start-1"
        >
          <div className="lg:sticky lg:top-20">
            <BidPanel vehicle={vehicle} />
          </div>
        </aside>
        <div className="min-w-0 lg:col-start-1">
          <ConditionReport vehicle={vehicle} />
        </div>
        <div className="min-w-0 lg:col-start-1">
          <SpecSheet vehicle={vehicle} />
        </div>
        <div className="min-w-0 lg:col-start-1">
          <Seller vehicle={vehicle} />
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
        <p className="text-ink-faint tabular text-sm">Lot {vehicle.lot}</p>
        <h1
          id="vehicle-heading"
          className="font-display text-4xl leading-tight font-bold tracking-tight"
        >
          {name}
        </h1>
        <p className="text-ink-muted text-lg">
          {vehicle.trim} {label(vehicle.body_style)}
        </p>
      </div>
      <button
        type="button"
        aria-pressed={vehicle.watching}
        onClick={() => watch.mutate({ vehicleId: vehicle.id, watching: !vehicle.watching })}
        className={cn(
          'inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm font-semibold',
          vehicle.watching ? 'border-action bg-action-soft text-action' : 'border-line-strong',
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
      <h2 id="seller-heading" className="font-display mb-3 text-2xl font-bold">
        Seller
      </h2>
      <div className="border-line bg-surface rounded-[var(--radius-panel)] border p-4">
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
    <div className="border-line bg-surface/95 fixed inset-x-0 bottom-0 z-20 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div>
          <p className="font-display tabular text-2xl leading-none font-bold">
            {formatMoney(auction.current_bid ?? auction.starting_bid)}
          </p>
          <AuctionClock auction={auction} className="text-sm" />
        </div>
        {open && (
          <a
            href="#bid"
            className="bg-action text-action-ink inline-flex h-11 items-center rounded-[var(--radius-control)] px-5 font-semibold"
          >
            Bid
          </a>
        )}
      </div>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading vehicle" className="animate-pulse">
      <div className="bg-surface-sunk h-4 w-24 rounded" />
      <div className="bg-surface-sunk mt-4 h-9 w-72 rounded" />
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="bg-surface-sunk aspect-[40/17] rounded-[var(--radius-panel)]" />
        <div className="bg-surface-sunk h-96 rounded-[var(--radius-panel)]" />
      </div>
    </div>
  )
}
