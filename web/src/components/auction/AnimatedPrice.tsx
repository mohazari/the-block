import { m, useReducedMotion, useSpring, useTransform } from 'motion/react'
import { useEffect } from 'react'
import { formatMoney } from '../../lib/format'
import { cn } from '../../lib/cn'

/**
 * The price counts up to its new value when a bid lands, so a change reads as a change rather
 * than a silent swap. Reduced motion shows the new value immediately.
 */
export function AnimatedPrice({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion()
  // Critically damped and allowed to rest within half a dollar: the display is rounded, and a
  // long creep through "$13,997" reads like a real (wrong) price. Found in live QA.
  const spring = useSpring(value, { stiffness: 170, damping: 26, mass: 0.6, restDelta: 0.5 })
  const text = useTransform(spring, (latest) => formatMoney(Math.round(latest)))

  useEffect(() => {
    if (reduced) spring.jump(value)
    else spring.set(value)
  }, [value, reduced, spring])

  return (
    <span className={cn('tabular', className)}>
      <m.span aria-hidden>{text}</m.span>
      {/* Screen readers get the settled value, not every frame of the count. */}
      <span className="sr-only">{formatMoney(value)}</span>
    </span>
  )
}
