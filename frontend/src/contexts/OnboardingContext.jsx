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
import { api, postDevLog } from '../services/apiClient'
import { supabase } from '../services/supabaseClient'

const OnboardingContext = createContext(null)

const DEFAULT_HOUSEHOLD_NAME = 'My Household'

function summarizeAuthError(err) {
  if (!err) return null
  return {
    message: err.message,
    code: err.code,
    status: err.status,
    name: err.name,
  }
}

/** Matches session/JWT/auth failures for telemetry; broader than retry predicate alone. */
function looksSessionishError(error) {
  return (
    Boolean(error) &&
    (error.name === 'AuthSessionMissingError' ||
      error.status === 401 ||
      /session|jwt|expired|auth|token|refresh|missing/i.test(
        error.message || String(error.code || '')
      ))
  )
}

/** Ordered onboarding sub-flow steps (cold-start arc). */
export const ONBOARDING_STEP_NAMES = [
  'household_size',
  'dietary_restrictions',
  'bridge',
  'staples',
]

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
  const [householdSize, setHouseholdSize] = useState(2)
  const [dietaryRestrictions, setDietaryRestrictions] = useState([])
  const [noRestrictions, setNoRestrictions] = useState(false)
  const [otherRestriction, setOtherRestriction] = useState('')
  const [householdReady, setHouseholdReady] = useState(false)
  const [householdLoading, setHouseholdLoading] = useState(true)
  const [householdError, setHouseholdError] = useState(null)

  const [completedUpTo, setCompletedUpTo] = useState(-1)
  const completionSentRef = useRef(false)
  const [, setRenderProbe] = useState(0)

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
      const payload = {
        onboarding_completed_at: now,
        cold_start_pantry_template_completed_at: now,
        cold_start_step: 2,
        signup_method: getSignupMethod(),
        whats_for_dinner_unlocked: true,
        ...extra,
      }

      const doUpdate = () =>
        supabase.auth.updateUser({
          data: payload,
        })

      let { data, error } = await doUpdate()

      let firstErrorSnapshot = null
      let afterFirstGetSession = null
      let afterFirstGetUser = null
      let looksSessionish = false
      let refreshOutcome = 'skipped_first_update_ok'

      if (error) {
        firstErrorSnapshot = summarizeAuthError(error)
        looksSessionish = looksSessionishError(error)

        const gs = await supabase.auth.getSession()
        const sess = gs.data?.session
        afterFirstGetSession = {
          hasSession: Boolean(sess),
          hasUser: Boolean(sess?.user),
          expiresAt: sess?.expires_at ?? null,
          accessTokenLen: sess?.access_token?.length ?? 0,
          refreshTokenLen: sess?.refresh_token?.length ?? 0,
        }

        const gu = await supabase.auth.getUser()
        afterFirstGetUser = {
          hasUser: Boolean(gu.data?.user),
          error: gu.error
            ? { message: gu.error.message, name: gu.error.name }
            : null,
        }

        try {
          const ref = await supabase.auth.refreshSession()
          if (ref?.error) {
            refreshOutcome = `api_error:${ref.error.message || ref.error.name || 'unknown'}`
          } else if (!ref?.data?.session) {
            refreshOutcome = 'session_null'
          } else {
            refreshOutcome = 'session_present'
          }
        } catch (e) {
          refreshOutcome = `rejected:${e?.message || String(e)}`
        }

        ;({ data, error } = await doUpdate())
      }

      const secondErrorSnapshot = summarizeAuthError(error)
      const completedAt = data?.user?.user_metadata?.onboarding_completed_at
      if (error || !completedAt) {
        completionSentRef.current = false
        postDevLog(
          'OnboardingComplete',
          JSON.stringify({
            firstError: firstErrorSnapshot,
            secondError: secondErrorSnapshot,
            afterFirstGetSession,
            afterFirstGetUser,
            looksSessionish,
            refreshOutcome,
            missingCompletedAt: !completedAt,
          })
        )
        throw new Error(
          error?.message || 'Could not finish setup. Please try again.'
        )
      }
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

  const value = useMemo(
    () => ({
      householdId,
      householdSize,
      setHouseholdSize: setSize,
      dietaryRestrictions: dietaryRestrictionsEffective,
      rawDietaryRestrictions: dietaryRestrictions,
      noRestrictions,
      toggleRestriction,
      setRestrictionsAffirmativeNone,
      otherRestriction,
      setOtherRestriction: addOtherRestriction,
      householdReady,
      householdLoading,
      householdError,
      stepsComplete,
      advanceStep,
      completeStep,
      resetOnboarding,
      complete,
      completeBridge,
    }),
    [
      householdId,
      householdSize,
      setSize,
      dietaryRestrictionsEffective,
      dietaryRestrictions,
      noRestrictions,
      toggleRestriction,
      setRestrictionsAffirmativeNone,
      otherRestriction,
      addOtherRestriction,
      householdReady,
      householdLoading,
      householdError,
      stepsComplete,
      advanceStep,
      completeStep,
      resetOnboarding,
      complete,
      completeBridge,
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
