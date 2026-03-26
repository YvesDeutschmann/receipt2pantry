import { createContext, useContext, useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../services/supabaseClient'

const AuthContext = createContext(null)

/** Must match Android/iOS URL scheme and Supabase Auth → Redirect URLs. */
const OAUTH_NATIVE_REDIRECT = 'com.meald.app://auth-callback'

function getOAuthRedirectUrl() {
  if (Capacitor.isNativePlatform()) {
    return OAUTH_NATIVE_REDIRECT
  }
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
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: getOAuthRedirectUrl() },
    })
    if (error) throw error
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
