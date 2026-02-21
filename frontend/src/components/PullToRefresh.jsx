import { useState, useRef, useCallback } from 'react'
import { hapticSelection } from '../utils/haptics'
import { isNative } from '../utils/platform'

const PULL_THRESHOLD = 80
const RESISTANCE = 0.5

function PullToRefresh({ onRefresh, children, disabled = false }) {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [thresholdReached, setThresholdReached] = useState(false)
  const startY = useRef(0)
  const currentY = useRef(0)

  const handleTouchStart = useCallback(
    (e) => {
      if (disabled || isRefreshing) return
      startY.current = e.touches[0].clientY
      currentY.current = e.touches[0].clientY
      setThresholdReached(false)
    },
    [disabled, isRefreshing]
  )

  const handleTouchMove = useCallback(
    (e) => {
      if (disabled || isRefreshing) return
      currentY.current = e.touches[0].clientY
      const scrollTop = document.documentElement.scrollTop || document.body.scrollTop
      // Only respond to pull when scrolled to top
      if (scrollTop > 5) return

      const delta = currentY.current - startY.current
      if (delta > 0) {
        e.preventDefault()
        const distance = Math.min(delta * RESISTANCE, 120)
        setPullDistance(distance)
        if (distance >= PULL_THRESHOLD && !thresholdReached) {
          setThresholdReached(true)
          if (isNative()) hapticSelection()
        } else if (distance < PULL_THRESHOLD) {
          setThresholdReached(false)
        }
      }
    },
    [disabled, isRefreshing, thresholdReached]
  )

  const handleTouchEnd = useCallback(async () => {
    if (disabled || isRefreshing) return
    if (pullDistance >= PULL_THRESHOLD && onRefresh) {
      setIsRefreshing(true)
      setPullDistance(0)
      setThresholdReached(false)
      try {
        await onRefresh()
      } finally {
        setIsRefreshing(false)
      }
    } else {
      setPullDistance(0)
      setThresholdReached(false)
    }
  }, [disabled, isRefreshing, pullDistance, onRefresh])

  const showIndicator = pullDistance > 0 || isRefreshing
  const progress = Math.min(pullDistance / PULL_THRESHOLD, 1)

  return (
    <div
      className="relative"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* Pull indicator */}
      {showIndicator && (
        <div
          className="flex justify-center items-center pt-2 pb-1 transition-opacity"
          style={{
            height: `${Math.max(pullDistance, isRefreshing ? 48 : 0)}px`,
            opacity: showIndicator ? 1 : 0,
          }}
        >
          {isRefreshing ? (
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary-600 border-t-transparent" />
          ) : (
            <div
              className="rounded-full h-6 w-6 border-2 border-primary-600 border-t-transparent"
              style={{
                transform: `rotate(${progress * 360}deg)`,
              }}
            />
          )}
        </div>
      )}
      {children}
    </div>
  )
}

export default PullToRefresh
