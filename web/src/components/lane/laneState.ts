import { createContext, useContext, type RefObject } from 'react'
import { toSearchParams } from '../../api/client'
import type { LanePick } from '../../api/types'

export type Search = Record<string, string | number | boolean | string[] | undefined>

export type Turn =
  | { id: string; role: 'buyer'; text: string }
  | {
      id: string
      role: 'lane'
      text: string
      /** What Lane did on the way, e.g. "Searching the run list". */
      steps: string[]
      picks: LanePick[]
      search: Search | null
      problem: { code: string; message: string } | null
      pending: boolean
    }
export type LaneTurn = Extract<Turn, { role: 'lane' }>

export interface Choice {
  model: string | null
  effort: string | null
}

export const CHOICE_KEY = 'the-block:lane-choice'

export function storedChoice(): Choice {
  try {
    const saved = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null') as Partial<Choice> | null
    return { model: saved?.model ?? null, effort: saved?.effort ?? null }
  } catch {
    return { model: null, effort: null }
  }
}

export function saveChoice(choice: Choice): void {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice))
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

export function timeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

export interface LaneState {
  open: boolean
  setOpen: (open: boolean) => void
  /** The header button: focus goes back to it when the panel closes. */
  buttonRef: RefObject<HTMLButtonElement | null>
  turns: Turn[]
  answering: boolean
  choice: Choice
  setChoice: (choice: Choice) => void
  ask: (text: string, vehicleId?: string) => void
  stop: () => void
  newChat: () => void
}

export const LaneContext = createContext<LaneState | null>(null)

export function useLane(): LaneState {
  const state = useContext(LaneContext)
  if (!state) throw new Error('useLane needs a LaneProvider')
  return state
}

/** The run list's URL for Lane's search: the same filters, so the buyer can browse them all. */
export function runListUrl(search: Search): string {
  const params = toSearchParams(search)
  return params.size > 0 ? `/?${params}` : '/'
}
