import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CarIllustration } from './CarIllustration'

describe('CarIllustration', () => {
  it('draws the vehicle in its paint colour with an accessible name', () => {
    render(<CarIllustration bodyStyle="truck" paint="Burgundy" title="2023 Ram 1500 in Burgundy" />)
    const image = screen.getByRole('img', { name: '2023 Ram 1500 in Burgundy' })
    expect(image.querySelector('[data-part="body"]')?.getAttribute('fill')).toBe('#6b1f2a')
  })

  it('is hidden from assistive tech when decorative', () => {
    const { container } = render(<CarIllustration bodyStyle="SUV" paint="Silver" />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('falls back to a sedan profile for unknown body styles', () => {
    const { container } = render(<CarIllustration bodyStyle="limousine" paint="Black" />)
    expect(container.querySelectorAll('circle').length).toBeGreaterThan(0)
  })
})
