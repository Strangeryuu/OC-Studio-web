'use client'

import { useCallback, useEffect, useRef, type TouchEvent as ReactTouchEvent } from 'react'

export interface TouchNodeMenuPoint { x: number; y: number }

/**
 * Mobile counterpart of the original node right-click menu.
 * Hold the node body for 550ms. Dragging a handle uses a different sibling
 * element, and moving a finger cancels the hold to preserve touch panning.
 */
export function useTouchNodeMenu(onMenu?: (at: TouchNodeMenuPoint) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startAt = useRef<TouchNodeMenuPoint | null>(null)
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    startAt.current = null
  }, [])

  useEffect(() => cancel, [cancel])

  const onTouchStart = useCallback((event: ReactTouchEvent) => {
    cancel()
    if (!onMenu || event.touches.length !== 1) return
    const point = { x: event.touches[0].clientX, y: event.touches[0].clientY }
    startAt.current = point
    timer.current = setTimeout(() => {
      timer.current = null
      if (startAt.current !== null) onMenu(point)
    }, 550)
  }, [cancel, onMenu])

  const onTouchMove = useCallback((event: ReactTouchEvent) => {
    const start = startAt.current
    if (!start || event.touches.length !== 1 ||
      Math.hypot(event.touches[0].clientX - start.x, event.touches[0].clientY - start.y) < 10) return
    cancel()
  }, [cancel])

  return { onTouchStart, onTouchMove, onTouchEnd: cancel, onTouchCancel: cancel }
}
