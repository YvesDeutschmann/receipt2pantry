import { createContext, useContext, useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../services/supabaseClient'

const AuthContext = createContext(null)

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
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'apple' })
    if (error) throw error
    return data
  }

  const signInWithGoogle = async () => {
    if (Capacitor.isNativePlatform()) {
      const { GoogleSignIn } = await import('@capawesome/capacitor-google-sign-in')
      await GoogleSignIn.initialize({
        clientId: import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID,
      })
      const result = await GoogleSignIn.signIn()
      const idToken = result?.idToken
      if (!idToken) throw new Error('Google Sign-In did not return an ID token.')
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      })
      if (error) throw error
      return data
    }
    // Web fallback: browser redirect flow
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google' })
    if (error) throw error
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
