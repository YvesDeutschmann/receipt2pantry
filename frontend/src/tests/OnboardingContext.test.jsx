import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import {
  OnboardingProvider,
  ONBOARDING_STEP_NAMES,
  useOnboarding,
} from '../contexts/OnboardingContext'

const authMock = vi.hoisted(() => ({
  loading: false,
  session: null,
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    user_metadata: {},
  },
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: authMock.user,
    session: authMock.session,
    loading: authMock.loading,
  }),
}))

const mockGetHousehold = vi.fn()
const mockCreateHousehold = vi.fn()
const mockJoinHousehold = vi.fn()
const mockMergeDietaryRestrictions = vi.fn(() => Promise.resolve({}))
const mockUpdateHouseholdProfile = vi.fn(() => Promise.resolve({}))

vi.mock('../services/apiClient', () => ({
  api: {
    getHousehold: (...args) => mockGetHousehold(...args),
    createHousehold: (...args) => mockCreateHousehold(...args),
    joinHousehold: (...args) => mockJoinHousehold(...args),
    mergeDietaryRestrictions: (...args) => mockMergeDietaryRestrictions(...args),
    updateHouseholdProfile: (...args) => mockUpdateHouseholdProfile(...args),
  },
}))

const mockUpdateUser = vi.fn(() => Promise.resolve({ data: {}, error: null }))

vi.mock('../services/supabaseClient', () => ({
  supabase: {
    auth: {
      updateUser: (...args) => mockUpdateUser(...args),
    },
  },
}))

function createWrapper(probeRef = undefined) {
  function Wrapper({ children }) {
    return (
      <OnboardingProvider renderProbeRef={probeRef}>{children}</OnboardingProvider>
    )
  }
  return Wrapper
}

async function renderOnboardingHook(options) {
  const hook = renderHook(() => useOnboarding(), options)
  await waitFor(() => {
    expect(hook.result.current.householdLoading).toBe(false)
  })
  return hook
}

describe('OnboardingContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.loading = false
    authMock.session = null
    authMock.user = {
      id: '00000000-0000-4000-8000-000000000001',
      user_metadata: {},
    }
    mockGetHousehold.mockResolvedValue({
      household: {
        id: 'household-1',
        size: 2,
        dietary_restrictions: [],
      },
    })
    mockCreateHousehold.mockResolvedValue({
      household: { id: 'household-created' },
    })
  })

  it('test_useOnboarding_throws_outside_provider', () => {
    expect(() => {
      renderHook(() => useOnboarding())
    }).toThrow('useOnboarding must be used within an OnboardingProvider')
  })

  it('test_advancing_step_marks_all_prior_steps_complete', async () => {
    const { result } = await renderOnboardingHook({
      wrapper: createWrapper(),
    })

    for (let i = 0; i < ONBOARDING_STEP_NAMES.length; i++) {
      act(() => {
        result.current.advanceStep()
      })
      for (let j = 0; j <= i; j++) {
        expect(
          result.current.stepsComplete[ONBOARDING_STEP_NAMES[j]]
        ).toBe(true)
      }
      for (let j = i + 1; j < ONBOARDING_STEP_NAMES.length; j++) {
        expect(
          result.current.stepsComplete[ONBOARDING_STEP_NAMES[j]]
        ).toBe(false)
      }
    }
  })

  it('test_cannot_mark_later_step_complete_without_earlier_steps', async () => {
    const { result } = await renderOnboardingHook({
      wrapper: createWrapper(),
    })

    let ok = false
    act(() => {
      ok = result.current.completeStep('staples')
    })
    expect(ok).toBe(false)
    expect(result.current.stepsComplete.staples).toBe(false)
    expect(result.current.stepsComplete.household_size).toBe(false)
  })

  it('test_reset_returns_all_steps_to_initial_state', async () => {
    const { result } = await renderOnboardingHook({
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.advanceStep()
      result.current.advanceStep()
    })
    expect(result.current.stepsComplete.household_size).toBe(true)
    expect(result.current.stepsComplete.dietary_restrictions).toBe(true)

    act(() => {
      result.current.resetOnboarding()
    })

    for (const name of ONBOARDING_STEP_NAMES) {
      expect(result.current.stepsComplete[name]).toBe(false)
    }
  })

  it('test_complete_calls_updateUser_with_onboarding_completed_at_iso_timestamp', async () => {
    const { result } = await renderOnboardingHook({
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.complete()
    })

    expect(mockUpdateUser).toHaveBeenCalledTimes(1)
    const payload = mockUpdateUser.mock.calls[0][0]
    expect(payload).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          onboarding_completed_at: expect.any(String),
        }),
      })
    )
    const ts = payload.data.onboarding_completed_at
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(new Date(ts).toISOString()).toBe(ts)
    expect(payload.data).toEqual(
      expect.objectContaining({
        signup_method: 'email',
        cold_start_step: 2,
        whats_for_dinner_unlocked: true,
        cold_start_pantry_template_completed_at: ts,
      })
    )
  })

  it('COMPLETE_UPDATEUSER_FAILURE_ALLOWS_RETRY', async () => {
    mockUpdateUser
      .mockResolvedValueOnce({ data: {}, error: new Error('network') })
      .mockResolvedValueOnce({ data: {}, error: null })

    const { result } = await renderOnboardingHook({
      wrapper: createWrapper(),
    })

    let firstError = null
    await act(async () => {
      try {
        await result.current.complete()
      } catch (e) {
        firstError = e
      }
    })
    expect(firstError).toBeTruthy()
    expect(mockUpdateUser).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.complete()
    })

    expect(mockUpdateUser).toHaveBeenCalledTimes(2)
  })

  it('PAYOFF_DOUBLE_TAP_COMPLETES_ONCE', async () => {
    const { result } = await renderOnboardingHook({
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.complete()
    })
    await act(async () => {
      await result.current.complete()
    })

    expect(mockUpdateUser).toHaveBeenCalledTimes(1)
  })

  it('test_completeBridge_calls_updateHouseholdProfile_and_updateUser_with_cold_start_meta', async () => {
    const { result } = await renderOnboardingHook({
      wrapper: createWrapper(),
    })

    let ok = false
    await act(async () => {
      ok = await result.current.completeBridge({
        bridge_chose_providers: true,
        cold_start_skip_grocery: false,
      })
    })

    expect(ok).toBe(true)
    expect(mockUpdateHouseholdProfile).toHaveBeenCalledTimes(1)
    expect(mockUpdateHouseholdProfile).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      {
        size: 2,
        dietaryRestrictions: [],
      }
    )
    expect(mockUpdateUser).toHaveBeenCalledTimes(1)
    const payload = mockUpdateUser.mock.calls[0][0]
    expect(payload).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          cold_start_step: 1,
          signup_method: 'email',
          bridge_chose_providers: true,
          cold_start_skip_grocery: false,
        }),
      })
    )
  })

  it('test_actions_noop_while_auth_loading_true', async () => {
    authMock.loading = true
    authMock.user = null

    const { result } = await renderOnboardingHook({
      wrapper: createWrapper(),
    })

    const initialSize = result.current.householdSize

    act(() => {
      result.current.setHouseholdSize(77)
    })
    expect(result.current.householdSize).toBe(initialSize)

    act(() => {
      result.current.toggleRestriction('dairy')
    })
    expect(result.current.rawDietaryRestrictions).toEqual([])

    act(() => {
      result.current.setRestrictionsAffirmativeNone()
    })
    expect(result.current.noRestrictions).toBe(false)

    act(() => {
      result.current.setOtherRestriction('nuts')
    })
    expect(result.current.otherRestriction).toBe('')

    act(() => {
      result.current.advanceStep()
    })
    expect(result.current.stepsComplete.household_size).toBe(false)

    act(() => {
      expect(result.current.completeStep('household_size')).toBe(false)
    })

    act(() => {
      result.current.resetOnboarding()
    })
    expect(result.current.stepsComplete.household_size).toBe(false)

    await act(async () => {
      await result.current.complete()
    })
    expect(mockUpdateUser).not.toHaveBeenCalled()

    let bridgeOk = true
    await act(async () => {
      bridgeOk = await result.current.completeBridge({})
    })
    expect(bridgeOk).toBe(false)
    expect(mockUpdateHouseholdProfile).not.toHaveBeenCalled()
  })

  it('test_context_value_is_stable_reference_when_unrelated_state_changes', async () => {
    const probeRef = { current: null }
    const { result, rerender } = await renderOnboardingHook({
      wrapper: createWrapper(probeRef),
    })

    const beforeBump = result.current

    await act(async () => {
      probeRef.current?.()
    })

    rerender()

    expect(result.current).toBe(beforeBump)
  })

  it('test_does_not_auto_create_household_on_load', async () => {
    mockGetHousehold.mockResolvedValue({ household: null })

    const { result } = await renderOnboardingHook({
      wrapper: createWrapper(),
    })

    expect(result.current.householdResolved).toBe(true)
    expect(result.current.householdId).toBeNull()
    expect(mockCreateHousehold).not.toHaveBeenCalled()
  })

  it('test_completeJoin_sets_onboarding_without_cold_start_pantry_template', async () => {
    const { result } = await renderOnboardingHook({
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.completeJoin()
    })

    expect(mockUpdateUser).toHaveBeenCalledTimes(1)
    const payload = mockUpdateUser.mock.calls[0][0]
    expect(payload.data.onboarding_completed_at).toBeDefined()
    expect(payload.data.cold_start_pantry_template_completed_at).toBeUndefined()
    expect(payload.data.cold_start_step).toBe(2)
  })

  it('test_completeJoinDietary_merges_additions_not_size_put', async () => {
    mockGetHousehold.mockResolvedValue({
      household: {
        id: 'household-join',
        role: 'member',
        size: 4,
        dietary_restrictions: ['peanuts'],
      },
    })

    const { result } = await renderOnboardingHook({
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.toggleRestriction('shellfish')
    })

    await act(async () => {
      await result.current.mergeJoinDietary()
    })

    expect(mockMergeDietaryRestrictions).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      ['shellfish']
    )
    expect(mockUpdateHouseholdProfile).not.toHaveBeenCalled()
    expect(mockUpdateUser).not.toHaveBeenCalled()
  })

  it('test_joinHouseholdByCode_does_not_call_createHousehold', async () => {
    mockGetHousehold.mockResolvedValue({ household: null })
    mockJoinHousehold.mockResolvedValue({
      household: {
        id: 'household-joined',
        role: 'member',
        size: 3,
        dietary_restrictions: ['dairy'],
      },
    })

    const { result } = await renderOnboardingHook({
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.joinHouseholdByCode('ABC123')
    })

    expect(mockJoinHousehold).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      'ABC123'
    )
    expect(mockCreateHousehold).not.toHaveBeenCalled()
    expect(result.current.householdRole).toBe('member')
    expect(result.current.isJoiner).toBe(true)
  })
})
