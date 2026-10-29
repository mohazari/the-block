import { X } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { Link } from 'react-router'
import { cn } from '../../lib/cn'
import { dismissToast, pauseToast, resumeToast, useToasts, type Toast } from './toastStore'

const TONE: Record<Toast['tone'], string> = {
  outbid: 'border-l-outbid',
  win: 'border-l-win',
  info: 'border-l-action',
}

/** Bottom-right on desktop, top on phones (clear of the sticky bid bar). */
export function Toaster() {
  const toasts = useToasts()
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-16 z-50 flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-4 sm:items-end"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <m.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
            onMouseEnter={() => pauseToast(toast.id)}
            onMouseLeave={() => resumeToast(toast.id)}
            onFocus={() => pauseToast(toast.id)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) resumeToast(toast.id)
            }}
            className={cn(
              'border-line bg-surface pointer-events-auto w-full max-w-sm rounded-[var(--radius-panel)] border border-l-4 p-4 shadow-lg',
              TONE[toast.tone],
            )}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{toast.title}</p>
                {toast.body && <p className="text-ink-muted mt-0.5 text-sm">{toast.body}</p>}
                {toast.link && (
                  <Link
                    to={toast.link.to}
                    onClick={() => dismissToast(toast.id)}
                    className="link-action mt-2 inline-block text-sm"
                  >
                    {toast.link.label}
                  </Link>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss"
                className="text-ink-faint hover:text-ink -m-1 grid size-8 place-items-center rounded"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
