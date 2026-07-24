import { useEffect, useState } from 'react'

export function useLocalStorage<T>(key: string, initialValue: T, isValid?: (value: T) => boolean) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key)
      if (stored === null) return initialValue
      const parsed = JSON.parse(stored) as T
      if (isValid && !isValid(parsed)) {
        window.localStorage.removeItem(key)
        return initialValue
      }
      return parsed
    } catch {
      try {
        window.localStorage.removeItem(key)
      } catch {
        // ignore
      }
      return initialValue
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // ignore write failures (e.g. private browsing quota)
    }
  }, [key, value])

  return [value, setValue] as const
}
