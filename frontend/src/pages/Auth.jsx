import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useAuth } from '../contexts/AuthContext'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8

function Auth() {
  const { user, signIn, signUp, signInWithApple, signInWithGoogle } = useAuth()

  if (user) {
    return <Navigate to="/" replace />
  }

  const [showEmailForm, setShowEmailForm] = useState(false)
  const [emailFormMode, setEmailFormMode] = useState('signUp') // 'signUp' | 'signIn'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [passwordErrorShown, setPasswordErrorShown] = useState(false)

  const handleSSO = async (provider) => {
    setError('')
    setLoading(true)
    try {
      if (provider === 'apple') {
        await signInWithApple()
      } else {
        await signInWithGoogle()
      }
    } catch (err) {
      const msg = err.message || 'Something went wrong'
      setError(
        msg.includes('unavailable') || msg.includes('provider')
          ? `Sign in with ${provider === 'apple' ? 'Apple' : 'Google'} is unavailable. Try again or use email.`
          : msg
      )
    } finally {
      setLoading(false)
    }
  }

  const handleEmailSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    setPasswordErrorShown(false)

    try {
      if (!EMAIL_REGEX.test(email)) {
        setError('Check your email address.')
        setLoading(false)
        return
      }

      if (password.length < MIN_PASSWORD_LENGTH) {
        setPasswordErrorShown(true)
        setError('Password must be at least 8 characters.')
        setLoading(false)
        return
      }

      if (emailFormMode === 'signUp') {
        try {
          await signUp(email, password)
        } catch (signUpErr) {
          const msg = (signUpErr.message || '').toLowerCase()
          if (msg.includes('already') || msg.includes('exists') || msg.includes('registered')) {
            setError('exists')
            setEmailFormMode('signIn')
            setLoading(false)
            return
          }
          throw signUpErr
        }
      } else {
        await signIn(email, password)
      }
    } catch (err) {
      const msg = (err.message || '').toLowerCase()
      if (msg.includes('invalid') || msg.includes('credentials')) {
        setError('exists')
        setEmailFormMode('signIn')
      } else if (err.message?.includes('network') || err.message?.includes('fetch')) {
        setError('No connection. Check your network and try again.')
      } else {
        setError(err.message || 'Something went wrong')
      }
    } finally {
      setLoading(false)
    }
  }

  const testUserEmail = import.meta.env.VITE_TEST_USER_EMAIL
  const testUserPassword = import.meta.env.VITE_TEST_USER_PASSWORD
  const canUseTestUser = testUserEmail && testUserPassword

  const fillTestUser = () => {
    if (canUseTestUser) {
      setEmail(testUserEmail)
      setPassword(testUserPassword)
      setError('')
    }
  }

  return (
    <div className="min-h-screen bg-forest flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm card">
        <div className="text-center mb-8">
          <h1 className="text-hero font-display font-bold text-cream">Meald</h1>
          <p className="text-subhead mt-2">
            Sign in to get started
          </p>
        </div>

        {!showEmailForm ? (
          <>
            <div className="space-y-3 mb-6">
              {Capacitor.getPlatform() === 'ios' && (
                <button
                  type="button"
                  onClick={() => handleSSO('apple')}
                  disabled={loading}
                  className="w-full btn btn-primary min-h-[48px] bg-black text-white hover:bg-gray-800 hover:opacity-90"
                >
                  Sign in with Apple
                </button>
              )}

              <button
                type="button"
                onClick={() => handleSSO('google')}
                disabled={loading}
                className="w-full btn btn-ghost min-h-[48px]"
              >
                Sign in with Google
              </button>
            </div>

            <p className="text-center text-sm text-sage-light mb-4">
              By continuing, you agree to our{' '}
              <a href="/terms" className="underline hover:text-cream">Terms of Service</a>
              {' '}and{' '}
              <a href="/privacy" className="underline hover:text-cream">Privacy Policy</a>.
            </p>

            <button
              type="button"
              onClick={() => {
                setShowEmailForm(true)
                setError('')
              }}
              className="w-full text-sm text-sage-light hover:text-terra-light transition-colors py-2"
            >
              Use email instead
            </button>
          </>
        ) : (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-sage-light mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setError('')
                }}
                required
                autoComplete="email"
                className="input"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-sage-light mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setError('')
                }}
                required
                autoComplete={emailFormMode === 'signUp' ? 'new-password' : 'current-password'}
                minLength={MIN_PASSWORD_LENGTH}
                className="input"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded-mise-md border border-[var(--color-error)] px-3 py-2 text-sm text-[var(--color-error)] bg-[var(--color-error)]/10">
                {error === 'exists' ? (
                  <>
                    An account with this email exists.{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setError('')
                        setEmailFormMode('signIn')
                      }}
                      className="underline font-medium"
                    >
                      Sign in instead
                    </button>
                  </>
                ) : (
                  error
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin rounded-full h-4 w-4 border-2 border-cream border-t-transparent" />
                  {emailFormMode === 'signUp' ? 'Creating account...' : 'Signing in...'}
                </span>
              ) : emailFormMode === 'signUp' ? (
                'Create account'
              ) : (
                'Sign in'
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setShowEmailForm(false)
                setError('')
                setEmailFormMode('signUp')
              }}
              className="w-full text-sm text-sage-light hover:text-terra-light transition-colors"
            >
              Back to sign in options
            </button>
          </form>
        )}

        {error && !showEmailForm && (
          <div className="mt-4 rounded-mise-md border border-[var(--color-error)] px-3 py-2 text-sm text-[var(--color-error)] bg-[var(--color-error)]/10">
            {error}
          </div>
        )}

        {canUseTestUser && (
          <div className="mt-6 pt-6 border-t border-forest-light">
            <button
              type="button"
              onClick={fillTestUser}
              className="w-full text-sm text-sage-light hover:text-terra-light transition-colors"
            >
              Dev: Sign in as Test User
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default Auth
