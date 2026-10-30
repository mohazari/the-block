import { ArrowUp, MessageCircle, Settings2, Square, SquarePen, X } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { Dialog } from 'radix-ui'
import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Link, useMatch } from 'react-router'
import { ApiError } from '../../api/client'
import {
  useLaneCancelSignIn,
  useLaneModels,
  useLaneSignIn,
  useLaneSignOut,
  useLaneStatus,
} from '../../api/lane'
import type { LaneStatus } from '../../api/types'
import { cn } from '../../lib/cn'
import { formatClockTime } from '../../lib/format'
import { SelectField } from '../SelectField'
import { LanePickCard } from './LanePickCard'
import { runListUrl, useLane, useLaneOpen, type Turn } from './laneState'

const WIDE = '(min-width: 80rem)'

/**
 * From 1280px Lane docks beside the page, which keeps enough room to work. Narrower, it slides
 * over the page as a sheet (the whole screen on phones).
 */
function useIsWide(): boolean {
  return useSyncExternalStore(subscribeWide, isWide)
}

let wideQuery: MediaQueryList | null | undefined // made on first use, then shared

function query(): MediaQueryList | null {
  wideQuery ??= typeof window.matchMedia === 'function' ? window.matchMedia(WIDE) : null
  return wideQuery
}

function subscribeWide(onChange: () => void): () => void {
  query()?.addEventListener('change', onChange)
  return () => query()?.removeEventListener('change', onChange)
}

function isWide(): boolean {
  return query()?.matches ?? false
}

/** The header button that opens Lane. */
export function LaneButton() {
  const { open, setOpen, buttonRef } = useLaneOpen()
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      aria-label="Ask Lane, the car-finding assistant"
      className={cn('btn btn-plain h-10 px-3 sm:px-4', open && 'bg-surface-sunk border-ink-faint')}
    >
      <MessageCircle size={16} aria-hidden />
      <span className="hidden sm:inline">Ask Lane</span>
    </button>
  )
}

/**
 * Lane, the car-finding assistant. Docked on the right on wide screens (the page stays usable
 * beside it), full screen on phones. Signs in with the buyer's ChatGPT account on first use.
 */
export function LanePanel() {
  const { open, setOpen, newChat, turns, buttonRef } = useLane()
  const wide = useIsWide()
  const [showSettings, setShowSettings] = useState(false)
  const status = useLaneStatus(open)
  const ready = status.data?.available && status.data.signed_in

  return (
    <Dialog.Root open={open} onOpenChange={setOpen} modal={!wide}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            {!wide && (
              <Dialog.Overlay asChild forceMount>
                <m.div
                  className="fixed inset-0 z-40 bg-black/40"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                />
              </Dialog.Overlay>
            )}
            <Dialog.Content
              asChild
              forceMount
              aria-describedby={undefined}
              // Docked, the page beside Lane stays usable: clicking it mustn't close the panel.
              onInteractOutside={(event) => wide && event.preventDefault()}
              // The header button isn't Radix's own trigger, so return focus to it by hand.
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                buttonRef.current?.focus()
              }}
            >
              <m.section
                className="bg-surface border-line fixed inset-0 z-50 flex flex-col sm:left-auto sm:w-[var(--lane-width)] sm:border-l xl:z-40"
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
              >
                <header className="border-line flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
                  <LaneMark />
                  <div className="mr-auto min-w-0 leading-tight">
                    <Dialog.Title className="font-semibold">Lane</Dialog.Title>
                    <p className="text-ink-faint truncate text-xs">Car-finding assistant</p>
                  </div>
                  {ready && (
                    <>
                      <IconButton label="New chat" onClick={newChat} disabled={turns.length === 0}>
                        <SquarePen size={18} aria-hidden />
                      </IconButton>
                      <IconButton
                        label="Lane settings"
                        onClick={() => setShowSettings(!showSettings)}
                        pressed={showSettings}
                      >
                        <Settings2 size={18} aria-hidden />
                      </IconButton>
                    </>
                  )}
                  <Dialog.Close asChild>
                    <IconButton label="Close Lane">
                      <X size={20} aria-hidden />
                    </IconButton>
                  </Dialog.Close>
                </header>
                {ready && showSettings && <Settings status={status.data!} />}
                <Body
                  status={status.data}
                  loading={status.isPending}
                  failed={status.isError}
                  reason={status.error instanceof ApiError ? status.error.message : undefined}
                  retry={() => void status.refetch()}
                />
              </m.section>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}

/** Lane's avatar: its initial on OPENLANE's light blue. */
function LaneMark() {
  return (
    <span
      aria-hidden
      className="bg-action-soft text-ink grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold"
    >
      L
    </span>
  )
}

function IconButton({
  label,
  pressed,
  className,
  ...props
}: { label: string; pressed?: boolean } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        'text-ink-muted hover:bg-surface-sunk hover:text-ink grid size-10 shrink-0 place-items-center rounded-full disabled:opacity-40',
        pressed && 'bg-surface-sunk text-ink',
        className,
      )}
      {...props}
    />
  )
}

function Body({
  status,
  loading,
  failed,
  reason,
  retry,
}: {
  status: LaneStatus | undefined
  loading: boolean
  failed: boolean
  /** The server's own explanation, when it gave one (e.g. Codex didn't answer). */
  reason?: string
  retry: () => void
}) {
  if (loading) {
    return <p className="text-ink-muted p-4 text-sm">Starting Lane…</p>
  }
  if (failed || !status) {
    return (
      <Notice title="Couldn't reach Lane">
        {reason && <p>{reason}</p>}
        <button type="button" onClick={retry} className="btn btn-plain mt-3">
          Try again
        </button>
      </Notice>
    )
  }
  if (!status.available) {
    return <Notice title="Lane isn't set up on this computer">{status.problem}</Notice>
  }
  if (!status.signed_in) return <SignIn status={status} />
  return <Chat />
}

function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="p-4">
      <div className="border-line rounded-[var(--radius-panel)] border p-4 text-sm">
        <h3 className="font-semibold">{title}</h3>
        <div className="text-ink-muted mt-1">{children}</div>
      </div>
    </div>
  )
}

function SignIn({ status }: { status: LaneStatus }) {
  const signIn = useLaneSignIn()
  const cancel = useLaneCancelSignIn()

  const start = () => {
    // Open the tab now, inside the click: opened after the request returns, it would be
    // blocked as a pop-up.
    const tab = window.open('', '_blank')
    signIn.mutate(undefined, {
      onSuccess: ({ auth_url }) => {
        // Only ever navigate to a web page: never a javascript: URL in this origin.
        if (!/^https:\/\//i.test(auth_url)) {
          tab?.close()
          return
        }
        if (tab) {
          tab.opener = null
          tab.location.href = auth_url
        } else {
          window.location.assign(auth_url)
        }
      },
      onError: () => tab?.close(),
    })
  }

  return (
    <div className="space-y-4 p-4 text-sm">
      <p>
        Tell Lane what you're after (budget, body style, mileage, when the auction should close) and
        it picks the cars in today's run list that fit, with the reason for each.
      </p>
      <p className="text-ink-muted">
        Lane answers with your ChatGPT account. Sign in once; it stays signed in on this computer.
      </p>
      {status.signing_in ? (
        <div className="space-y-3">
          <p role="status" className="bg-surface-sunk rounded-[var(--radius-control)] px-3 py-2">
            Finish signing in on the ChatGPT tab that opened. This updates on its own.
          </p>
          {/* A closed or lost tab would otherwise leave this waiting for good. */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={start}
              disabled={signIn.isPending}
              className="btn btn-plain flex-1"
            >
              Open ChatGPT again
            </button>
            <button
              type="button"
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending}
              className="btn text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={signIn.isPending}
          className="btn btn-primary w-full"
        >
          {signIn.isPending ? 'Opening ChatGPT…' : 'Sign in with ChatGPT'}
        </button>
      )}
      {(status.sign_in_error || signIn.error) && (
        <p role="alert" className="text-outbid">
          {status.sign_in_error ?? signIn.error?.message}
        </p>
      )}
    </div>
  )
}

function Settings({ status }: { status: LaneStatus }) {
  const { choice, setChoice } = useLane()
  const models = useLaneModels(true)
  const signOut = useLaneSignOut()
  const modelId = useId()
  const effortId = useId()

  const list = models.data ?? []
  const model =
    list.find((item) => item.id === choice.model) ?? list.find((item) => item.is_default) ?? list[0]
  const effort = model?.efforts.some((option) => option.value === choice.effort)
    ? choice.effort!
    : model?.default_effort
  const usage = status.usage

  return (
    <section
      aria-label="Lane settings"
      className="border-line bg-lane space-y-3 border-b p-4 text-sm"
    >
      {models.isError ? (
        <p className="text-outbid">Couldn't load the models your plan offers.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={modelId} className="text-ink-muted mb-1 block text-xs">
              Model
            </label>
            <SelectField
              id={modelId}
              value={model?.id ?? ''}
              disabled={!model}
              onChange={(event) => setChoice({ model: event.target.value, effort: null })}
            >
              {list.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectField>
          </div>
          <div>
            <label htmlFor={effortId} className="text-ink-muted mb-1 block text-xs">
              Effort
            </label>
            <SelectField
              id={effortId}
              value={effort ?? ''}
              disabled={!model}
              onChange={(event) =>
                setChoice({ model: model?.id ?? null, effort: event.target.value })
              }
            >
              {model?.efforts.map((option) => (
                <option key={option.value} value={option.value}>
                  {effortLabel(option.value)}
                </option>
              ))}
            </SelectField>
          </div>
        </div>
      )}
      <p className="text-ink-muted text-xs">
        More effort means more careful answers that take longer and use more of your plan.
      </p>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-ink-muted">
          {usage ? (
            <>
              <span className="tabular">{usage.used_percent}%</span> of your{' '}
              {usage.window_minutes ? windowLabel(usage.window_minutes) : ''} ChatGPT limit used
              {usage.resets_at && <>, resets {formatClockTime(usage.resets_at)}</>}
            </>
          ) : (
            `Signed in with ChatGPT${status.plan ? ` (${effortLabel(status.plan)})` : ''}`
          )}
        </span>
        <button
          type="button"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
          className="link-action shrink-0"
        >
          Sign out
        </button>
      </div>
    </section>
  )
}

const effortLabel = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

function windowLabel(minutes: number): string {
  if (minutes % (60 * 24 * 7) === 0) return 'weekly'
  if (minutes % 60 === 0) return `${minutes / 60}-hour`
  return `${minutes}-minute`
}

const STARTERS = [
  'An SUV under $30,000 with low kilometres',
  'Pickups closing in the next hour',
  'The best condition I can get for under $20,000',
]

function Chat() {
  const { turns, answering, ask, stop, setOpen } = useLane()
  const vehicleId = useMatch('/vehicles/:vehicleId')?.params.vehicleId
  const wide = useIsWide()
  const end = useRef<HTMLDivElement>(null)
  const last = turns.at(-1)
  const progress =
    last?.role === 'lane'
      ? `${turns.length}:${last.text.length}:${last.steps.length}:${last.picks.length}`
      : String(turns.length)

  // Keep the newest answer in view as it's written.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [progress])

  // Leaving for a car on a phone: the full-screen panel would cover it.
  const onOpen = useMemo(() => (wide ? undefined : () => setOpen(false)), [wide, setOpen])
  const starters = vehicleId ? ['Is this car a good buy?', ...STARTERS.slice(0, 2)] : STARTERS

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <div className="space-y-4 text-sm">
            <p>
              Hi, I'm Lane. Tell me what you're looking for and I'll find the cars in today's run
              list that fit.
            </p>
            <ul className="flex flex-col items-start gap-2" aria-label="Suggestions">
              {starters.map((starter) => (
                <li key={starter}>
                  <button
                    type="button"
                    onClick={() => ask(starter, vehicleId)}
                    className="btn btn-plain h-auto min-h-10 py-2 text-left whitespace-normal"
                  >
                    {starter}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="space-y-5" aria-label="Conversation">
            {turns.map((turn) => (
              <TurnView key={turn.id} turn={turn} onOpen={onOpen} />
            ))}
          </ol>
        )}
        <div ref={end} />
      </div>
      <Announcer turn={last} />
      <Composer answering={answering} onSend={(text) => ask(text, vehicleId)} onStop={stop} />
    </>
  )
}

// Memoised: while an answer streams in, only its own turn re-renders, not every earlier one.
const TurnView = memo(function TurnView({ turn, onOpen }: { turn: Turn; onOpen?: () => void }) {
  if (turn.role === 'buyer') {
    return (
      <li className="flex justify-end">
        <p className="bg-surface-sunk max-w-[85%] rounded-[var(--radius-panel)] px-3 py-2 text-sm whitespace-pre-wrap">
          <span className="sr-only">You: </span>
          {turn.text}
        </p>
      </li>
    )
  }
  const stopped = turn.problem?.code === 'lane_stopped'
  return (
    <li className="space-y-3 text-sm">
      <span className="sr-only">Lane: </span>
      {turn.pending && !turn.text && (
        // What Lane is actually doing, from its tool calls: no decorative typing dots.
        <p className="text-ink-muted">{turn.steps.at(-1) ?? 'Thinking'}…</p>
      )}
      {turn.text && <p className="whitespace-pre-wrap">{turn.text}</p>}
      {turn.picks.length > 0 && (
        <ul className="space-y-2" aria-label="Lane's picks">
          {turn.picks.map((pick) => (
            <li key={pick.vehicle.id}>
              <LanePickCard pick={pick} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
      {turn.search && turn.picks.length > 0 && (
        <Link to={runListUrl(turn.search)} onClick={onOpen} className="link-action inline-block">
          Show this search in the run list
        </Link>
      )}
      {turn.problem &&
        (stopped ? (
          <p className="text-ink-faint">Stopped.</p>
        ) : (
          <p className="bg-outbid-soft text-outbid rounded-[var(--radius-control)] px-3 py-2">
            {turn.problem.message}
          </p>
        ))}
    </li>
  )
})

/** Screen readers hear each finished answer once, not every word as it streams in. */
function Announcer({ turn }: { turn: Turn | undefined }) {
  const done = turn?.role === 'lane' && !turn.pending
  let message = ''
  if (done) {
    const picks = turn.picks.length
    message = turn.problem
      ? turn.problem.message
      : `${turn.text}${picks ? ` ${picks} ${picks === 1 ? 'pick' : 'picks'} below.` : ''}`
  }
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {message}
    </p>
  )
}

function Composer({
  answering,
  onSend,
  onStop,
}: {
  answering: boolean
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [text, setText] = useState('')
  const inputId = useId()

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const message = text.trim()
    if (!message || answering) return
    onSend(message)
    setText('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter starts a new line. Not while an IME is composing a character.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event)
  }

  return (
    <form
      onSubmit={submit}
      className="border-line flex items-end gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <label htmlFor={inputId} className="sr-only">
        Message Lane
      </label>
      <textarea
        id={inputId}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        maxLength={2000}
        placeholder="Describe the car you want"
        className="field [field-sizing:content] h-auto max-h-40 min-h-10 resize-none py-2"
      />
      {answering ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop answering"
          className="btn btn-plain size-10 shrink-0 px-0"
        >
          <Square size={14} aria-hidden fill="currentColor" />
        </button>
      ) : (
        <button
          type="submit"
          aria-label="Send"
          disabled={!text.trim()}
          className="btn btn-primary size-10 shrink-0 px-0"
        >
          <ArrowUp size={18} aria-hidden />
        </button>
      )}
    </form>
  )
}
