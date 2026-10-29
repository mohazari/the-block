import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderRoute } from '../test/render'

describe('app shell', () => {
  it('renders navigation and the inventory route', () => {
    renderRoute('/')
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inventory' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows a helpful page for unknown routes', () => {
    renderRoute('/nowhere')
    expect(screen.getByRole('heading', { name: 'Nothing on this lane' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse inventory' })).toHaveAttribute('href', '/')
  })

  it('toggles and remembers the theme', async () => {
    document.documentElement.dataset.theme = 'light'
    renderRoute('/')
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument()
  })
})
