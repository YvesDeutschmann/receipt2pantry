import { useState, useEffect } from 'react'
import { api } from '../services/apiClient'
import { useAuth } from '../contexts/AuthContext'
import HouseholdModal from '../components/HouseholdModal'
import PageHeader from '../components/PageHeader'
import ReceiptSummarySection from '../components/ReceiptSummarySection'
import SettingsGroup from '../components/settings/SettingsGroup'
import SettingsRow from '../components/settings/SettingsRow'
import SettingsDevTools from '../components/settings/SettingsDevTools'
import HouseholdSizeEditModal from '../components/settings/HouseholdSizeEditModal'
import HouseholdDietEditModal from '../components/settings/HouseholdDietEditModal'
import { getSizeLabel } from '../components/onboarding/HouseholdSizePicker'
import { formatDietarySummary } from '../components/onboarding/DietaryRestrictionChips'

function Settings() {
  const [household, setHousehold] = useState(null)
  const [loading, setLoading] = useState(true)
  const [householdModalOpen, setHouseholdModalOpen] = useState(false)
  const [sizeModalOpen, setSizeModalOpen] = useState(false)
  const [dietModalOpen, setDietModalOpen] = useState(false)

  const showDevTools =
    import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_SETTINGS === '1'

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
          title="Delete account"
          subtitle="Not available yet"
          destructive
          disabled
          showChevron={false}
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
    </div>
  )
}

export default Settings
