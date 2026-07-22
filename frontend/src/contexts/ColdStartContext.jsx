import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'
import { emit, FunnelEvent } from '../services/funnelTelemetry'

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

  useEffect(() => {
    if (groceryConnectedFlag && user?.id) {
      void emit(FunnelEvent.STORE_CONNECTED, user.id)
    }
  }, [groceryConnectedFlag, user?.id])

  useEffect(() => {
    const userId = user?.id
    if (!userId) return undefined

    const onSyncCompleted = () => {
      void emit(FunnelEvent.STORE_CONNECTED, userId)
    }

    window.addEventListener('safeway-sync-completed', onSyncCompleted)
    window.addEventListener('costco-sync-completed', onSyncCompleted)

    return () => {
      window.removeEventListener('safeway-sync-completed', onSyncCompleted)
      window.removeEventListener('costco-sync-completed', onSyncCompleted)
    }
  }, [user?.id])

  useEffect(() => {
    if (receiptSyncStatus === 'complete' && receiptMatchCount > 0 && user?.id) {
      void emit(FunnelEvent.RECEIPTS_SYNCED, user.id, {
        matchCount: receiptMatchCount,
      })
    }
  }, [receiptSyncStatus, receiptMatchCount, user?.id])

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
