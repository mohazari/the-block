/** Each dataset "photo" maps to a view of the illustration: a crop of its 400×170 viewBox. */
export const VIEWS = {
  driver: { label: 'Driver side', viewBox: '0 0 400 170', mirror: false },
  passenger: { label: 'Passenger side', viewBox: '0 0 400 170', mirror: true },
  front: { label: 'Front', viewBox: '0 40 220 120', mirror: false },
  rear: { label: 'Rear', viewBox: '180 40 220 120', mirror: false },
  wheel: { label: 'Wheel', viewBox: '40 70 130 85', mirror: false },
  cabin: { label: 'Cabin', viewBox: '110 30 240 110', mirror: false },
} as const

export type View = keyof typeof VIEWS
export const VIEW_ORDER: View[] = ['driver', 'passenger', 'front', 'rear', 'wheel', 'cabin']
