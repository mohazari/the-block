import { useState } from 'react'
import type { VehicleDetail } from '../../api/types'
import { CarIllustration } from '../../components/CarIllustration'
import { VIEWS, VIEW_ORDER } from '../../components/carViews'
import { cn } from '../../lib/cn'
import { vehicleName } from '../../lib/vehicle'

/** The listing's photos, drawn as views of the vehicle (the dataset has placeholders only). */
export function Gallery({ vehicle }: { vehicle: VehicleDetail }) {
  const views = VIEW_ORDER.slice(0, Math.max(1, vehicle.images.length))
  const [active, setActive] = useState(views[0]!)
  const name = `${vehicleName(vehicle)} in ${vehicle.exterior_color}`

  return (
    <figure>
      <div className="border-line overflow-hidden rounded-[var(--radius-panel)] border">
        <CarIllustration
          bodyStyle={vehicle.body_style}
          paint={vehicle.exterior_color}
          view={active}
          title={`${name}, ${VIEWS[active].label.toLowerCase()}`}
          className="aspect-[40/17] w-full"
        />
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Views">
        {views.map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => setActive(view)}
            aria-pressed={view === active}
            aria-label={VIEWS[view].label}
            className={cn(
              'w-24 shrink-0 overflow-hidden rounded-[var(--radius-control)] border-2',
              view === active ? 'border-action' : 'border-transparent opacity-70 hover:opacity-100',
            )}
          >
            <CarIllustration
              bodyStyle={vehicle.body_style}
              paint={vehicle.exterior_color}
              view={view}
              className="aspect-[40/17] w-full"
            />
          </button>
        ))}
      </div>
      <figcaption className="text-ink-faint mt-1 text-xs">
        Illustrations in the listed paint colour. The listing data didn't include photos.
      </figcaption>
    </figure>
  )
}
