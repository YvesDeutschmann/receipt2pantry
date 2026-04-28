import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from '../contexts/AuthContext'

const {
  isNativePlatformMock,
  mockGetPlatform,
  mockGetSession,
  mockOnAuthStateChange,
  mockSignInWithPassword,
  mockSignUp,
  mockSignInWithOAuth,
  mockSignInWithIdToken,
  mockSignOut,
  mockGoogleInitialize,
  mockGoogleSignIn,
  mockAppleAuthorize,
  mockUnsubscribe,
} = vi.hoisted(() => ({
  isNativePlatformMock: vi.fn(() => false),
  mockGetPlatform: vi.fn(() => 'web'),
  mockGetSession: vi.fn(),
  mockOnAuthStateChange: vi.fn(),
  mockSignInWithPassword: vi.fn(),
  mockSignUp: vi.fn(),
  mockSignInWithOAuth: vi.fn(),
  mockSignInWithIdToken: vi.fn(),
  mockSignOut: vi.fn(),
  mockGoogleInitialize: vi.fn(),
  mockGoogleSignIn: vi.fn(),
  mockAppleAuthorize: vi.fn(),
  mockUnsubscribe: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: (...args) => mockGetPlatform(...args),
    isNativePlatform: (...args) => isNativePlatformMock(...args),
  },
}))

vi.mock('../services/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...args) => mockGetSession(...args),
      onAuthStateChange: (...args) => mockOnAuthStateChange(...args),
      signInWithPassword: (...args) => mockSignInWithPassword(...args),
      signUp: (...args) => mockSignUp(...args),
      signInWithOAuth: (...args) => mockSignInWithOAuth(...args),
      signInWithIdToken: (...args) => mockSignInWithIdToken(...args),
      signOut: (...args) => mockSignOut(...args),
    },
  },
}))

vi.mock('@capawesome/capacitor-google-sign-in', () => ({
  GoogleSignIn: {
    initialize: (...args) => mockGoogleInitialize(...args),
    signIn: (...args) => mockGoogleSignIn(...args),
  },
}))

vi.mock('../native/signInWithApple', () => ({
  SignInWithApple: {
    authorize: (...args) => mockAppleAuthorize(...args),
  },
}))

function createWrapper() {
  function Wrapper({ children }) {
    return <AuthProvider>{children}</AuthProvider>
  }
  return Wrapper
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isNativePlatformMock.mockReturnValue(false)
    mockGetPlatform.mockReturnValue('web')
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockOnAuthStateChange.mockImplementation(() => ({
      data: { subscription: { unsubscribe: mockUnsubscribe } },
    }))
    mockSignInWithPassword.mockResolvedValue({ data: {}, error: null })
    mockSignUp.mockResolvedValue({ data: {}, error: null })
    mockSignInWithOAuth.mockResolvedValue({ data: {}, error: null })
    mockSignInWithIdToken.mockResolvedValue({ data: { user: {} }, error: null })
    mockSignOut.mockResolvedValue({ error: null })
    mockGoogleInitialize.mockResolvedValue(undefined)
    mockGoogleSignIn.mockResolvedValue({ idToken: 'test-id-token' })
    mockAppleAuthorize.mockResolvedValue({
      response: { identityToken: 'test-apple-id-token' },
    })
  })

  describe('A — initial load', () => {
    it('test_loading_true_until_getSession_resolves', async () => {
      let resolveSession
      mockGetSession.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSession = () => resolve({ data: { session: null } })
          })
      )

      const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

      expect(result.current.loading).toBe(true)

      await act(async () => {
        resolveSession()
      })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })
    })

    it('test_loading_false_and_session_set_after_getSession', async () => {
      const mockUser = { id: 'user-1', email: 'a@b.com', user_metadata: {} }
      const mockSession = { user: mockUser, access_token: 'tok' }
      mockGetSession.mockResolvedValue({ data: { session: mockSession } })

      const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })
      expect(result.current.session).toEqual(mockSession)
      expect(result.current.user).toEqual(mockUser)
    })

    it('test_onAuthStateChange_subscription_cleaned_up_on_unmount', async () => {
      const { unmount } = renderHook(() => useAuth(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(mockOnAuthStateChange).toHaveBeenCalled()
      })

      unmount()

      expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
    })
  })

  describe('B — hook enforcement', () => {
    it('test_useAuth_throws_when_used_outside_provider', () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        expect(() => {
          renderHook(() => useAuth())
        }).toThrow('useAuth must be used within an AuthProvider')
      } finally {
        errSpy.mockRestore()
      }
    })
  })

  describe('C — sign-in paths', () => {
    it('test_signIn_calls_supabase_signInWithPassword_and_rethrows_error', async () => {
      const err = new Error('bad creds')
      mockSignInWithPassword.mockResolvedValue({ data: null, error: err })

      const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await expect(
        act(async () => {
          await result.current.signIn('e@mail.com', 'secret')
        })
      ).rejects.toThrow(err)

      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'e@mail.com',
        password: 'secret',
      })
    })

    it('test_signUp_passes_signup_method_email_metadata', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.signUp('new@user.com', 'pw123456')
      })

      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'new@user.com',
        password: 'pw123456',
        options: { data: { signup_method: 'email' } },
      })
    })

    it('test_signInWithApple_ios_uses_native_authorize_and_signInWithIdToken', async () => {
      mockGetPlatform.mockReturnValue('ios')
      const rawNonce = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
      const digestBuf = new Uint8Array(32)
      for (let i = 0; i < 32; i += 1) {
        digestBuf[i] = i
      }
      vi.spyOn(crypto, 'randomUUID').mockReturnValue(rawNonce)
      const digestSpy = vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(digestBuf.buffer)

      mockAppleAuthorize.mockResolvedValue({
        response: { identityToken: 'native-apple-jwt' },
      })
      mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: 'a1' } }, error: null })

      const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.signInWithApple()
      })

      expect(digestSpy).toHaveBeenCalled()
      expect(digestSpy.mock.calls[0][0]).toBe('SHA-256')
      expect(mockAppleAuthorize).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'com.meald.app',
          redirectURI: 'com.meald.app://auth-callback',
          scopes: 'email name',
        })
      )
      const nonceArg = mockAppleAuthorize.mock.calls[0][0].nonce
      expect(nonceArg).toMatch(/^[0-9a-f]{64}$/)
      expect(mockSignInWithIdToken).toHaveBeenCalledWith({
        provider: 'apple',
        token: 'native-apple-jwt',
        nonce: rawNonce,
      })
      expect(mockSignInWithOAuth).not.toHaveBeenCalled()

      digestSpy.mockRestore()
    })

    it('test_signInWithApple_ios_throws_when_identity_token_missing', async () => {
      mockGetPlatform.mockReturnValue('ios')
      mockAppleAuthorize.mockResolvedValue({ response: { identityToken: null } })
      const digestBuf = new Uint8Array(32)
      vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
      vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(digestBuf.buffer)

      const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await expect(
        act(async () => {
          await result.current.signInWithApple()
        })
      ).rejects.toThrow('Apple Sign-In did not return an identity token.')

      expect(mockSignInWithIdToken).not.toHaveBeenCalled()
    })

    it('test_signInWithApple_non_ios_throws', async () => {
      mockGetPlatform.mockReturnValue('web')

      const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await expect(
        act(async () => {
          await result.current.signInWithApple()
        })
      ).rejects.toThrow('Sign in with Apple is only available on iOS.')

      expect(mockAppleAuthorize).not.toHaveBeenCalled()
    })
  })

  describe('D — Google native path', () => {
    beforeEach(() => {
      isNativePlatformMock.mockReturnValue(true)
    })

    it('test_signInWithGoogle_native_uses_id_token_flow', async () => {
      mockGoogleSignIn.mockResolvedValue({ idToken: 'native-google-jwt' })
      mockSignInWithIdToken.mockResolvedValue({
        data: { user: { id: 'g1' } },
        error: null,
      })

      const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.signInWithGoogle()
      })

      expect(mockGoogleInitialize).toHaveBeenCalled()
      expect(mockGoogleSignIn).toHaveBeenCalled()
      expect(mockSignInWithIdToken).toHaveBeenCalledWith({
        provider: 'google',
        token: 'native-google-jwt',
      })
      expect(mockSignInWithOAuth).not.toHaveBeenCalled()
    })

    it('test_signInWithGoogle_native_throws_when_id_token_missing', async () => {
      mockGoogleSignIn.mockResolvedValue({})

      const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await expect(
        act(async () => {
          await result.current.signInWithGoogle()
        })
      ).rejects.toThrow('Google Sign-In did not return an ID token.')
    })

    it('test_signInWithGoogle_web_uses_signInWithOAuth_redirect', async () => {
      isNativePlatformMock.mockReturnValue(false)

      const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.signInWithGoogle()
      })

      expect(mockGoogleInitialize).not.toHaveBeenCalled()
      expect(mockSignInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth` },
      })
      expect(mockSignInWithIdToken).not.toHaveBeenCalled()
    })
  })

  describe('E — sign-out', () => {
    let callOrder

    beforeEach(() => {
      callOrder = []
      vi.stubGlobal('localStorage', {
        getItem: vi.fn(),
        setItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
        removeItem: vi.fn((key) => {
          callOrder.push(`removeItem:${key}`)
        }),
      })
      mockSignOut.mockImplementation(async () => {
        callOrder.push('signOut')
        return { error: null }
      })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('test_signOut_clears_localStorage_user_id_before_supabase_call', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      await act(async () => {
        await result.current.signOut()
      })

      expect(callOrder).toEqual(['removeItem:user_id', 'signOut'])
      expect(mockSignOut).toHaveBeenCalledTimes(1)
    })
  })

  describe('F — onboarding', () => {
    it('test_onboardingComplete_true_when_metadata_has_onboarding_completed_at', async () => {
      const mockUser = {
        id: 'u1',
        user_metadata: { onboarding_completed_at: '2024-06-01T00:00:00.000Z' },
      }
      mockGetSession.mockResolvedValue({
        data: { session: { user: mockUser, access_token: 't' } },
      })

      const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.onboardingComplete).toBe(true)
      })
    })

    it('test_onboardingComplete_false_when_metadata_missing_the_key', async () => {
      const mockUser = {
        id: 'u2',
        user_metadata: { other: 'x' },
      }
      mockGetSession.mockResolvedValue({
        data: { session: { user: mockUser, access_token: 't' } },
      })

      const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.onboardingComplete).toBe(false)
      })
    })

    it('test_onboardingComplete_false_when_user_is_null', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null } })

      const { result } = renderHook(() => useAuth(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })
      expect(result.current.user).toBeNull()
      expect(result.current.onboardingComplete).toBe(false)
    })
  })
})
