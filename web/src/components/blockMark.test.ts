import { expect, it } from 'vitest'
import favicon from '../../public/favicon.svg?raw'
import { MARK } from './blockMark'

it('draws the browser tab icon with the same geometry as the header mark', () => {
  expect(favicon).toContain(`viewBox="${MARK.viewBox}"`)
  expect(favicon).toContain(`rx="${MARK.tileRadius}"`)
  expect(favicon).toContain(`d="${MARK.block}"`)
  expect(favicon).toContain(`d="${MARK.bar}"`)
  expect(favicon).toContain(`stroke-width="${MARK.stroke}"`)
  expect(favicon).toContain(`opacity="${MARK.barOpacity}"`)
  expect(favicon).toContain('fill="#0061FF"') // OPENLANE Blue, as --action in index.css
})
