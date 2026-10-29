import { ChevronDown } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

/**
 * A native select in the app's field style. The browser's own arrow sits wherever each browser
 * puts it, so it's hidden and drawn here, on the same 12px inset as the text.
 * `className` sizes the wrapper; everything else goes to the select.
 */
export function SelectField({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <span className={cn('relative block', className)}>
      <select {...props} className="field appearance-none pr-9">
        {children}
      </select>
      <ChevronDown
        size={16}
        aria-hidden
        className="text-ink-muted pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
      />
    </span>
  )
}
