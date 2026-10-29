import { useSyncExternalStore } from 'react'

export interface Toast {
  id: number
  tone: 'outbid' | 'win' | 'info'
  title: string
  body?: string
  link?: { to: string; label: string }
}

const AUTO_DISMISS_MS = 8_000
const MAX_VISIBLE = 3

let toasts: Toast[] = []
let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

export function showToast(toast: Omit<Toast, 'id'>): number {
  const id = nextId++
  const next = [...toasts, { ...toast, id }]
  next.slice(0, -MAX_VISIBLE).forEach((old) => stopTimer(old.id))
  toasts = next.slice(-MAX_VISIBLE)
  emit()
  resumeToast(id)
  return id
}

export function dismissToast(id: number): void {
  stopTimer(id)
  if (!toasts.some((toast) => toast.id === id)) return
  toasts = toasts.filter((toast) => toast.id !== id)
  emit()
}

function stopTimer(id: number) {
  clearTimeout(timers.get(id))
  timers.delete(id)
}

/** While hovered or focused a toast stays put, so "Bid again" can't vanish under the pointer. */
export const pauseToast = (id: number): void => stopTimer(id)

export function resumeToast(id: number): void {
  stopTimer(id)
  timers.set(
    id,
    setTimeout(() => dismissToast(id), AUTO_DISMISS_MS),
  )
}

/** Test hook. */
export function clearToasts(): void {
  timers.forEach((timer) => clearTimeout(timer))
  timers.clear()
  toasts = []
  emit()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useToasts = (): Toast[] => useSyncExternalStore(subscribe, () => toasts)
