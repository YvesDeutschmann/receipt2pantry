import { createContext, useContext, useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { api } from '../services/apiClient'

const OnboardingContext = createContext(null)

const DEFAULT_HOUSEHOLD_NAME = 'My Household'

export function OnboardingProvider({ children }) {
  const { user } = useAuth()
  const [householdId, setHouseholdId] = useState(null)
  const [householdSize, setHouseholdSize] = useState(2)
  const [dietaryRestrictions, setDietaryRestrictions] = useState([])
  const [noRestrictions, setNoRestrictions] = useState(false)
  const [otherRestriction, setOtherRestriction] = useState('')
  const [householdReady, setHouseholdReady] = useState(false)
  const [householdLoading, setHouseholdLoading] = useState(true)
  const [householdError, setHouseholdError] = useState(null)

  useEffect(() => {
    if (!user?.id) {
      setHouseholdLoading(false)
      return
    }

    let cancelled = false

    async function ensureHousehold() {
      try {
        const { household } = await api.getHousehold(user.id)
        if (cancelled) return

        if (household) {
          setHouseholdId(household.id)
          setHouseholdSize(household.size ?? 2)
          setDietaryRestrictions(household.dietary_restrictions ?? [])
        } else {
          const { household: created } = await api.createHousehold(
            user.id,
            DEFAULT_HOUSEHOLD_NAME,
            2,
            []
          )
          if (cancelled) return
          setHouseholdId(created.id)
        }
        setHouseholdReady(true)
      } catch (err) {
        if (!cancelled) {
          setHouseholdError(err.message || 'Failed to set up household')
        }
      } finally {
        if (!cancelled) {
          setHouseholdLoading(false)
        }
      }
    }

    ensureHousehold()
    return () => { cancelled = true }
  }, [user?.id])

  const setSize = (n) => {
    setHouseholdSize(Math.max(1, Math.min(99, n)))
  }

  const toggleRestriction = (code) => {
    if (code === 'other') return
    setNoRestrictions(false)
    setDietaryRestrictions((prev) =>
      prev.includes(code) ? prev.filter((r) => r !== code) : [...prev, code]
    )
  }

  const setRestrictionsAffirmativeNone = () => {
    setDietaryRestrictions([])
    setOtherRestriction('')
    setNoRestrictions(true)
  }

  const addOtherRestriction = (text) => {
    setOtherRestriction(text)
    setNoRestrictions(false)
    if (text.trim()) {
      setDietaryRestrictions((prev) => {
        const withoutOther = prev.filter((r) => r !== 'other')
        return [...withoutOther, 'other']
      })
    } else {
      setDietaryRestrictions((prev) => prev.filter((r) => r !== 'other'))
    }
  }

  const getEffectiveRestrictions = () => {
    if (noRestrictions) return []
    const base = [...dietaryRestrictions]
    if (otherRestriction.trim()) {
      const hasOther = base.includes('other')
      if (!hasOther) base.push('other')
    }
    return base
  }

  const value = {
    householdId,
    householdSize,
    setHouseholdSize: setSize,
    dietaryRestrictions: getEffectiveRestrictions(),
    rawDietaryRestrictions: dietaryRestrictions,
    noRestrictions,
    toggleRestriction,
    setRestrictionsAffirmativeNone,
    otherRestriction,
    setOtherRestriction: addOtherRestriction,
    householdReady,
    householdLoading,
    householdError,
  }

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  )
}

export function useOnboarding() {
  const context = useContext(OnboardingContext)
  if (!context) {
    throw new Error('useOnboarding must be used within an OnboardingProvider')
  }
  return context
}
