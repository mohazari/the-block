import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../../api/client'
import { laneKeys, stopLane, streamLaneReply, type LaneEvent } from '../../api/lane'
import { newId } from '../../lib/bidder'
import {
  LaneChatContext,
  LaneOpenContext,
  saveChoice,
  storedChoice,
  timeZone,
  type Choice,
  type LaneTurn,
  type Turn,
} from './laneState'

/**
 * Lane's conversation lives here, above the panel, so closing the panel or moving between pages
 * keeps it. A reload starts a new one (the server keeps conversations in memory only).
 */
export function LaneProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [answering, setAnswering] = useState(false)
  const [choice, setChoiceState] = useState<Choice>(storedChoice)
  const conversation = useRef(newId())
  const controller = useRef<AbortController | null>(null)

  const setChoice = useCallback((next: Choice) => {
    setChoiceState(next)
    saveChoice(next)
  }, [])

  const ask = useCallback(
    (text: string, vehicleId?: string) => {
      const replyId = newId()
      setTurns((current) => [
        ...current,
        { id: newId(), role: 'buyer', text },
        {
          id: replyId,
          role: 'lane',
          text: '',
          steps: [],
          picks: [],
          search: null,
          problem: null,
          pending: true,
        },
      ])
      const update = (change: (turn: LaneTurn) => LaneTurn) =>
        setTurns((current) =>
          current.map((turn) =>
            turn.id === replyId && turn.role === 'lane' ? change(turn) : turn,
          ),
        )
      const onEvent = (event: LaneEvent) => {
        switch (event.type) {
          case 'step':
            return update((turn) =>
              turn.steps.at(-1) === event.label
                ? turn
                : { ...turn, steps: [...turn.steps, event.label] },
            )
          case 'text':
            return update((turn) => ({ ...turn, text: turn.text + event.delta }))
          case 'reply':
            return update((turn) => ({
              ...turn,
              text: event.message,
              picks: event.picks,
              search: event.search,
              pending: false,
            }))
          case 'problem':
            if (event.code === 'lane_signed_out') {
              void queryClient.invalidateQueries({ queryKey: laneKeys.status })
            }
            return update((turn) => ({
              ...turn,
              problem: { code: event.code, message: event.message },
              pending: false,
            }))
        }
      }

      const abort = new AbortController()
      controller.current = abort
      setAnswering(true)
      streamLaneReply(
        {
          conversation_id: conversation.current,
          text,
          model: choice.model,
          effort: choice.effort,
          vehicle_id: vehicleId ?? null,
          time_zone: timeZone() ?? null,
        },
        onEvent,
        abort.signal,
      )
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          const problem =
            error instanceof ApiError
              ? { code: error.code, message: error.message }
              : { code: 'lane_failed', message: "Lane couldn't answer that. Try again." }
          // The plan no longer offers the saved model or effort: fall back to the defaults.
          if (problem.code === 'invalid_choice') setChoice({ model: null, effort: null })
          update((turn) => ({ ...turn, problem, pending: false }))
        })
        .finally(() => {
          // A stream can end without a reply (the server went away): never leave it spinning.
          update((turn) =>
            turn.pending
              ? {
                  ...turn,
                  pending: false,
                  problem: turn.problem ?? {
                    code: 'lane_failed',
                    message: "Lane couldn't answer that. Try again.",
                  },
                }
              : turn,
          )
          if (controller.current === abort) {
            controller.current = null
            setAnswering(false)
          }
        })
    },
    [choice, queryClient, setChoice],
  )

  const stop = useCallback(() => {
    void stopLane(conversation.current).catch(() => controller.current?.abort())
  }, [])

  const newChat = useCallback(() => {
    if (controller.current) {
      void stopLane(conversation.current).catch(() => undefined)
      controller.current.abort()
      controller.current = null
    }
    conversation.current = newId()
    setTurns([])
    setAnswering(false)
  }, [])

  const openState = useMemo(() => ({ open, setOpen, buttonRef }), [open])
  const chat = useMemo(
    () => ({ turns, answering, choice, setChoice, ask, stop, newChat }),
    [turns, answering, choice, setChoice, ask, stop, newChat],
  )
  return (
    <LaneOpenContext.Provider value={openState}>
      <LaneChatContext.Provider value={chat}>{children}</LaneChatContext.Provider>
    </LaneOpenContext.Provider>
  )
}
