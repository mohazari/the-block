import { SlidersHorizontal, X } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { Dialog } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { plural } from '../../lib/format'

/**
 * Mobile filters: a bottom sheet over the run list. Radix handles focus trapping, Escape and
 * screen-reader semantics; Motion animates it in and out.
 */
export function FilterSheet({
  activeCount,
  total,
  onClear,
  children,
}: {
  activeCount: number
  total: number | undefined
  onClear: () => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="btn btn-plain px-4 lg:hidden">
        <SlidersHorizontal size={16} aria-hidden />
        Filters{activeCount > 0 && ` (${activeCount})`}
      </Dialog.Trigger>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <m.div
                className="fixed inset-0 z-40 bg-black/40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <m.div
                className="bg-surface fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-[var(--radius-panel)]"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
              >
                <div className="border-line flex items-center justify-between border-b px-4 py-3">
                  <Dialog.Title className="text-lg font-semibold">Filters</Dialog.Title>
                  <Dialog.Close
                    aria-label="Close filters"
                    className="hover:bg-surface-sunk grid size-10 place-items-center rounded-full"
                  >
                    <X size={20} aria-hidden />
                  </Dialog.Close>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
                <div className="border-line flex gap-3 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                  <button
                    type="button"
                    onClick={onClear}
                    disabled={activeCount === 0}
                    className="btn text-ink-muted h-11"
                  >
                    Clear all
                  </button>
                  <Dialog.Close className="btn btn-primary h-11 flex-1">
                    {total === undefined ? 'Show vehicles' : `Show ${plural(total, 'vehicle')}`}
                  </Dialog.Close>
                </div>
              </m.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
