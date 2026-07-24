import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export interface CameraState {
  x: number
  y: number
  scale: number
}

const DEFAULT_CAMERA: CameraState = { x: 0, y: 0, scale: 1 }
const MIN_SCALE = 0.4
const MAX_SCALE = 10
const WHEEL_ZOOM_FACTOR = 1.15

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/**
 * Wheel-to-zoom, drag-to-pan, and pinch-to-zoom for an SVG whose zoomable
 * content sits inside a single <g transform={transform}>. Built on the
 * Pointer Events API so mouse and touch share one code path; multi-touch
 * (pinch) is handled by tracking up to two simultaneous pointers.
 *
 * `resetKey` is watched to snap the camera back to default whenever it
 * changes (e.g. the user switches which combination they're viewing) —
 * but NOT on every minor data edit within the same combination, so a
 * zoomed-in view survives while tweaking inputs.
 */
export function useZoomPan(svgRef: RefObject<SVGSVGElement | null>, resetKey: string) {
  const [camera, setCamera] = useState<CameraState>(DEFAULT_CAMERA)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const panStart = useRef<{ svg: { x: number; y: number }; camera: CameraState } | null>(null)
  const pinchStart = useRef<{ dist: number; mid: { x: number; y: number }; camera: CameraState } | null>(null)

  useEffect(() => {
    setCamera(DEFAULT_CAMERA)
  }, [resetKey])

  const toSvgPoint = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      const ctm = svg?.getScreenCTM()
      if (!svg || !ctm) return { x: 0, y: 0 }
      const point = svg.createSVGPoint()
      point.x = clientX
      point.y = clientY
      const transformed = point.matrixTransform(ctm.inverse())
      return { x: transformed.x, y: transformed.y }
    },
    [svgRef],
  )

  const zoomBy = useCallback((factor: number, anchor: { x: number; y: number }) => {
    setCamera((prev) => {
      const scale = clampScale(prev.scale * factor)
      const ratio = scale / prev.scale
      return { scale, x: anchor.x - ratio * (anchor.x - prev.x), y: anchor.y - ratio * (anchor.y - prev.y) }
    })
  }, [])

  // React's synthetic onWheel can end up bound as a passive listener (browser-
  // dependent), which silently ignores preventDefault and lets the page itself
  // scroll/zoom underneath. A native listener with { passive: false } is the
  // only way to reliably claim the wheel gesture for our own zoom.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      zoomBy(e.deltaY > 0 ? 1 / WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR, toSvgPoint(e.clientX, e.clientY))
    }
    svg.addEventListener('wheel', handler, { passive: false })
    return () => svg.removeEventListener('wheel', handler)
  }, [svgRef, toSvgPoint, zoomBy])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // Ignore: happens for synthetic/untrusted pointers or an already-released
        // capture — the pointer tracking below still works without it.
      }
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (pointers.current.size === 1) {
        panStart.current = { svg: toSvgPoint(e.clientX, e.clientY), camera }
        pinchStart.current = null
      } else if (pointers.current.size === 2) {
        panStart.current = null
        const pts = Array.from(pointers.current.values())
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
        pinchStart.current = {
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          mid: toSvgPoint(mid.x, mid.y),
          camera,
        }
      }
    },
    [camera, toSvgPoint],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!pointers.current.has(e.pointerId)) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (pointers.current.size === 1 && panStart.current) {
        const p = toSvgPoint(e.clientX, e.clientY)
        const start = panStart.current
        setCamera({ scale: start.camera.scale, x: start.camera.x + (p.x - start.svg.x), y: start.camera.y + (p.y - start.svg.y) })
      } else if (pointers.current.size === 2 && pinchStart.current) {
        const pts = Array.from(pointers.current.values())
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
        const midSvgNow = toSvgPoint(mid.x, mid.y)
        const start = pinchStart.current
        const scale = clampScale(start.camera.scale * (dist / start.dist))
        const ratio = scale / start.camera.scale
        setCamera({
          scale,
          x: midSvgNow.x - ratio * (start.mid.x - start.camera.x),
          y: midSvgNow.y - ratio * (start.mid.y - start.camera.y),
        })
      }
    },
    [toSvgPoint],
  )

  const endPointer = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      pointers.current.delete(e.pointerId)
      panStart.current = null
      pinchStart.current = null
      if (pointers.current.size === 1) {
        const [[, p]] = Array.from(pointers.current.entries())
        panStart.current = { svg: toSvgPoint(p.x, p.y), camera }
      }
    },
    [camera, toSvgPoint],
  )

  const zoomIn = useCallback(() => zoomBy(WHEEL_ZOOM_FACTOR, { x: 320, y: 240 }), [zoomBy])
  const zoomOut = useCallback(() => zoomBy(1 / WHEEL_ZOOM_FACTOR, { x: 320, y: 240 }), [zoomBy])
  const reset = useCallback(() => setCamera(DEFAULT_CAMERA), [])
  const isDefault = camera.x === 0 && camera.y === 0 && camera.scale === 1

  return {
    scale: camera.scale,
    transform: `translate(${camera.x} ${camera.y}) scale(${camera.scale})`,
    handlers: { onPointerDown, onPointerMove, onPointerUp: endPointer, onPointerCancel: endPointer },
    zoomIn,
    zoomOut,
    reset,
    isDefault,
  }
}
