import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import HouseholdModal from '../components/HouseholdModal'
import AdaptiveModal from '../components/AdaptiveModal'
import PageHeader from '../components/PageHeader'
import ReceiptSummarySection from '../components/ReceiptSummarySection'
import SettingsGroup from '../components/settings/SettingsGroup'
import SettingsRow from '../components/settings/SettingsRow'
import SettingsDevTools from '../components/settings/SettingsDevTools'
import HouseholdSizeEditModal from '../components/settings/HouseholdSizeEditModal'
import HouseholdDietEditModal from '../components/settings/HouseholdDietEditModal'
import { getSizeLabel } from '../components/onboarding/HouseholdSizePicker'
import { formatDietarySummary } from '../components/onboarding/DietaryRestrictionChips'
import {
  clearCostcoInAppBrowserSession,
  clearStoredTokens as clearCostcoStoredTokens,
} from '../services/costcoWebViewBridge'
import { clearStoredTokens as clearSafewayStoredTokens } from '../services/safewayWebViewBridge'
import { PRIVACY_URL, TERMS_URL } from '../config/legal'
import { openLegalPage } from '../utils/openLegalPage'

function Settings() {
  const [household, setHousehold] = useState(null)
  const [loading, setLoading] = useState(true)
  const [householdModalOpen, setHouseholdModalOpen] = useState(false)
  const [sizeModalOpen, setSizeModalOpen] = useState(false)
  const [dietModalOpen, setDietModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const showDevTools =
    import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_SETTINGS === '1'

  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const userId = user?.id

  useEffect(() => {
    fetchHousehold()
  }, [userId])

  const fetchHousehold = async () => {
    try {
      const response = await api.getHousehold(userId)
      setHousehold(response.household)
    } catch (err) {
      console.error('Failed to fetch household:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleHouseholdChange = (newHousehold) => {
    setHousehold(newHousehold)
    if (!newHousehold) {
      setSizeModalOpen(false)
      setDietModalOpen(false)
    }
  }

  const handleDeleteAccount = async () => {
    setDeleteLoading(true)
    setDeleteError(null)
    try {
      await api.deleteAccount()
      try {
        await clearCostcoStoredTokens()
        await clearSafewayStoredTokens()
        await clearCostcoInAppBrowserSession()
      } catch (localErr) {
        console.warn('Local credential cleanup after account delete:', localErr)
      }
      await signOut({ scope: 'local' })
      navigate('/auth', { replace: true })
    } catch (err) {
      console.error('Delete account failed:', err)
      setDeleteError(
        err.response?.data?.error || 'Could not delete your account. Please try again.'
      )
    } finally {
      setDeleteLoading(false)
    }
  }

  const peopleValue = household?.size
    ? getSizeLabel(household.size).replace(/^Cooking for /, '')
    : undefined

  const dietValue = household
    ? formatDietarySummary(household.dietary_restrictions)
    : undefined

  return (
    <div>
      <PageHeader title="Settings" />

      <ReceiptSummarySection userId={userId} />

      <SettingsGroup title="Stores">
        <SettingsRow
          title="Connected stores"
          value="Safeway, Costco"
          to="/providers"
        />
      </SettingsGroup>

      <SettingsGroup title="Household">
        {loading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-terra" />
          </div>
        ) : household ? (
          <>
            <SettingsRow
              title="Manage household"
              value={household.name}
              onClick={() => setHouseholdModalOpen(true)}
            />
            <SettingsRow
              title="People"
              value={peopleValue}
              onClick={() => setSizeModalOpen(true)}
            />
            <SettingsRow
              title="Diet & allergies"
              value={dietValue}
              onClick={() => setDietModalOpen(true)}
            />
          </>
        ) : (
          <SettingsRow
            title="Set up household"
            subtitle="Share pantry and receipts with family"
            onClick={() => setHouseholdModalOpen(true)}
          />
        )}
      </SettingsGroup>

      <SettingsGroup title="Account">
        <SettingsRow
          title="Email"
          value={user?.email || '—'}
          showChevron={false}
        />
        <SettingsRow title="Sign out" onClick={() => void signOut()} />
        <SettingsRow
          title="Privacy Policy"
          onClick={() => void openLegalPage(PRIVACY_URL)}
        />
        <SettingsRow
          title="Terms of Service"
          onClick={() => void openLegalPage(TERMS_URL)}
        />
        <SettingsRow
          title="Delete account"
          subtitle="Permanently remove your account and data"
          destructive
          disabled={deleteLoading || !userId}
          onClick={() => {
            setDeleteError(null)
            setDeleteModalOpen(true)
          }}
        />
      </SettingsGroup>

      {showDevTools ? (
        <SettingsDevTools userId={userId} householdId={household?.id} />
      ) : null}

      <HouseholdModal
        isOpen={householdModalOpen}
        onClose={() => setHouseholdModalOpen(false)}
        userId={userId}
        onHouseholdChange={handleHouseholdChange}
      />

      <HouseholdSizeEditModal
        isOpen={sizeModalOpen}
        onClose={() => setSizeModalOpen(false)}
        userId={userId}
        household={household}
        onSaved={setHousehold}
      />

      <HouseholdDietEditModal
        isOpen={dietModalOpen}
        onClose={() => setDietModalOpen(false)}
        userId={userId}
        household={household}
        onSaved={setHousehold}
      />

      <AdaptiveModal
        isOpen={deleteModalOpen}
        onClose={() => {
          if (!deleteLoading) setDeleteModalOpen(false)
        }}
        title="Delete account permanently?"
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 p-4 sm:p-6 border-t border-forest-light">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={deleteLoading}
              onClick={() => setDeleteModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn bg-[var(--color-error)] text-cream hover:opacity-90 disabled:opacity-50"
              disabled={deleteLoading}
              onClick={() => void handleDeleteAccount()}
            >
              {deleteLoading ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        }
      >
        <div className="p-4 sm:p-6 space-y-3">
          <p className="text-sm text-sage-light">
            This removes your Meald account, grocery login secrets, pantry, and receipts.
            This cannot be undone.
          </p>
          <p className="text-sm text-sage-light">
            If you share a household, other members keep the household and shared data.
          </p>
          {deleteError ? (
            <p className="text-sm text-[var(--color-error)]" role="alert">
              {deleteError}
            </p>
          ) : null}
        </div>
      </AdaptiveModal>
    </div>
  )
}

export default Settings
