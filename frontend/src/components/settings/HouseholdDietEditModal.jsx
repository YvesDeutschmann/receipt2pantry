import { useEffect, useMemo, useState } from 'react'
import AdaptiveModal from '../AdaptiveModal'
import DietaryRestrictionChips from '../onboarding/DietaryRestrictionChips'
import { api } from '../../services/apiClient'
import {
  buildEffectiveDietaryCodes,
  dietaryAdditionsOnly,
  dietaryHasShrink,
  dietaryStateFromHousehold,
} from '../../utils/householdDietary'

export default function HouseholdDietEditModal({
  isOpen,
  onClose,
  userId,
  household,
  onSaved,
}) {
  const isOwner = household?.role === 'owner'
  const initialCodes = useMemo(
    () => household?.dietary_restrictions ?? [],
    [household?.dietary_restrictions]
  )
  const lockedCodes = isOwner ? [] : initialCodes

  const [selectedCodes, setSelectedCodes] = useState([])
  const [otherRestriction, setOtherRestriction] = useState('')
  const [noRestrictions, setNoRestrictions] = useState(false)
  const [showOtherInput, setShowOtherInput] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isOpen || !household) return
    const state = dietaryStateFromHousehold(household.dietary_restrictions)
    setSelectedCodes(state.selectedCodes)
    setOtherRestriction(state.otherRestriction)
    setNoRestrictions(state.noRestrictions)
    setShowOtherInput(state.showOtherInput)
    setError(null)
  }, [isOpen, household])

  const handleChipClick = (code) => {
    if (code === 'other') {
      setShowOtherInput((prev) => !prev)
      setNoRestrictions(false)
      return
    }
    if (!isOwner && lockedCodes.includes(code)) return
    setNoRestrictions(false)
    setSelectedCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    )
  }

  const handleNoRestrictionsClick = () => {
    if (!isOwner) return
    setSelectedCodes([])
    setOtherRestriction('')
    setNoRestrictions(true)
    setShowOtherInput(false)
  }

  const handleSave = async () => {
    if (!userId || !household || saving) return

    const effective = buildEffectiveDietaryCodes(
      selectedCodes,
      otherRestriction,
      noRestrictions
    )

    if (isOwner) {
      if (dietaryHasShrink(initialCodes, effective)) {
        const ok = window.confirm(
          'This removes allergy filters for your whole household. Continue?'
        )
        if (!ok) return
      }
    }

    setSaving(true)
    setError(null)
    try {
      if (isOwner) {
        const { household: updated } = await api.updateHouseholdProfile(userId, {
          dietaryRestrictions: effective,
        })
        onSaved?.(updated)
      } else {
        const additions = dietaryAdditionsOnly(initialCodes, effective)
        if (additions.length === 0) {
          onClose()
          return
        }
        const { household: updated } = await api.mergeDietaryRestrictions(userId, additions)
        onSaved?.(updated)
      }
      onClose()
    } catch (err) {
      setError(
        err.response?.data?.error || err.message || 'Could not save dietary restrictions.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdaptiveModal
      isOpen={isOpen}
      onClose={onClose}
      title="Diet & allergies"
      footer={
        <div className="p-4 border-t border-forest-light flex flex-col gap-2">
          {error ? (
            <p className="text-sm text-[var(--color-error)]" role="alert">{error}</p>
          ) : null}
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={saving || !household}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      <div className="p-4 sm:p-6 max-h-[60vh] overflow-y-auto">
        <p className="text-sm text-sage-light mb-4">
          {isOwner
            ? 'This covers your whole household.'
            : 'You can add restrictions for yourself. Existing household allergies cannot be removed here.'}
        </p>
        <DietaryRestrictionChips
          selectedCodes={selectedCodes}
          otherRestriction={otherRestriction}
          noRestrictions={noRestrictions}
          lockedCodes={lockedCodes}
          showNoRestrictionsButton={isOwner && lockedCodes.length === 0}
          showOtherInput={showOtherInput}
          onChipClick={handleChipClick}
          onNoRestrictionsClick={handleNoRestrictionsClick}
          onOtherTextChange={(text) => {
            setOtherRestriction(text)
            setNoRestrictions(false)
          }}
        />
      </div>
    </AdaptiveModal>
  )
}
