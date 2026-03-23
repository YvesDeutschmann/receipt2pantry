import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'

const ColdStartContext = createContext(null)

/**
 * Cold-start arc (grocery → pantry template → What's for Dinner).
 * Persists step flags in Supabase user_metadata alongside onboarding.
 */
export function ColdStartProvider({ children }) {
  const { user, session } = useAuth()
  const meta = user?.user_metadata ?? {}

  const [receiptSyncStatus, setReceiptSyncStatus] = useState('idle')
  const [receiptMatchCount, setReceiptMatchCount] = useState(0)

  const coldStartStep = meta.cold_start_step ?? 0
  const skipGrocery = Boolean(meta.cold_start_skip_grocery)
  const groceryConnectedFlag = Boolean(meta.cold_start_grocery_connected)

  const refreshMetadataFromSession = useCallback(() => {
    // AuthContext updates user on onAuthStateChange after updateUser
  }, [])

  const value = useMemo(
    () => ({
      coldStartStep,
      skipGrocery,
      groceryConnectedFlag,
      receiptSyncStatus,
      setReceiptSyncStatus,
      receiptMatchCount,
      setReceiptMatchCount,
      refreshMetadataFromSession,
      session,
      user,
    }),
    [
      coldStartStep,
      skipGrocery,
      groceryConnectedFlag,
      receiptSyncStatus,
      receiptMatchCount,
      refreshMetadataFromSession,
      session,
      user,
    ]
  )

  return (
    <ColdStartContext.Provider value={value}>
      {children}
    </ColdStartContext.Provider>
  )
}

export function useColdStart() {
  const ctx = useContext(ColdStartContext)
  if (!ctx) {
    throw new Error('useColdStart must be used within ColdStartProvider')
  }
  return ctx
}
