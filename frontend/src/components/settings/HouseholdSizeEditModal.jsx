import { useEffect, useState } from 'react'
import AdaptiveModal from '../AdaptiveModal'
import HouseholdSizePicker from '../onboarding/HouseholdSizePicker'
import { api } from '../../services/apiClient'

export default function HouseholdSizeEditModal({
  isOpen,
  onClose,
  userId,
  household,
  onSaved,
}) {
  const [size, setSize] = useState(household?.size ?? 2)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (isOpen && household) {
      setSize(household.size ?? 2)
      setError(null)
    }
  }, [isOpen, household])

  const handleSave = async () => {
    if (!userId || !household || saving) return
    setSaving(true)
    setError(null)
    try {
      const { household: updated } = await api.updateHouseholdProfile(userId, { size })
      onSaved?.(updated)
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not save household size.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdaptiveModal
      isOpen={isOpen}
      onClose={onClose}
      title="People"
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
      <div className="p-4 sm:p-6">
        <p className="text-sm text-sage-light mb-4 text-center">
          How many people are you feeding?
        </p>
        <HouseholdSizePicker size={size} onSizeChange={setSize} compact />
      </div>
    </AdaptiveModal>
  )
}
