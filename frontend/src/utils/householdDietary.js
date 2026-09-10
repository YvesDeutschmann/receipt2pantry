/** Build stored dietary code list from chip picker state (matches onboarding). */
export function buildEffectiveDietaryCodes(selectedCodes, otherRestriction, noRestrictions) {
  if (noRestrictions) return []
  const base = [...selectedCodes]
  if (otherRestriction.trim()) {
    if (!base.includes('other')) base.push('other')
  } else {
    return base.filter((c) => c !== 'other')
  }
  return base
}

/** Codes newly added vs the household list when the modal opened. */
export function dietaryAdditionsOnly(initialCodes, nextCodes) {
  const initial = new Set(initialCodes || [])
  return (nextCodes || []).filter((code) => !initial.has(code))
}

/** True if next removes any code that was on the household at open. */
export function dietaryHasShrink(initialCodes, nextCodes) {
  const next = new Set(nextCodes || [])
  return (initialCodes || []).some((code) => !next.has(code))
}

/** Initialize chip state from stored household codes. */
export function dietaryStateFromHousehold(codes) {
  const list = Array.isArray(codes) ? codes : []
  return {
    selectedCodes: list.filter((c) => c !== 'other'),
    otherRestriction: '',
    noRestrictions: list.length === 0,
    showOtherInput: list.includes('other'),
  }
}
