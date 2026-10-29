import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearToasts, pauseToast, resumeToast, showToast, useToasts } from './toastStore'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  act(() => clearToasts())
  vi.useRealTimers()
})

describe('toasts', () => {
  it('dismiss themselves, but not while hovered or focused', () => {
    const { result } = renderHook(() => useToasts())
    let id = 0
    act(() => {
      id = showToast({ tone: 'outbid', title: 'Outbid' })
    })
    pauseToast(id)
    act(() => vi.advanceTimersByTime(20_000))
    expect(result.current).toHaveLength(1)

    resumeToast(id)
    act(() => vi.advanceTimersByTime(8_000))
    expect(result.current).toHaveLength(0)
  })

  it('keeps at most three', () => {
    const { result } = renderHook(() => useToasts())
    act(() => {
      for (let n = 0; n < 5; n++) showToast({ tone: 'info', title: `T${n}` })
    })
    expect(result.current.map((toast) => toast.title)).toEqual(['T2', 'T3', 'T4'])
  })
})
