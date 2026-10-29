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
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

export function showToast(toast: Omit<Toast, 'id'>): number {
  const id = nextId++
  toasts = [...toasts, { ...toast, id }].slice(-MAX_VISIBLE)
  emit()
  setTimeout(() => dismissToast(id), AUTO_DISMISS_MS)
  return id
}

export function dismissToast(id: number): void {
  if (!toasts.some((toast) => toast.id === id)) return
  toasts = toasts.filter((toast) => toast.id !== id)
  emit()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useToasts = (): Toast[] => useSyncExternalStore(subscribe, () => toasts)

/** Test hook. */
export function clearToasts(): void {
  toasts = []
  emit()
}
