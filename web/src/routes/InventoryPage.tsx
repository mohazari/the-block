import { Search } from 'lucide-react'
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from 'react'
import { useInventory } from '../api/queries'
import { LightsLegend } from '../components/auction/ConditionLight'
import { plural } from '../lib/format'
import { ActiveFilterChips, ChipButton } from './inventory/ActiveFilterChips'
import { activeChips } from './inventory/activeChips'
import { FilterPanel } from './inventory/FilterPanel'
import { FilterSheet } from './inventory/FilterSheet'
import {
  activeFilterCount,
  limitSearch,
  SEARCH_MAX_LENGTH,
  SORTS,
  useInventoryParams,
} from './inventory/inventoryParams'
import { VehicleRow } from './inventory/VehicleRow'

export function InventoryPage() {
  const { query, update, clearAll, clearCount } = useInventoryParams()
  const inventory = useInventory(query)
  const data = inventory.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1
  const page = query.page ?? 1
  const filterCount = activeFilterCount(query)
  const listTop = useRef<HTMLDivElement>(null)

  const goToPage = (next: number) => {
    update({ page: next })
    listTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="lg:grid lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-8">
      <aside aria-label="Filters" className="hidden lg:block">
        <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pr-2 pb-6">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-display text-xl font-bold">Filters</h2>
            {filterCount > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-action hover:text-action-hover text-sm font-semibold"
              >
                Clear all
              </button>
            )}
          </div>
          <FilterPanel query={query} data={data} update={update} clearCount={clearCount} />
        </div>
      </aside>

      <section aria-labelledby="inventory-heading" className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <h1 id="inventory-heading" className="font-display text-3xl font-bold tracking-tight">
              Run list
            </h1>
            <p className="text-ink-muted text-sm" aria-live="polite">
              {data ? plural(data.total, 'vehicle') : 'Loading vehicles…'}
            </p>
          </div>
          <LightsLegend />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <SearchBox value={query.q ?? ''} onSearch={(q) => update({ q }, { replace: true })} />
          <FilterSheet activeCount={filterCount} total={data?.total} onClear={clearAll}>
            <FilterPanel query={query} data={data} update={update} clearCount={clearCount} />
          </FilterSheet>
          <SortSelect value={query.sort ?? 'ending_soon'} onChange={(sort) => update({ sort })} />
        </div>

        <ActiveFilterChips query={query} onRemove={update} onClearAll={clearAll} />

        <div ref={listTop} className="mt-4 scroll-mt-20">
          {inventory.isPending ? (
            <RowSkeletons />
          ) : inventory.isError && !data ? (
            <Notice
              title="Couldn't load the run list"
              body={inventory.error.message}
              action={{ label: 'Try again', onClick: () => void inventory.refetch() }}
            />
          ) : data && data.items.length === 0 && data.total > 0 ? (
            // A stale link or a shrinking list can point past the last page.
            <Notice
              title={`Page ${page} is past the end of the list`}
              body={`There are ${pages} pages of results.`}
              action={{ label: 'Go to the first page', onClick: () => goToPage(1) }}
              role="status"
            />
          ) : data && data.items.length === 0 ? (
            <EmptyResults query={query} onRemove={update} onClearAll={clearAll} />
          ) : (
            data && (
              <div
                className="border-line overflow-hidden rounded-[var(--radius-panel)] border transition-opacity"
                style={{ opacity: inventory.isPlaceholderData ? 0.6 : 1 }}
                aria-busy={inventory.isPlaceholderData}
              >
                {data.items.map((vehicle) => (
                  <VehicleRow key={vehicle.id} vehicle={vehicle} />
                ))}
              </div>
            )
          )}
        </div>

        {data && pages > 1 && (
          <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-4">
            <PageButton disabled={page <= 1} onClick={() => goToPage(page - 1)}>
              Previous
            </PageButton>
            <p className="text-ink-muted tabular text-sm">
              Page {page} of {pages}
            </p>
            <PageButton disabled={page >= pages} onClick={() => goToPage(page + 1)}>
              Next
            </PageButton>
          </nav>
        )}
      </section>
    </div>
  )
}

/** Debounced: updates the URL (replacing history) a moment after typing stops. */
function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [applied, setApplied] = useState(value)
  const id = useId()

  // Follow outside changes (e.g. the search chip was removed) without an effect: React's
  // "adjust state while rendering" pattern. Only overwrite the draft if it really differs.
  if (value !== applied) {
    setApplied(value)
    if (value !== draft.trim()) setDraft(value)
  }

  // The latest onSearch without making it a dependency: a parent re-render (e.g. live bids
  // updating the list) must not restart the debounce timer.
  const commit = useEffectEvent((q: string) => onSearch(q))
  useEffect(() => {
    if (draft.trim() === value) return
    const timer = setTimeout(() => commit(draft.trim()), 300)
    return () => clearTimeout(timer)
  }, [draft, value])

  // The browser would cut over-long pasted or dropped text mid-emoji. Insert only the whole
  // characters that fit instead, keeping what's typed. Text dragged within the box is left to
  // the browser: moving it can't make the value longer.
  const draggingFromBox = useRef(false)
  const insertWithinLimit = (
    event: ClipboardEvent<HTMLInputElement> | DragEvent<HTMLInputElement>,
    text: string,
    at: 'selection' | 'end',
  ) => {
    const input = event.currentTarget
    // Measure what the field will actually hold: a one-line input strips line breaks.
    const inserted = text.replace(/[\r\n]/g, '')
    const start = at === 'end' ? input.value.length : (input.selectionStart ?? input.value.length)
    const end = at === 'end' ? start : (input.selectionEnd ?? start)
    const room = SEARCH_MAX_LENGTH - (input.value.length - (end - start))
    if (inserted.length <= room) return // fits: the browser does it
    event.preventDefault()
    const fitting = limitSearch(inserted, Math.max(0, room))
    input.focus()
    input.setSelectionRange(start, end)
    // insertText goes through the browser's editing, so Cmd/Ctrl+Z undoes it as usual.
    if (
      typeof document.execCommand === 'function' &&
      document.execCommand('insertText', false, fitting)
    ) {
      return
    }
    setDraft(input.value.slice(0, start) + fitting + input.value.slice(end))
    requestAnimationFrame(() =>
      input.setSelectionRange(start + fitting.length, start + fitting.length),
    )
  }

  return (
    <div className="relative min-w-0 flex-1 basis-full sm:basis-64">
      <label htmlFor={id} className="sr-only">
        Search inventory
      </label>
      <Search
        size={18}
        aria-hidden
        className="text-ink-faint pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
      />
      <input
        id={id}
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onPaste={(event) =>
          insertWithinLimit(event, event.clipboardData.getData('text'), 'selection')
        }
        onDragStart={() => (draggingFromBox.current = true)}
        onDragEnd={() => (draggingFromBox.current = false)}
        onDrop={(event) => {
          if (draggingFromBox.current) return
          // A drop point inside a text field can't be read, so dropped text goes at the end.
          insertWithinLimit(event, event.dataTransfer.getData('text'), 'end')
        }}
        placeholder="Make, model, VIN, lot or city"
        // Typing past the limit is refused in place; pastes and drops are cut at a whole character.
        maxLength={SEARCH_MAX_LENGTH}
        className="border-line-strong bg-surface placeholder:text-ink-faint h-10 w-full rounded-[var(--radius-control)] border pr-3 pl-10 text-sm"
      />
    </div>
  )
}

function SortSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (sort: (typeof SORTS)[number]['value']) => void
}) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-ink-muted text-sm max-sm:sr-only">
        Sort
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as (typeof SORTS)[number]['value'])}
        className="border-line-strong bg-surface h-10 rounded-[var(--radius-control)] border px-2 text-sm"
      >
        {SORTS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function EmptyResults({
  query,
  onRemove,
  onClearAll,
}: {
  query: Parameters<typeof activeChips>[0]
  onRemove: Parameters<typeof ChipButton>[0]['onRemove']
  onClearAll: () => void
}) {
  const chips = activeChips(query)
  return (
    <div className="border-line bg-surface rounded-[var(--radius-panel)] border px-6 py-12 text-center">
      <h2 className="font-display text-2xl font-bold">No vehicles match</h2>
      {chips.length > 0 ? (
        <>
          <p className="text-ink-muted mt-1">Try removing a filter:</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {chips.map((chip) => (
              <ChipButton key={chip.key} chip={chip} onRemove={onRemove} />
            ))}
          </div>
          <button
            type="button"
            onClick={onClearAll}
            className="text-action hover:text-action-hover mt-4 text-sm font-semibold"
          >
            Clear all filters
          </button>
        </>
      ) : (
        <p className="text-ink-muted mt-1">There are no open auctions right now.</p>
      )}
    </div>
  )
}

function Notice({
  title,
  body,
  action,
  role = 'alert',
}: {
  title: string
  body: string
  action: { label: string; onClick: () => void }
  role?: 'alert' | 'status'
}) {
  return (
    <div
      role={role}
      className="border-line bg-surface rounded-[var(--radius-panel)] border px-6 py-12 text-center"
    >
      <h2 className="font-display text-2xl font-bold">{title}</h2>
      <p className="text-ink-muted mt-1">{body}</p>
      <button
        type="button"
        onClick={action.onClick}
        className="bg-action text-action-ink hover:bg-action-hover mt-4 h-10 rounded-[var(--radius-control)] px-4 text-sm font-semibold"
      >
        {action.label}
      </button>
    </div>
  )
}

function RowSkeletons() {
  return (
    <div
      aria-hidden
      className="border-line bg-surface overflow-hidden rounded-[var(--radius-panel)] border"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="border-line grid grid-cols-[104px_1fr] gap-4 border-b p-3 sm:grid-cols-[168px_1fr]"
        >
          <div className="bg-surface-sunk aspect-[40/17] rounded-[var(--radius-control)]" />
          <div className="space-y-2 py-1">
            <div className="bg-surface-sunk h-3 w-24 rounded" />
            <div className="bg-surface-sunk h-5 w-3/5 rounded" />
            <div className="bg-surface-sunk h-3 w-2/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

function PageButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="border-line-strong bg-surface h-10 rounded-[var(--radius-control)] border px-4 text-sm font-semibold disabled:opacity-40"
    >
      {children}
    </button>
  )
}
