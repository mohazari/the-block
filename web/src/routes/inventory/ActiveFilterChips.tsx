import type { InventoryQuery } from '../../api/types'
import { X } from 'lucide-react'
import { activeChips, type Chip } from './activeChips'
import type { FilterPatch } from './inventoryParams'

export function ActiveFilterChips({
  query,
  onRemove,
  onClearAll,
}: {
  query: InventoryQuery
  onRemove: (patch: FilterPatch) => void
  onClearAll: () => void
}) {
  const chips = activeChips(query)
  if (chips.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters">
      {chips.map((chip) => (
        <ChipButton key={chip.key} chip={chip} onRemove={onRemove} />
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-action hover:text-action-hover h-8 px-2 text-sm font-semibold"
        >
          Clear all
        </button>
      )}
    </div>
  )
}

export function ChipButton({
  chip,
  onRemove,
}: {
  chip: Chip
  onRemove: (patch: FilterPatch) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onRemove(chip.remove)}
      aria-label={`Remove filter: ${chip.text}`}
      className="border-line-strong bg-surface hover:border-ink-faint inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border pr-2 pl-3 text-sm"
    >
      {chip.text}
      <X size={14} aria-hidden className="text-ink-faint" />
    </button>
  )
}
