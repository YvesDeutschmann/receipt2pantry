import { createContext, useContext, useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../services/supabaseClient'
import { SignInWithApple } from '../native/signInWithApple'
import { emit, FunnelEvent } from '../services/funnelTelemetry'

const AuthContext = createContext(null)

/** iOS app bundle (Sign in with Apple `clientId`); matches `appId` in `capacitor.config.ts`. */
const IOS_APP_BUNDLE_ID = 'com.meald.app'
const APPLE_OAUTH_REDIRECT = `${IOS_APP_BUNDLE_ID}://auth-callback`

/**
 * @param {string} message
 * @returns {Promise<string>} lowercase hex SHA-256
 */
async function sha256Hex(message) {
  const data = new TextEncoder().encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(hashBuffer)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function getOAuthRedirectUrl() {
  return `${window.location.origin}/auth`
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess)
      setUser(sess?.user ?? null)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
      setUser(sess?.user ?? null)
      setLoading(false)
      if (_event === 'SIGNED_IN' && sess?.user?.id) {
        void emit(FunnelEvent.SIGN_IN, sess.user.id)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  const signUp = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { signup_method: 'email' } }
    })
    if (error) throw error
    return data
  }

  const signInWithApple = async () => {
    if (Capacitor.getPlatform() !== 'ios') {
      throw new Error('Sign in with Apple is only available on iOS.')
    }

    const rawNonce = crypto.randomUUID()
    const hashedNonce = await sha256Hex(rawNonce)

    const result = await SignInWithApple.authorize({
      clientId: IOS_APP_BUNDLE_ID,
      redirectURI: APPLE_OAUTH_REDIRECT,
      scopes: 'email name',
      nonce: hashedNonce,
    })

    const idToken = result?.response?.identityToken
    if (!idToken) {
      throw new Error('Apple Sign-In did not return an identity token.')
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: idToken,
      nonce: rawNonce,
    })
    if (error) {
      const msg = error.message || ''
      if (msg.includes('Unacceptable audience')) {
        throw new Error(
          `Apple sign-in: in Supabase → Authentication → Providers → Apple, add "${IOS_APP_BUNDLE_ID}" to Client IDs (native tokens use the bundle ID as the token audience). See MOBILE_SETUP.md.`
        )
      }
      throw error
    }
    return data
  }

  const signInWithGoogle = async () => {
    const isNative = Capacitor.isNativePlatform()
    // Option C diagnostics: confirm native ID-token path vs web OAuth fallback
    console.log(
      '[Auth] signInWithGoogle — getPlatform:',
      Capacitor.getPlatform(),
      'isNativePlatform:',
      isNative
    )

    if (isNative) {
      try {
        console.log('[Auth] Using native Google Sign-In (ID token flow)')
        const { GoogleSignIn } = await import('@capawesome/capacitor-google-sign-in')
        console.log('[Auth] GoogleSignIn plugin loaded')

        await GoogleSignIn.initialize({
          clientId: import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID,
        })
        console.log('[Auth] GoogleSignIn.initialize() done. clientId:', import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID)

        const result = await GoogleSignIn.signIn()
        console.log('[Auth] GoogleSignIn.signIn() result keys:', result ? Object.keys(result) : 'null')
        console.log('[Auth] idToken present:', Boolean(result?.idToken))

        const idToken = result?.idToken
        if (!idToken) throw new Error('Google Sign-In did not return an ID token.')

        console.log('[Auth] Calling supabase.auth.signInWithIdToken...')
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        })
        if (error) {
          console.error('[Auth] signInWithIdToken error:', error.message, error)
          throw error
        }
        console.log('[Auth] signInWithIdToken success. user:', data?.user?.id)
        return data
      } catch (err) {
        console.error('[Auth] Native Google Sign-In failed:', err.message, err)
        throw err
      }
    }

    // Web fallback: browser redirect flow
    console.log('[Auth] Using web OAuth fallback (browser redirect)')
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: getOAuthRedirectUrl() },
    })
    if (error) {
      console.error('[Auth] signInWithOAuth error:', error.message)
      throw error
    }
    return data
  }

  const signOut = async () => {
    localStorage.removeItem('user_id')
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  const onboardingComplete = Boolean(user?.user_metadata?.onboarding_completed_at)

  const value = {
    user,
    session,
    loading,
    signIn,
    signUp,
    signOut,
    signInWithApple,
    signInWithGoogle,
    onboardingComplete,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
