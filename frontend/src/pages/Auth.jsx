import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function Auth() {
  const { user, signIn, signUp } = useAuth()

  if (user) {
    return <Navigate to="/" replace />
  }
  const [mode, setMode] = useState('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'signIn') {
        await signIn(email, password)
      } else {
        await signUp(email, password)
      }
    } catch (err) {
      setError(err.message || 'Something went wrong')
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
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm card">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary-600">GrocerySync</h1>
          <p className="text-gray-600 mt-1">
            {mode === 'signIn' ? 'Sign in to your account' : 'Create an account'}
          </p>
        </div>

        <div className="flex rounded-lg bg-gray-100 p-1 mb-6">
          <button
            type="button"
            onClick={() => {
              setMode('signIn')
              setError('')
            }}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === 'signIn'
                ? 'bg-white text-primary-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signUp')
              setError('')
            }}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === 'signUp'
                ? 'bg-white text-primary-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
              minLength={6}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                {mode === 'signIn' ? 'Signing in...' : 'Creating account...'}
              </span>
            ) : mode === 'signIn' ? (
              'Sign In'
            ) : (
              'Sign Up'
            )}
          </button>
        </form>

        {canUseTestUser && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={fillTestUser}
              className="w-full text-sm text-gray-500 hover:text-primary-600 transition-colors"
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
