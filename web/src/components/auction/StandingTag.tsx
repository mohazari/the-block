import type { Standing } from '../../lib/auction'
import { cn } from '../../lib/cn'

const STYLE: Record<Exclude<Standing, null>, { text: string; className: string }> = {
  winning: { text: "You're winning", className: 'bg-win-soft text-win' },
  outbid: { text: 'Outbid', className: 'bg-outbid-soft text-outbid' },
  won: { text: 'You won', className: 'bg-win-soft text-win' },
  lost: { text: 'Not won', className: 'bg-surface-sunk text-ink-muted' },
}

export function StandingTag({ standing, className }: { standing: Standing; className?: string }) {
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
