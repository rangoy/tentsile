import { useEffect, useRef } from 'react'

/**
 * Delays calling `run` until `delay` ms pass without a new call — each call
 * replaces whatever was pending, so a burst of calls (e.g. keystrokes) ends
 * up committing once. `flush()` runs (and cancels) a pending call
 * immediately — wire it to blur so an edit commits as soon as the field is
 * left, instead of waiting out the debounce. Unmounting also flushes, so
 * removing a row or navigating away mid-pause doesn't silently drop the
 * latest edit.
 */
export function useDebounce(delay: number) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<(() => void) | null>(null)

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
        pendingRef.current?.()
      }
    },
    [],
  )

  const schedule = (run: () => void) => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    pendingRef.current = run
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null
      pendingRef.current = null
      run()
    }, delay)
  }

  const flush = () => {
    if (timeoutRef.current === null) return
    clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    const run = pendingRef.current
    pendingRef.current = null
    run?.()
  }

  return { schedule, flush }
}
