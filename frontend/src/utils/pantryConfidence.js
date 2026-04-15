/**
 * Confidence-tier grouping and status labels for Phase 4 pantry UI.
 */

export function groupByConfidence(items) {
  const groups = {
    fresh: { label: 'FRESH', items: [] },
    low: { label: 'GETTING LOW', items: [] },
    uncertain: { label: 'UNCERTAIN', items: [] },
    gone: { label: 'LIKELY GONE', items: [] },
  }
  for (const item of items) {
    const c = item.confidence ?? 0
    if (c >= 0.75) groups.fresh.items.push(item)
    else if (c >= 0.5) groups.low.items.push(item)
    else if (c >= 0.2) groups.uncertain.items.push(item)
    else groups.gone.items.push(item)
  }
  return Object.values(groups).filter((g) => g.items.length > 0)
}

export function getStatusLabel(item) {
  const c = item.confidence ?? 0
  const cls = (item.depletion_class || '').toUpperCase()
  const isSoftRequired = item.is_soft_required || false

  if (isSoftRequired) return 'Check spice rack'
  if (item.use_soon) return 'Use soon'

  if (cls === 'PERISHABLE') {
    if (c >= 0.75) return 'Fresh'
    if (c >= 0.5) return 'Use soon'
    if (c >= 0.2) return 'Likely gone'
    return 'Likely gone'
  }

  // CONSUMABLE, STAPLE, UNIT_ITEM
  if (c >= 0.75) return 'In stock'
  if (c >= 0.5) return 'Getting low'
  if (c >= 0.2) return 'Probably still there'
  return 'Likely gone'
}

/** Tailwind classes for the status label (right side). */
export function getStatusLabelClassName(item) {
  const label = getStatusLabel(item)
  if (label === 'Fresh' || label === 'In stock') return 'text-green-400'
  if (label === 'Getting low' || label === 'Check spice rack') return 'text-orange-400'
  if (label === 'Probably still there') return 'text-amber-400'
  if (label === 'Likely gone') return 'text-sage-light opacity-50'
  return 'text-amber-400'
}
