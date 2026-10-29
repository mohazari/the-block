import { useId } from 'react'
import { paintHex } from '../lib/vehicleColors'
import { VIEWS, type View } from './carViews'

/**
 * Stand-in for vehicle photos. The dataset only has placeholder image URLs, so instead of grey
 * boxes we draw the vehicle's body style in its actual paint colour. Each "photo" in the dataset
 * maps to a view of the same drawing (crops of the viewBox), labelled as an illustration.
 */

interface Profile {
  body: string
  glass: string
  pillars: number[]
  doors: number[]
  wheels: [number, number]
  radius: number
  headlight: [number, number, number, number]
  taillight: [number, number, number, number]
  mirror: [number, number]
  beltY: number
}

// Side profiles in a 400×170 box, ground at y=150, nose to the left.
const PROFILES: Record<string, Profile> = {
  sedan: {
    body: 'M30,124 C26,112 30,104 44,100 L132,92 C150,78 165,66 182,62 L252,61 C270,62 290,80 308,90 L360,93 C370,95 374,104 372,114 L370,126 C369,130 366,131 360,131 L332,131 A32,32 0 0 0 268,131 L132,131 A32,32 0 0 0 68,131 L38,131 C33,131 31,128 30,124 Z',
    glass: 'M150,90 C162,78 172,69 185,67 L248,67 C262,68 278,79 292,89 Z',
    pillars: [222],
    doors: [152, 224, 292],
    wheels: [100, 300],
    radius: 27,
    headlight: [34, 104, 16, 6],
    taillight: [362, 98, 10, 7],
    mirror: [146, 86],
    beltY: 108,
  },
  coupe: {
    body: 'M30,124 C26,112 30,106 44,103 L140,96 C160,80 178,68 200,64 L245,63 C268,64 300,82 330,94 L362,97 C370,98 374,106 372,116 L370,126 C369,130 366,131 360,131 L332,131 A32,32 0 0 0 268,131 L132,131 A32,32 0 0 0 68,131 L38,131 C33,131 31,128 30,124 Z',
    glass: 'M160,93 C174,81 188,72 204,70 L242,69 C258,70 280,80 300,91 Z',
    pillars: [246],
    doors: [162, 262],
    wheels: [100, 300],
    radius: 27,
    headlight: [34, 107, 16, 5],
    taillight: [362, 101, 10, 6],
    mirror: [156, 90],
    beltY: 110,
  },
  hatchback: {
    body: 'M44,124 C40,112 44,104 58,101 L128,94 C145,78 160,64 178,60 L300,58 C315,58 330,70 340,84 L352,92 C358,96 360,104 359,114 L358,126 C357,130 354,131 348,131 L322,131 A31,31 0 0 0 260,131 L140,131 A31,31 0 0 0 78,131 L52,131 C47,131 45,128 44,124 Z',
    glass: 'M146,92 C158,79 170,69 182,66 L298,65 C310,65 322,74 332,86 Z',
    pillars: [230],
    doors: [148, 232, 320],
    wheels: [109, 291],
    radius: 26,
    headlight: [48, 105, 15, 6],
    taillight: [348, 94, 9, 9],
    mirror: [142, 88],
    beltY: 108,
  },
  SUV: {
    body: 'M28,122 C24,108 28,96 42,92 L118,85 C135,70 148,54 165,49 L345,46 C360,46 368,52 371,62 L375,112 C376,124 372,129 364,129 L339,129 A34,34 0 0 0 271,129 L129,129 A34,34 0 0 0 61,129 L38,129 C32,129 29,127 28,122 Z',
    glass: 'M136,84 C148,70 158,58 170,55 L340,53 C350,53 356,58 358,66 L360,82 Z',
    pillars: [232, 300],
    doors: [138, 234, 302],
    wheels: [95, 305],
    radius: 30,
    headlight: [32, 97, 16, 8],
    taillight: [364, 66, 8, 16],
    mirror: [132, 80],
    beltY: 100,
  },
  truck: {
    body: 'M20,120 C17,104 22,92 36,89 L120,84 C130,70 138,54 150,48 L222,46 C230,46 234,50 235,58 L236,84 L376,84 C380,84 382,88 382,92 L382,118 C382,126 378,129 370,129 L352,129 A35,35 0 0 0 282,129 L128,129 A35,35 0 0 0 58,129 L30,129 C24,129 21,126 20,120 Z',
    glass: 'M130,82 C138,70 146,57 156,54 L224,52 C228,52 229,55 229,58 L229,82 Z',
    pillars: [190],
    doors: [132, 192, 234],
    wheels: [93, 317],
    radius: 31,
    headlight: [24, 94, 16, 9],
    taillight: [376, 90, 6, 14],
    mirror: [126, 78],
    beltY: 100,
  },
}

const GROUND = 150

interface Props {
  bodyStyle: string
  paint: string
  view?: View
  /** Accessible name, e.g. "2023 Ford Bronco in Burgundy, driver side". Omit when decorative. */
  title?: string
  className?: string
}

export function CarIllustration({ bodyStyle, paint, view = 'driver', title, className }: Props) {
  const profile = PROFILES[bodyStyle] ?? PROFILES.sedan!
  const color = paintHex(paint)
  const glassClip = useId()
  const { viewBox, mirror } = VIEWS[view]
  const [hx, hy, hw, hh] = profile.headlight
  const [tx, ty, tw, th] = profile.taillight
  const wheelY = GROUND - profile.radius + 2

  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid slice"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect x="0" y="0" width="400" height="170" fill="var(--stage)" />
      <rect x="0" y="132" width="400" height="38" fill="var(--stage-floor)" />
      <g transform={mirror ? 'translate(400 0) scale(-1 1)' : undefined}>
        <ellipse cx="200" cy={GROUND} rx="178" ry="6" fill="#000" opacity="0.16" />
        <defs>
          <clipPath id={glassClip}>
            <path d={profile.glass} />
          </clipPath>
        </defs>
        <path data-part="body" d={profile.body} fill={color} />
        <path
          d={`M40,${profile.beltY} L370,${profile.beltY - 2}`}
          stroke="#fff"
          strokeOpacity="0.28"
          strokeWidth="2"
        />
        <path d={profile.glass} fill="#26313d" fillOpacity="0.92" />
        <g clipPath={`url(#${glassClip})`} stroke={color} strokeWidth="5">
          {profile.pillars.map((x) => (
            <line key={x} x1={x} y1="40" x2={x} y2="100" />
          ))}
        </g>
        <g stroke="#1c2430" strokeOpacity="0.3" strokeWidth="1.2">
          {profile.doors.map((x) => (
            <line key={x} x1={x} y1={profile.beltY - 12} x2={x + 2} y2="128" />
          ))}
        </g>
        <path d={profile.body} fill="none" stroke="var(--car-outline)" strokeWidth="1.4" />
        <rect
          x={profile.mirror[0]}
          y={profile.mirror[1]}
          width="9"
          height="6"
          rx="2"
          fill={color}
          stroke="var(--car-outline)"
        />
        <rect
          x={hx}
          y={hy}
          width={hw}
          height={hh}
          rx="3"
          fill="#f4f1de"
          stroke="#1c2430"
          strokeOpacity="0.35"
        />
        <rect
          x={tx}
          y={ty}
          width={tw}
          height={th}
          rx="2"
          fill="#c8322b"
          stroke="#1c2430"
          strokeOpacity="0.35"
        />
        {profile.wheels.map((x) => (
          <Wheel key={x} x={x} y={wheelY} radius={profile.radius} />
        ))}
      </g>
    </svg>
  )
}

function Wheel({ x, y, radius }: { x: number; y: number; radius: number }) {
  const rim = radius * 0.62
  return (
    <g>
      <circle cx={x} cy={y} r={radius} fill="#1c2430" />
      <circle cx={x} cy={y} r={rim} fill="#aab4bf" />
      <g stroke="#6b7783" strokeWidth="3" strokeLinecap="round">
        {[0, 72, 144, 216, 288].map((degrees) => {
          const angle = (degrees * Math.PI) / 180
          return (
            <line
              key={degrees}
              x1={x}
              y1={y}
              x2={x + Math.cos(angle) * rim * 0.92}
              y2={y + Math.sin(angle) * rim * 0.92}
            />
          )
        })}
      </g>
      <circle cx={x} cy={y} r={radius * 0.16} fill="#3a4552" />
    </g>
  )
}
