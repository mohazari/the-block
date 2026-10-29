import type { AuctionSnapshot, VehicleDetail, VehicleList, VehicleSummary } from '../api/types'

const HOUR = 3_600_000

export function auction(overrides: Partial<AuctionSnapshot> = {}): AuctionSnapshot {
  return {
    status: 'live',
    starts_at: new Date(Date.now() - HOUR).toISOString(),
    ends_at: new Date(Date.now() + 2 * HOUR).toISOString(),
    starting_bid: 14500,
    current_bid: 22800,
    bid_count: 16,
    min_next_bid: 23300,
    increment: 500,
    max_bid: 69900,
    reserve_status: 'not_met',
    buy_now_price: null,
    buy_now_available: false,
    outcome: null,
    is_high_bidder: false,
    has_bid: false,
    ...overrides,
  }
}

export function vehicle(overrides: Partial<VehicleSummary> = {}): VehicleSummary {
  return {
    id: 'veh-1',
    lot: 'A-0043',
    vin: 'TRD7L1KS0HNB5X3K3',
    year: 2023,
    make: 'Ford',
    model: 'Bronco',
    trim: 'Big Bend',
    body_style: 'SUV',
    exterior_color: 'Burgundy',
    transmission: 'automatic',
    drivetrain: '4WD',
    fuel_type: 'gasoline',
    odometer_km: 47731,
    condition_grade: 3.8,
    title_status: 'clean',
    city: 'Toronto',
    province: 'Ontario',
    selling_dealership: 'King City Auto',
    image_count: 4,
    damage_count: 1,
    worst_damage: 'cosmetic',
    watching: false,
    auction: auction(),
    ...overrides,
  }
}

export function vehicleList(
  items: VehicleSummary[],
  overrides: Partial<VehicleList> = {},
): VehicleList {
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 24,
    facets: {
      status: [{ value: 'live', count: items.length }],
      make: [
        { value: 'Ford', count: 16 },
        { value: 'BMW', count: 14 },
      ],
    },
    ranges: {
      year: { min: 2016, max: 2026 },
      price: { min: 2500, max: 77000 },
      odometer_km: { min: 500, max: 273340 },
    },
    server_time: new Date().toISOString(),
    ...overrides,
  }
}

/** A fetch stub routing by URL; records each request URL. */
export function stubApi(routes: (url: URL, init?: RequestInit) => unknown) {
  const calls: URL[] = []
  const fetch = async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://test')
    calls.push(url)
    const body = routes(url, init)
    if (body instanceof Response) return body
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status: body === undefined ? 204 : 200,
    })
  }
  return { fetch, calls }
}

export function vehicleDetail(overrides: Partial<VehicleDetail> = {}): VehicleDetail {
  return {
    ...vehicle(),
    interior_color: 'Beige',
    engine: '2.7L EcoBoost V6',
    condition_report:
      'Average condition. Engine and transmission perform within normal parameters.',
    damage: [
      { note: 'Scratch on liftgate', severity: 'cosmetic' },
      { note: 'Transmission slips between 2nd and 3rd gear', severity: 'mechanical' },
      { note: 'Flood damage - electrical issues present', severity: 'major' },
    ],
    images: ['a', 'b', 'c', 'd'],
    recent_bids: [
      {
        id: 7,
        amount: 22800,
        bidder: 'Bidder 4821',
        is_you: false,
        placed_at: new Date().toISOString(),
      },
    ],
    recent_bids_limit: 10,
    server_time: new Date().toISOString(),
    ...overrides,
  }
}
