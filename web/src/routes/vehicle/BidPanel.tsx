import { AnimatePresence, m } from 'motion/react'
import { useId, useState, type FormEvent } from 'react'
import { useBuyNow, usePlaceBid } from '../../api/bidding'
import { ApiError } from '../../api/client'
import type { AuctionSnapshot, Standing, VehicleDetail } from '../../api/types'
import { AnimatedPrice } from '../../components/auction/AnimatedPrice'
import { AuctionClock } from '../../components/auction/AuctionClock'
import { RESERVE_TEXT, standingAt, statusAt } from '../../lib/auction'
import { cn } from '../../lib/cn'
import { formatMoney, plural } from '../../lib/format'
import { useServerNow } from '../../lib/serverClock'
import { newId } from '../../lib/bidder'
import { amountProblem } from '../../lib/bidRules'
import { BidHistory } from './BidHistory'

export function BidPanel({ vehicle }: { vehicle: VehicleDetail }) {
  const now = useServerNow()
  const { auction } = vehicle
  const status = statusAt(auction, now)
  const standing = standingAt(auction, status)
  const hasBids = auction.current_bid !== null

  return (
    <section
      aria-labelledby="bid-panel-heading"
      className="border-line bg-surface rounded-[var(--radius-panel)] border"
    >
      <div className="border-line border-b p-5">
        <h2 id="bid-panel-heading" className="sr-only">
          Bidding
        </h2>
        <div className="flex items-center justify-between gap-3 text-sm">
          <StatusPill status={status} />
          <AuctionClock auction={auction} className="text-base" />
        </div>

        <p className="text-ink-muted mt-4 text-sm">{hasBids ? 'Current bid' : 'Starting bid'}</p>
        <AnimatedPrice
          value={auction.current_bid ?? auction.starting_bid}
          className="font-display block text-5xl leading-none font-bold"
        />
        <p className="text-ink-muted mt-2 flex flex-wrap gap-x-3 text-sm">
          <span>{hasBids ? plural(auction.bid_count, 'bid') : 'No bids yet'}</span>
          <span className={cn(auction.reserve_status === 'met' && 'text-win font-semibold')}>
            {RESERVE_TEXT[auction.reserve_status]}
          </span>
        </p>

        <StandingBanner standing={standing} auction={auction} />
      </div>

      {status !== 'ended' && (
        <div className="space-y-5 p-5">
          {standing === 'leading' && auction.reserve_status !== 'not_met' ? (
            <p className="text-ink-muted text-sm">
              You lead at {formatMoney(auction.current_bid!)}. We'll show you right away if someone
              outbids you.
            </p>
          ) : (
            <>
              {standing === 'leading' && (
                <p className="text-ink-muted text-sm">
                  You lead, but the reserve isn't met yet. If no one bids higher, raising your bid
                  is the only way this car sells.
                </p>
              )}
              <BidForm vehicleId={vehicle.id} auction={auction} status={status} />
            </>
          )}
          {auction.buy_now_available && auction.buy_now_price !== null && (
            <BuyNow vehicleId={vehicle.id} price={auction.buy_now_price} />
          )}
          <p className="text-ink-faint text-xs">
            {status === 'upcoming'
              ? 'Pre-bids are placed now and count when the auction opens.'
              : 'A bid in the last 2 minutes extends the auction by 2 minutes, so everyone gets a chance to respond.'}
          </p>
        </div>
      )}

      <BidHistory bids={vehicle.recent_bids} total={auction.bid_count} />
    </section>
  )
}

function StatusPill({ status }: { status: ReturnType<typeof statusAt> }) {
  const styles = {
    live: 'bg-win-soft text-win',
    upcoming: 'bg-action-soft text-action',
    ended: 'bg-surface-sunk text-ink-muted',
  }
  const text = { live: 'Live', upcoming: 'Upcoming', ended: 'Auction ended' }
  return (
    <span
      className={cn(
        'rounded-[var(--radius-control)] px-2 py-0.5 text-xs font-semibold',
        styles[status],
      )}
    >
      {text[status]}
    </span>
  )
}

function StandingBanner({
  standing,
  auction,
}: {
  standing: Standing | null
  auction: AuctionSnapshot
}) {
  const content: Record<Standing, { text: string; tone: string }> = {
    leading: { text: "You're the high bidder.", tone: 'bg-win-soft text-win' },
    outbid: {
      text: `You've been outbid. The minimum is now ${formatMoney(auction.min_next_bid)}.`,
      tone: 'bg-outbid-soft text-outbid',
    },
    won: { text: 'You won this vehicle.', tone: 'bg-win-soft text-win' },
    lost: {
      text:
        // The high bidder can only lose on the reserve (the outcome may not have arrived yet).
        auction.is_high_bidder
          ? "You were the high bidder, but the reserve wasn't met."
          : 'Another buyer won this vehicle.',
      tone: 'bg-surface-sunk text-ink-muted',
    },
  }
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      <AnimatePresence initial={false} mode="popLayout">
        {standing && (
          <m.p
            key={standing}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'mt-4 rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold',
              content[standing].tone,
            )}
          >
            {content[standing].text}
          </m.p>
        )}
      </AnimatePresence>
    </div>
  )
}

function BidForm({
  vehicleId,
  auction,
  status,
}: {
  vehicleId: string
  auction: AuctionSnapshot
  status: ReturnType<typeof statusAt>
}) {
  const placeBid = usePlaceBid(vehicleId)
  // Until the buyer types or picks an amount, the draft follows the live minimum bid.
  const [custom, setCustom] = useState<string | null>(null)
  const draft = custom ?? String(auction.min_next_bid)
  // Set while waiting for the second click. Holds the idempotency key for this attempt.
  const [confirming, setConfirming] = useState<{ amount: number; key: string } | null>(null)
  const inputId = useId()
  const errorId = useId()

  const amount = draft.trim() === '' ? null : Number(draft)
  const problem = amountProblem(amount, auction)
  const suggestions = [0, 1, 2].map((steps) => auction.min_next_bid + steps * auction.increment)
  const serverError = placeBid.error instanceof ApiError ? placeBid.error : null

  const edit = (text: string) => {
    setCustom(text)
    setConfirming(null)
    placeBid.reset()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (problem || amount === null) return
    if (!confirming || confirming.amount !== amount) {
      // Pin the amount: from here the draft stops following the live minimum, so the button
      // always bids exactly what it says. If the minimum overtakes it, the form explains why.
      setCustom(String(amount))
      setConfirming({ amount, key: newId() })
      return
    }
    placeBid.mutate(
      { amount, idempotencyKey: confirming.key },
      {
        onSuccess: () => setConfirming(null),
        onError: (error) => {
          // A network failure keeps the same key so retrying can't place a second bid; any
          // answer from the server means this attempt is settled.
          if (!(error instanceof ApiError) || error.status !== 0) setConfirming(null)
          // Outbid while confirming: snap the draft to the new minimum (the message stays up).
          if (error instanceof ApiError && error.code === 'bid_too_low') setCustom(null)
        },
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">
          {status === 'upcoming' ? 'Place a pre-bid' : 'Your bid'}
        </legend>
        <div className="grid grid-cols-3 gap-2">
          {suggestions.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => edit(String(value))}
              aria-pressed={amount === value}
              className={cn(
                'tabular h-10 rounded-[var(--radius-control)] border text-sm font-semibold',
                amount === value
                  ? 'border-action bg-action-soft text-action'
                  : 'border-line-strong hover:border-ink-faint',
              )}
            >
              {formatMoney(value)}
            </button>
          ))}
        </div>
      </fieldset>

      <label htmlFor={inputId} className="text-ink-muted mt-4 mb-1 block text-sm">
        Or enter an amount
      </label>
      <div className="border-line-strong bg-surface focus-within:border-action flex h-12 items-center rounded-[var(--radius-control)] border">
        <span className="text-ink-faint pl-3">$</span>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={auction.min_next_bid}
          step={auction.increment}
          value={draft}
          onChange={(event) => edit(event.target.value)}
          aria-invalid={Boolean(problem)}
          aria-describedby={errorId}
          className="font-display tabular h-full min-w-0 flex-1 bg-transparent px-1 text-2xl font-semibold outline-none"
        />
      </div>
      <p id={errorId} className="text-outbid mt-1 min-h-5 text-sm" aria-live="polite">
        {draft !== '' && problem}
      </p>

      {serverError && (
        <p
          role="alert"
          className="bg-outbid-soft text-outbid mb-3 rounded-[var(--radius-control)] px-3 py-2 text-sm"
        >
          {serverError.code === 'bid_too_low'
            ? `Someone bid first. ${serverError.message}`
            : serverError.message}
        </p>
      )}

      <div className="flex gap-2">
        {confirming && !placeBid.isPending && (
          <button
            type="button"
            onClick={() => setConfirming(null)}
            className="text-ink-muted hover:text-ink h-12 rounded-[var(--radius-control)] px-4 text-sm font-semibold"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={Boolean(problem) || placeBid.isPending}
          className={cn(
            'h-12 flex-1 rounded-[var(--radius-control)] text-base font-semibold transition-colors disabled:opacity-50',
            confirming
              ? 'bg-ink text-lane hover:bg-ink/90'
              : 'bg-action text-action-ink hover:bg-action-hover',
          )}
        >
          {placeBid.isPending
            ? 'Placing bid…'
            : confirming
              ? `Confirm ${formatMoney(confirming.amount)} bid`
              : amount !== null && !problem
                ? `Place bid ${formatMoney(amount)}`
                : 'Place bid'}
        </button>
      </div>
    </form>
  )
}

function BuyNow({ vehicleId, price }: { vehicleId: string; price: number }) {
  const buyNow = useBuyNow(vehicleId)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)

  const click = () => {
    if (!confirmKey) {
      setConfirmKey(newId())
      return
    }
    buyNow.mutate(
      { idempotencyKey: confirmKey },
      {
        onError: (error) => {
          if (!(error instanceof ApiError) || error.status !== 0) setConfirmKey(null)
        },
      },
    )
  }

  return (
    <div className="border-line rounded-[var(--radius-control)] border p-3">
      <p className="text-sm">
        <span className="font-semibold">Buy Now</span> ends the auction and the vehicle is yours at{' '}
        <span className="tabular font-semibold">{formatMoney(price)}</span>.
      </p>
      {buyNow.error && (
        <p role="alert" className="text-outbid mt-2 text-sm">
          {buyNow.error.message}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        {confirmKey && !buyNow.isPending && (
          <button
            type="button"
            onClick={() => {
              setConfirmKey(null)
              buyNow.reset()
            }}
            className="text-ink-muted hover:text-ink h-10 px-3 text-sm font-semibold"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={click}
          disabled={buyNow.isPending}
          className={cn(
            'h-10 flex-1 rounded-[var(--radius-control)] border text-sm font-semibold disabled:opacity-50',
            confirmKey
              ? 'border-ink bg-ink text-lane'
              : 'border-line-strong hover:border-ink-faint',
          )}
        >
          {buyNow.isPending
            ? 'Buying…'
            : confirmKey
              ? `Confirm Buy Now for ${formatMoney(price)}`
              : `Buy now for ${formatMoney(price)}`}
        </button>
      </div>
    </div>
  )
}
