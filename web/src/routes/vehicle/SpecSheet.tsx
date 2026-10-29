import { Check, Copy } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { VehicleDetail } from '../../api/types'
import { formatKm, label } from '../../lib/format'
import { paintHex, trimHex } from '../../lib/vehicleColors'

export function SpecSheet({ vehicle }: { vehicle: VehicleDetail }) {
  const specs: { term: string; value: ReactNode }[] = [
    { term: 'Odometer', value: <span className="tabular">{formatKm(vehicle.odometer_km)}</span> },
    { term: 'Engine', value: vehicle.engine },
    { term: 'Transmission', value: label(vehicle.transmission) },
    { term: 'Drivetrain', value: label(vehicle.drivetrain) },
    { term: 'Fuel', value: label(vehicle.fuel_type) },
    { term: 'Body style', value: label(vehicle.body_style) },
    {
      term: 'Exterior',
      value: <Swatch color={paintHex(vehicle.exterior_color)} name={vehicle.exterior_color} />,
    },
    {
      term: 'Interior',
      value: <Swatch color={trimHex(vehicle.interior_color)} name={vehicle.interior_color} />,
    },
    { term: 'VIN', value: <Vin vin={vehicle.vin} /> },
  ]
  return (
    <section aria-labelledby="specs-heading">
      <h2 id="specs-heading" className="mb-3 text-lg font-semibold">
        Specs
      </h2>
      <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {specs.map(({ term, value }) => (
          <div key={term} className="border-line flex justify-between gap-4 border-b py-2 text-sm">
            <dt className="text-ink-muted">{term}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Swatch({ color, name }: { color: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className="border-line-strong size-3.5 rounded-full border"
        style={{ background: color }}
      />
      {name}
    </span>
  )
}

function Vin({ vin }: { vin: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(vin)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked: the VIN is still selectable text.
    }
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular tracking-wide select-all">{vin}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'VIN copied' : 'Copy VIN'}
        className="text-ink-faint hover:text-ink grid size-7 place-items-center rounded"
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </span>
  )
}
