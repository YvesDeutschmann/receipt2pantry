import { Clock } from 'lucide-react'

const sizeClasses = {
  sm: 'text-xs gap-1',
  md: 'text-sm gap-1.5',
}

const symbolSize = {
  sm: 'text-sm',
  md: 'text-base',
}

/**
 * Priority: isSoftRequired > isUseSoon > confidence bands.
 * confidence < 0.20: render nothing.
 */
function ConfidenceIndicator({
  confidence,
  isSoftRequired,
  isUseSoon,
  size = 'md',
}) {
  if (!isSoftRequired && !isUseSoon && (confidence == null || confidence < 0.2)) {
    return null
  }

  if (isSoftRequired) {
    return (
      <span
        className={`inline-flex items-center ${sizeClasses[size]} text-sage-light`}
        title="check spice rack"
      >
        <span className={`font-semibold ${symbolSize[size]}`}>~</span>
        <span>check spice rack</span>
      </span>
    )
  }

  if (isUseSoon) {
    return (
      <span
        className={`inline-flex items-center ${sizeClasses[size]} text-amber-500`}
        title="check freshness"
      >
        <Clock className={`shrink-0 ${size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} aria-hidden />
        <span>check freshness</span>
      </span>
    )
  }

  const c = Number(confidence) || 0
  if (c >= 0.75) {
    return (
      <span className={`inline-flex items-center ${sizeClasses[size]} text-emerald-500`} title="confirmed">
        <span className={symbolSize[size]}>●</span>
        <span>confirmed</span>
      </span>
    )
  }
  if (c >= 0.5) {
    return (
      <span className={`inline-flex items-center ${sizeClasses[size]} text-amber-400`} title="probably have">
        <span className={symbolSize[size]}>◐</span>
        <span>probably have — check freshness</span>
      </span>
    )
  }
  if (c >= 0.2) {
    return (
      <span className={`inline-flex items-center ${sizeClasses[size]} text-orange-500`} title="check your pantry">
        <span className={symbolSize[size]}>○</span>
        <span>check your pantry</span>
      </span>
    )
  }

  return null
}

export default ConfidenceIndicator
