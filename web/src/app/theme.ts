import { useCallback, useState } from 'react'

export type Theme = 'light' | 'dark'

const current = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

/** The initial theme is resolved in index.html before paint; this only flips and remembers it. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(current)
  const toggle = useCallback(() => {
    const next: Theme = current() === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('theme', next)
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
    setTheme(next)
  }, [])
  return [theme, toggle]
}
