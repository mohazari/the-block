import { Popover } from 'radix-ui'
import { Info } from 'lucide-react'
import {
  LIGHT_LABEL,
  LIGHT_MEANING,
  conditionLight,
  type ConditionLight as Light,
} from '../../lib/condition'
import { cn } from '../../lib/cn'
import type { VehicleSummary } from '../../api/types'

const DOT: Record<Light, string> = {
  green: 'bg-win',
  yellow: 'bg-caution-bright',
  red: 'bg-outbid',
}

export function LightDot({ light, className }: { light: Light; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'ring-surface inline-block size-2.5 shrink-0 rounded-full ring-2',
        DOT[light],
        className,
      )}
    />
  )
}

type Props = Pick<VehicleSummary, 'title_status' | 'worst_damage' | 'condition_grade'> & {
  className?: string
}

/** "● Green light  Grade 4.2" — the at-a-glance trust signal on every row and detail page. */
export function ConditionLight({ className, ...vehicle }: Props) {
  const light = conditionLight(vehicle)
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm', className)}>
      <LightDot light={light} />
      <span className="font-semibold">{LIGHT_LABEL[light]}</span>
      <span className="text-ink-muted tabular">Grade {vehicle.condition_grade.toFixed(1)}</span>
    </span>
  )
}

/** Explains the lights — they're borrowed from the physical auction lane. */
export function LightsLegend() {
  return (
    <Popover.Root>
      <Popover.Trigger className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-sm">
        <Info size={15} aria-hidden />
        How condition lights work
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          align="start"
          className="border-line bg-surface z-50 w-80 rounded-[var(--radius-panel)] border p-4 text-sm shadow-lg"
        >
          <p className="text-ink-muted mb-3">
            Like the lights over a physical auction lane, each car gets a light from its title and
            the damage noted in its condition report.
          </p>
          <ul className="space-y-2">
            {(['green', 'yellow', 'red'] as const).map((light) => (
              <li key={light} className="flex gap-2">
                <LightDot light={light} className="mt-1.5" />
                <span>
                  <span className="font-semibold">{LIGHT_LABEL[light]}.</span>{' '}
                  {LIGHT_MEANING[light]}
                </span>
              </li>
            ))}
          </ul>
          <Popover.Arrow className="fill-surface" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
