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
      /** What Lane did on the way, e.g. "Searching the inventory". */
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

const CHOICE_KEY = 'the-block:lane-choice'

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

/**
 * Whether Lane is open, in a context of its own: the page shell needs it, and mustn't re-render
 * with every word of an answer.
 */
export interface LaneOpenState {
  open: boolean
  setOpen: (open: boolean) => void
  /** The header button: focus goes back to it when the panel closes. */
  buttonRef: RefObject<HTMLButtonElement | null>
}

export interface LaneChatState {
  turns: Turn[]
  answering: boolean
  choice: Choice
  setChoice: (choice: Choice) => void
  ask: (text: string, vehicleId?: string) => void
  stop: () => void
  newChat: () => void
}

export type LaneState = LaneOpenState & LaneChatState

export const LaneOpenContext = createContext<LaneOpenState | null>(null)
export const LaneChatContext = createContext<LaneChatState | null>(null)

export function useLaneOpen(): LaneOpenState {
  const state = useContext(LaneOpenContext)
  if (!state) throw new Error('useLaneOpen needs a LaneProvider')
  return state
}

/** Everything about Lane, the conversation included: for the panel itself. */
export function useLane(): LaneState {
  const chat = useContext(LaneChatContext)
  if (!chat) throw new Error('useLane needs a LaneProvider')
  return { ...useLaneOpen(), ...chat }
}

/** The inventory's URL for Lane's search: the same filters, so the buyer can browse them all. */
export function inventoryUrl(search: Search): string {
  const params = toSearchParams(search)
  return params.size > 0 ? `/?${params}` : '/'
}
