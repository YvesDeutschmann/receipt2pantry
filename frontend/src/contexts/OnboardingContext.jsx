import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAuth } from './AuthContext'
import { api } from '../services/apiClient'
import { supabase } from '../services/supabaseClient'

const OnboardingContext = createContext(null)

const DEFAULT_HOUSEHOLD_NAME = 'My Household'

const ALREADY_MEMBER_ERROR =
  'You are already a member of a household. Please leave your current household first.'

/** Ordered onboarding sub-flow steps (cold-start arc). */
export const ONBOARDING_STEP_NAMES = [
  'household_size',
  'dietary_restrictions',
  'bridge',
  'staples',
]

function hydrateFromHousehold(household, setters) {
  setters.setHouseholdId(household.id)
  setters.setHouseholdSize(household.size ?? 2)
  setters.setDietaryRestrictions(household.dietary_restrictions ?? [])
  setters.setHouseholdRole(household.role ?? null)
  setters.setInitialDietaryRestrictions(household.dietary_restrictions ?? [])
}

/**
 * @param {object} props
 * @param {import('react').ReactNode} props.children
 * @param {{ current: (() => void) | null } | undefined} props.renderProbeRef — optional; assigns a no-arg fn that triggers an internal re-render (tests only).
 */
export function OnboardingProvider({ children, renderProbeRef }) {
  const { user, session, loading: authLoading } = useAuth()

  const getSignupMethod = useCallback(() => {
    const provider =
      session?.provider ??
      user?.app_metadata?.provider ??
      user?.identities?.[0]?.provider
    if (provider === 'apple') return 'apple'
    if (provider === 'google') return 'google'
    return 'email'
  }, [user, session])

  const [householdId, setHouseholdId] = useState(null)
  const [householdRole, setHouseholdRole] = useState(null)
  const [householdSize, setHouseholdSize] = useState(2)
  const [dietaryRestrictions, setDietaryRestrictions] = useState([])
  const [initialDietaryRestrictions, setInitialDietaryRestrictions] = useState([])
  const [noRestrictions, setNoRestrictions] = useState(false)
  const [otherRestriction, setOtherRestriction] = useState('')
  const [householdResolved, setHouseholdResolved] = useState(false)
  const [householdLoading, setHouseholdLoading] = useState(true)
  const [householdError, setHouseholdError] = useState(null)

  const [completedUpTo, setCompletedUpTo] = useState(-1)
  const completionSentRef = useRef(false)
  const [, setRenderProbe] = useState(0)

  const isJoiner = householdRole === 'member'

  useEffect(() => {
    if (renderProbeRef && typeof renderProbeRef === 'object') {
      renderProbeRef.current = () => setRenderProbe((n) => n + 1)
    }
    return () => {
      if (renderProbeRef && typeof renderProbeRef === 'object') {
        renderProbeRef.current = null
      }
    }
  }, [renderProbeRef])

  const applyHousehold = useCallback((household) => {
    if (household) {
      hydrateFromHousehold(household, {
        setHouseholdId,
        setHouseholdSize,
        setDietaryRestrictions,
        setHouseholdRole,
        setInitialDietaryRestrictions,
      })
    } else {
      setHouseholdId(null)
      setHouseholdRole(null)
      setInitialDietaryRestrictions([])
    }
  }, [])

  const refreshHousehold = useCallback(async () => {
    if (!user?.id) return null
    const { household } = await api.getHousehold(user.id)
    applyHousehold(household)
    return household
  }, [user?.id, applyHousehold])

  useEffect(() => {
    if (!user?.id) {
      setHouseholdLoading(false)
      setHouseholdResolved(false)
      return
    }

    let cancelled = false

    async function loadHousehold() {
      setHouseholdLoading(true)
      setHouseholdError(null)
      try {
        const { household } = await api.getHousehold(user.id)
        if (cancelled) return
        applyHousehold(household)
        setHouseholdResolved(true)
      } catch (err) {
        if (!cancelled) {
          setHouseholdError(err.message || 'Failed to load household')
        }
      } finally {
        if (!cancelled) {
          setHouseholdLoading(false)
        }
      }
    }

    loadHousehold()
    return () => {
      cancelled = true
    }
  }, [user?.id, applyHousehold])

  const createHouseholdExplicit = useCallback(
    async (name = DEFAULT_HOUSEHOLD_NAME) => {
      if (!user?.id) throw new Error('Not signed in')
      try {
        const { household } = await api.createHousehold(user.id, name, 2, [])
        applyHousehold(household)
        setHouseholdResolved(true)
        return household
      } catch (err) {
        const msg = err.response?.data?.error || err.message || ''
        if (msg.includes('already a member')) {
          const existing = await refreshHousehold()
          if (existing) return existing
        }
        throw err
      }
    },
    [user?.id, applyHousehold, refreshHousehold]
  )

  const joinHouseholdByCode = useCallback(
    async (joinCode) => {
      if (!user?.id) throw new Error('Not signed in')
      try {
        const { household } = await api.joinHousehold(user.id, joinCode)
        applyHousehold(household)
        setHouseholdResolved(true)
        return household
      } catch (err) {
        const msg = err.response?.data?.error || err.message || ''
        if (msg.includes('already a member')) {
          const existing = await refreshHousehold()
          if (existing) return existing
        }
        throw err
      }
    },
    [user?.id, applyHousehold, refreshHousehold]
  )

  const setSize = useCallback(
    (n) => {
      if (authLoading) return
      setHouseholdSize(Math.max(1, Math.min(99, n)))
    },
    [authLoading]
  )

  const toggleRestriction = useCallback(
    (code) => {
      if (authLoading) return
      if (code === 'other') return
      setNoRestrictions(false)
      setDietaryRestrictions((prev) =>
        prev.includes(code) ? prev.filter((r) => r !== code) : [...prev, code]
      )
    },
    [authLoading]
  )

  const setRestrictionsAffirmativeNone = useCallback(() => {
    if (authLoading) return
    setDietaryRestrictions([])
    setOtherRestriction('')
    setNoRestrictions(true)
  }, [authLoading])

  const addOtherRestriction = useCallback(
    (text) => {
      if (authLoading) return
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
    },
    [authLoading]
  )

  const dietaryRestrictionsEffective = useMemo(() => {
    if (noRestrictions) return []
    const base = [...dietaryRestrictions]
    if (otherRestriction.trim()) {
      const hasOther = base.includes('other')
      if (!hasOther) base.push('other')
    }
    return base
  }, [noRestrictions, dietaryRestrictions, otherRestriction])

  const joinerDietaryAdditions = useMemo(() => {
    const initial = new Set(initialDietaryRestrictions)
    return dietaryRestrictionsEffective.filter((code) => !initial.has(code))
  }, [initialDietaryRestrictions, dietaryRestrictionsEffective])

  const stepsComplete = useMemo(
    () =>
      Object.fromEntries(
        ONBOARDING_STEP_NAMES.map((name, i) => [name, i <= completedUpTo])
      ),
    [completedUpTo]
  )

  const advanceStep = useCallback(() => {
    if (authLoading) return
    setCompletedUpTo((u) =>
      Math.min(u + 1, ONBOARDING_STEP_NAMES.length - 1)
    )
  }, [authLoading])

  const completeStep = useCallback(
    (stepName) => {
      if (authLoading) return false
      const idx = ONBOARDING_STEP_NAMES.indexOf(stepName)
      if (idx === -1) return false
      if (idx !== completedUpTo + 1) return false
      setCompletedUpTo(idx)
      return true
    },
    [authLoading, completedUpTo]
  )

  const resetOnboarding = useCallback(() => {
    if (authLoading) return
    setCompletedUpTo(-1)
  }, [authLoading])

  const complete = useCallback(
    async (extra = {}) => {
      if (authLoading) return
      if (completionSentRef.current) return
      completionSentRef.current = true
      const now = new Date().toISOString()
      await supabase.auth.updateUser({
        data: {
          onboarding_completed_at: now,
          cold_start_pantry_template_completed_at: now,
          cold_start_step: 2,
          signup_method: getSignupMethod(),
          whats_for_dinner_unlocked: true,
          ...extra,
        },
      })
    },
    [authLoading, getSignupMethod]
  )

  const completeJoin = useCallback(
    async (extra = {}) => {
      if (authLoading) return
      if (completionSentRef.current) return
      completionSentRef.current = true
      const now = new Date().toISOString()
      await supabase.auth.updateUser({
        data: {
          onboarding_completed_at: now,
          cold_start_step: 2,
          signup_method: getSignupMethod(),
          whats_for_dinner_unlocked: true,
          ...extra,
        },
      })
    },
    [authLoading, getSignupMethod]
  )

  const completeBridge = useCallback(
    async (extra = {}) => {
      if (authLoading) return false
      if (!user?.id) {
        throw new Error('Not signed in')
      }
      await api.updateHouseholdProfile(user.id, {
        size: householdSize,
        dietaryRestrictions: dietaryRestrictionsEffective,
      })
      await supabase.auth.updateUser({
        data: {
          cold_start_step: 1,
          signup_method: getSignupMethod(),
          ...extra,
        },
      })
      return true
    },
    [
      authLoading,
      user?.id,
      householdSize,
      dietaryRestrictionsEffective,
      getSignupMethod,
    ]
  )

  const completeJoinDietary = useCallback(async () => {
    if (!user?.id) throw new Error('Not signed in')
    if (joinerDietaryAdditions.length > 0) {
      await api.mergeDietaryRestrictions(user.id, joinerDietaryAdditions)
    }
    await completeJoin()
  }, [user?.id, joinerDietaryAdditions, completeJoin])

  const value = useMemo(
    () => ({
      householdId,
      householdRole,
      isJoiner,
      householdSize,
      setHouseholdSize: setSize,
      dietaryRestrictions: dietaryRestrictionsEffective,
      rawDietaryRestrictions: dietaryRestrictions,
      initialDietaryRestrictions,
      joinerDietaryAdditions,
      noRestrictions,
      toggleRestriction,
      setRestrictionsAffirmativeNone,
      otherRestriction,
      setOtherRestriction: addOtherRestriction,
      householdResolved,
      /** @deprecated use householdResolved */
      householdReady: householdResolved,
      householdLoading,
      householdError,
      stepsComplete,
      advanceStep,
      completeStep,
      resetOnboarding,
      complete,
      completeJoin,
      completeJoinDietary,
      completeBridge,
      createHouseholdExplicit,
      joinHouseholdByCode,
      refreshHousehold,
      ALREADY_MEMBER_ERROR,
    }),
    [
      householdId,
      householdRole,
      isJoiner,
      householdSize,
      setSize,
      dietaryRestrictionsEffective,
      dietaryRestrictions,
      initialDietaryRestrictions,
      joinerDietaryAdditions,
      noRestrictions,
      toggleRestriction,
      setRestrictionsAffirmativeNone,
      otherRestriction,
      addOtherRestriction,
      householdResolved,
      householdLoading,
      householdError,
      stepsComplete,
      advanceStep,
      completeStep,
      resetOnboarding,
      complete,
      completeJoin,
      completeJoinDietary,
      completeBridge,
      createHouseholdExplicit,
      joinHouseholdByCode,
      refreshHousehold,
    ]
  )

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
