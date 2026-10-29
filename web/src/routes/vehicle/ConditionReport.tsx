import { AlertTriangle } from 'lucide-react'
import type { DamageNote, DamageSeverity, VehicleDetail } from '../../api/types'
import { ConditionLight } from '../../components/auction/ConditionLight'
import { cn } from '../../lib/cn'

const SEVERITY: Record<DamageSeverity, { title: string; hint: string; dot: string }> = {
  major: {
    title: 'Major',
    hint: 'Frame, flood, airbag or water damage. Get an inspection before bidding.',
    dot: 'bg-outbid',
  },
  mechanical: {
    title: 'Mechanical',
    hint: 'Budget for repairs.',
    dot: 'bg-caution-bright',
  },
  cosmetic: {
    title: 'Cosmetic',
    hint: 'Usually priced in.',
    dot: 'bg-ink-faint',
  },
}
const ORDER: DamageSeverity[] = ['major', 'mechanical', 'cosmetic']

export function ConditionReport({ vehicle }: { vehicle: VehicleDetail }) {
  const groups = ORDER.map((severity) => ({
    severity,
    notes: vehicle.damage.filter((note: DamageNote) => note.severity === severity),
  })).filter((group) => group.notes.length > 0)

  return (
    <section aria-labelledby="condition-heading" className="space-y-4">
      <h2 id="condition-heading" className="font-display text-2xl font-bold">
        Condition
      </h2>

      {vehicle.title_status !== 'clean' && (
        <div className="border-outbid/40 bg-outbid-soft text-outbid flex gap-3 rounded-[var(--radius-panel)] border p-4">
          <AlertTriangle size={20} aria-hidden className="mt-0.5 shrink-0" />
          <p>
            <span className="font-semibold">
              {vehicle.title_status === 'salvage' ? 'Salvage title.' : 'Rebuilt title.'}
            </span>{' '}
            {vehicle.title_status === 'salvage'
              ? 'Declared a total loss by an insurer. Resale, financing and insurance are limited.'
              : 'Previously salvage, repaired and re-inspected. Resale value is lower than a clean title.'}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <ConditionLight
          title_status={vehicle.title_status}
          worst_damage={vehicle.worst_damage}
          condition_grade={vehicle.condition_grade}
        />
        <GradeMeter grade={vehicle.condition_grade} />
      </div>

      <p className="text-ink-muted max-w-prose">{vehicle.condition_report}</p>

      <div>
        <h3 className="mb-2 font-semibold">Damage notes</h3>
        {groups.length === 0 ? (
          <p className="text-ink-muted text-sm">No damage reported.</p>
        ) : (
          <div className="space-y-3">
            {groups.map(({ severity, notes }) => (
              <div
                key={severity}
                className="border-line rounded-[var(--radius-control)] border p-3"
              >
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span aria-hidden className={cn('size-2 rounded-full', SEVERITY[severity].dot)} />
                  <span>
                    {SEVERITY[severity].title} ({notes.length})
                  </span>
                  <span className="text-ink-muted font-normal">{SEVERITY[severity].hint}</span>
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {notes.map((note, index) => (
                    <li key={`${index}-${note.note}`}>{note.note}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

/** Five segments filled to the grade, so 3.8 reads at a glance without a legend. */
function GradeMeter({ grade }: { grade: number }) {
  return (
    <div className="flex items-center gap-2">
      <div
        role="meter"
        aria-valuemin={1}
        aria-valuemax={5}
        aria-valuenow={grade}
        aria-label="Condition grade"
        className="flex gap-1"
      >
        {[1, 2, 3, 4, 5].map((segment) => {
          const fill = Math.min(1, Math.max(0, grade - (segment - 1)))
          return (
            <span
              key={segment}
              className="bg-surface-sunk relative h-2 w-8 overflow-hidden rounded-full"
            >
              <span
                className="bg-ink absolute inset-y-0 left-0"
                style={{ width: `${fill * 100}%` }}
              />
            </span>
          )
        })}
      </div>
      <span className="text-ink-muted tabular text-sm">{grade.toFixed(1)} / 5</span>
    </div>
  )
}
