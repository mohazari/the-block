import { useId, useState, type ReactNode } from 'react'
import type { FacetValue, InventoryQuery, VehicleList } from '../../api/types'
import { formatKm, label } from '../../lib/format'
import { STATUS_LABEL, type FilterPatch, type ListFilter } from './inventoryParams'

interface Props {
  query: InventoryQuery
  data: VehicleList | undefined
  update: (patch: FilterPatch) => void
}

const STATUS_ORDER = ['live', 'upcoming', 'ended']
const ODOMETER_PRESETS = [25_000, 50_000, 100_000, 150_000]
const GRADE_PRESETS = [2, 3, 4]

/** All inventory filters. Rendered in the desktop rail and inside the mobile sheet. */
export function FilterPanel({ query, data, update }: Props) {
  const facets = data?.facets ?? {}
  const ranges = data?.ranges

  return (
    <div className="space-y-6">
      <CheckboxGroup
        legend="Auction"
        name="status"
        values={facets.status}
        selected={query.status ?? []}
        onChange={(status) => update({ status })}
        format={(value) => STATUS_LABEL[value as keyof typeof STATUS_LABEL] ?? label(value)}
        order={STATUS_ORDER}
        hint={query.status?.length ? undefined : 'Showing live and upcoming'}
      />

      <Toggle
        label="Buy Now available"
        checked={query.buy_now ?? false}
        onChange={(buy_now) => update({ buy_now })}
      />

      <RangeInputs
        legend="Price"
        prefix="$"
        min={query.price_min}
        max={query.price_max}
        bounds={ranges?.price}
        step={500}
        onChange={(price_min, price_max) => update({ price_min, price_max })}
      />

      <CheckboxGroup
        legend="Make"
        name="make"
        values={facets.make}
        selected={query.make ?? []}
        onChange={(make) => update({ make })}
        collapseAfter={6}
      />

      <CheckboxGroup
        legend="Body style"
        name="body_style"
        values={facets.body_style}
        selected={query.body_style ?? []}
        onChange={(body_style) => update({ body_style })}
      />

      <RangeInputs
        legend="Model year"
        min={query.year_min}
        max={query.year_max}
        bounds={ranges?.year}
        onChange={(year_min, year_max) => update({ year_min, year_max })}
      />

      <Select
        label="Mileage"
        value={query.odometer_max}
        options={ODOMETER_PRESETS.map((km) => ({ value: km, label: `Under ${formatKm(km)}` }))}
        anyLabel="Any mileage"
        onChange={(odometer_max) => update({ odometer_max })}
      />

      <Select
        label="Condition grade"
        value={query.grade_min}
        options={GRADE_PRESETS.map((grade) => ({ value: grade, label: `${grade}.0 and up` }))}
        anyLabel="Any grade"
        onChange={(grade_min) => update({ grade_min })}
      />

      <CheckboxGroup
        legend="Title"
        name="title_status"
        values={facets.title_status}
        selected={query.title_status ?? []}
        onChange={(title_status) => update({ title_status })}
      />

      <CheckboxGroup
        legend="Province"
        name="province"
        values={facets.province}
        selected={query.province ?? []}
        onChange={(province) => update({ province })}
        collapseAfter={4}
      />

      <CheckboxGroup
        legend="Fuel"
        name="fuel_type"
        values={facets.fuel_type}
        selected={query.fuel_type ?? []}
        onChange={(fuel_type) => update({ fuel_type })}
      />

      <CheckboxGroup
        legend="Drivetrain"
        name="drivetrain"
        values={facets.drivetrain}
        selected={query.drivetrain ?? []}
        onChange={(drivetrain) => update({ drivetrain })}
      />
    </div>
  )
}

function Group({ legend, hint, children }: { legend: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      {hint && <p className="text-ink-faint -mt-1 mb-2 text-xs">{hint}</p>}
      {children}
    </fieldset>
  )
}

function CheckboxGroup({
  legend,
  name,
  values = [],
  selected,
  onChange,
  format = label,
  collapseAfter,
  hint,
  order,
}: {
  legend: string
  name: ListFilter
  values?: FacetValue[]
  selected: string[]
  onChange: (next: string[]) => void
  format?: (value: string) => string
  collapseAfter?: number
  hint?: string
  /** Explicit value order; otherwise alphabetical. Never by count: boxes mustn't move on click. */
  order?: string[]
}) {
  const [expanded, setExpanded] = useState(false)
  const sorted = [...values].sort((a, b) =>
    order
      ? order.indexOf(a.value) - order.indexOf(b.value)
      : format(a.value).localeCompare(format(b.value)),
  )
  // Selected values always stay visible, even when the list is collapsed.
  const visible =
    collapseAfter && !expanded
      ? sorted.filter((facet, index) => index < collapseAfter || selected.includes(facet.value))
      : sorted
  const hidden = sorted.length - visible.length

  const toggle = (value: string, checked: boolean) =>
    onChange(checked ? [...selected, value] : selected.filter((item) => item !== value))

  return (
    <Group legend={legend} hint={hint}>
      <ul className="space-y-1">
        {visible.map((facet) => (
          <li key={facet.value}>
            <label className="flex min-h-9 items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                name={name}
                value={facet.value}
                checked={selected.includes(facet.value)}
                onChange={(event) => toggle(facet.value, event.target.checked)}
                className="size-4 accent-[var(--action)]"
              />
              <span className="flex-1">{format(facet.value)}</span>
              <span className="text-ink-faint tabular text-xs">{facet.count}</span>
            </label>
          </li>
        ))}
      </ul>
      {collapseAfter && values.length > collapseAfter && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="text-action hover:text-action-hover mt-1 text-sm font-semibold"
        >
          {expanded ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </Group>
  )
}

function Toggle({
  label: text,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex min-h-9 items-center gap-2.5 text-sm font-semibold">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-[var(--action)]"
      />
      {text}
    </label>
  )
}

function Select({
  label: text,
  value,
  options,
  anyLabel,
  onChange,
}: {
  label: string
  value: number | null | undefined
  options: { value: number; label: string }[]
  anyLabel: string
  onChange: (value: number | null) => void
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold">
        {text}
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
        className="border-line-strong bg-surface h-10 w-full rounded-[var(--radius-control)] border px-2 text-sm"
      >
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Min/max number inputs that apply on blur or Enter — not on every keystroke. */
function RangeInputs({
  legend,
  prefix,
  min,
  max,
  bounds,
  step = 1,
  onChange,
}: {
  legend: string
  prefix?: string
  min: number | null | undefined
  max: number | null | undefined
  bounds?: { min: number; max: number }
  step?: number
  onChange: (min: number | null, max: number | null) => void
}) {
  const [low, setLow] = useState(min?.toString() ?? '')
  const [high, setHigh] = useState(max?.toString() ?? '')
  // Follow outside changes (a chip removed, "Clear all") by adjusting state while rendering. No
  // remount: remounting on commit would drop focus when tabbing from Min to Max.
  const [applied, setApplied] = useState([min, max])
  if (applied[0] !== min || applied[1] !== max) {
    setApplied([min, max])
    setLow(min?.toString() ?? '')
    setHigh(max?.toString() ?? '')
  }
  const parse = (text: string) => (text.trim() === '' ? null : Number(text))

  const commit = () => {
    let next = [parse(low), parse(high)] as const
    if (next[0] !== null && next[1] !== null && next[0] > next[1]) next = [next[1], next[0]]
    if (next[0] !== (min ?? null) || next[1] !== (max ?? null)) onChange(next[0], next[1])
  }
  const field =
    'h-10 w-full min-w-0 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-sm tabular'

  return (
    <Group legend={legend}>
      <div className="flex items-center gap-2">
        {(['Min', 'Max'] as const).map((which) => (
          <label key={which} className="flex flex-1 items-center gap-1 text-sm">
            <span className="sr-only">
              {which} {legend.toLowerCase()}
            </span>
            {prefix && <span className="text-ink-faint">{prefix}</span>}
            <input
              type="number"
              inputMode="numeric"
              step={step}
              placeholder={
                bounds ? String(which === 'Min' ? bounds.min : bounds.max) : which.toLowerCase()
              }
              value={which === 'Min' ? low : high}
              onChange={(event) => (which === 'Min' ? setLow : setHigh)(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => event.key === 'Enter' && commit()}
              className={field}
            />
          </label>
        ))}
      </div>
    </Group>
  )
}
