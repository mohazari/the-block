import type { Standing } from '../../api/types'
import { cn } from '../../lib/cn'

const STYLE: Record<Standing, { text: string; className: string }> = {
  leading: { text: "You're winning", className: 'bg-win-soft text-win' },
  outbid: { text: 'Outbid', className: 'bg-outbid-soft text-outbid' },
  won: { text: 'You won', className: 'bg-win-soft text-win' },
  lost: { text: 'Not won', className: 'bg-surface-sunk text-ink-muted' },
}

export function StandingTag({
  standing,
  className,
}: {
  standing: Standing | null
  className?: string
}) {
  if (!standing) return null
  const { text, className: tone } = STYLE[standing]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--radius-control)] px-2 py-0.5 text-xs font-semibold',
        tone,
        className,
      )}
    >
      {text}
    </span>
  )
}
