/** Paint and trim names from the dataset → swatches for illustrations and spec chips. */
const PAINT: Record<string, string> = {
  White: '#f2f3f5',
  'Pearl White': '#eeede6',
  'Glacier White': '#f4f6f8',
  'Oxford White': '#f1f1ee',
  'Platinum White': '#e9e8e3',
  Black: '#24282d',
  'Shadow Black': '#1f2226',
  'Crystal Black': '#1a1c20',
  Silver: '#b8bec6',
  'Iconic Silver': '#c3c7cc',
  'Celestial Silver': '#b9c0c8',
  'Lunar Silver': '#aeb4ba',
  Grey: '#7c848d',
  'Magnetic Grey': '#5b636b',
  Red: '#b3261e',
  'Rapid Red': '#a3171f',
  Burgundy: '#6b1f2a',
  Blue: '#2453a6',
  'Dark Blue': '#1d2f5c',
  'Midnight Blue': '#1b2440',
  Green: '#2f6b3a',
  'Dark Green': '#1f3d2b',
  Bronze: '#8c6239',
  Champagne: '#cdb891',
  Orange: '#d9661f',
}

const TRIM: Record<string, string> = {
  Black: '#23262a',
  Grey: '#7d838a',
  'Dark Grey': '#4a4f55',
  'Light Grey': '#b6bbc0',
  Tan: '#b8956a',
  Beige: '#d4c3a3',
  Brown: '#6b4a2f',
  'Saddle Brown': '#8b5a2b',
  Cognac: '#9a4e1c',
  Red: '#8e1f24',
  White: '#ecebe7',
  Cream: '#e8dfc8',
}

const FALLBACK = '#8a939d'

export const paintHex = (name: string): string => PAINT[name] ?? FALLBACK
export const trimHex = (name: string): string => TRIM[name] ?? FALLBACK
