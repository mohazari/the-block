/**
 * The Block's mark, drawn once: the header (BlockMark in AppShell) and the browser tab
 * (public/favicon.svg, checked against these by blockMark.test.ts) use the same geometry.
 * Built the way OPENLANE builds its own mark, a closed shape with one part set apart (their open
 * "O"): an OPENLANE Blue tile holding a block whose open side is a separate, lighter bar.
 */
export const MARK = {
  viewBox: '0 0 24 24',
  tileRadius: 6,
  block: 'M10.5 6.75h3a3.5 3.5 0 0 1 3.5 3.5v3.5a3.5 3.5 0 0 1-3.5 3.5h-3',
  bar: 'M7 10v4',
  stroke: 2.75,
  barOpacity: 0.7,
} as const
