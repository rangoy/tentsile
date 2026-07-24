import { useCallback, useEffect, useState } from 'react'

type Permission = 'idle' | 'granted' | 'denied'

interface DeviceOrientationEventStatic {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

/**
 * Live device tilt via the DeviceOrientationEvent API, gated behind the
 * iOS 13+ permission prompt (which must be triggered by a user gesture, so
 * `enable` is meant to be called directly from a click handler). Android/
 * desktop browsers generally expose orientation without a prompt at all.
 */
export function useDeviceTilt() {
  const [supported] = useState(() => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window)
  const [permission, setPermission] = useState<Permission>('idle')
  const [beta, setBeta] = useState<number | null>(null)

  useEffect(() => {
    if (permission !== 'granted') return
    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta !== null) setBeta(e.beta)
    }
    window.addEventListener('deviceorientation', handleOrientation)
    return () => window.removeEventListener('deviceorientation', handleOrientation)
  }, [permission])

  const enable = useCallback(async () => {
    const ctor = window.DeviceOrientationEvent as unknown as DeviceOrientationEventStatic
    if (typeof ctor?.requestPermission === 'function') {
      try {
        setPermission((await ctor.requestPermission()) === 'granted' ? 'granted' : 'denied')
      } catch {
        setPermission('denied')
      }
      return
    }
    setPermission('granted')
  }, [])

  return { supported, permission, beta, enable }
}
