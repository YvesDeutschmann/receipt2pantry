import { useEffect, useState } from 'react'
import {
  api,
  getApiBaseResolutionDebug,
  postDevLog,
  refreshSyncedApiBaseUrl,
  setApiBaseUrlOverride,
  shouldSyncApiBaseFromSupabase,
} from '../../services/apiClient'
import { supabase } from '../../services/supabaseClient'
import {
  isCostcoDiagnosticPurgeEnabled,
  setCostcoDiagnosticPurgeEnabled,
} from '../../services/costcoDiagnosticSettings'
import { clearCostcoInAppBrowserSession } from '../../services/costcoWebViewBridge'
import {
  compactCookLoopQaLog,
  loadStashedCookLoopReport,
  stashCookLoopReport,
} from '../../utils/cookLoopQa'

export default function SettingsDevTools({ userId, householdId }) {
  const [refreshingSuggestions, setRefreshingSuggestions] = useState(false)
  const [refreshSuggestionsMessage, setRefreshSuggestionsMessage] = useState(null)
  const [devMockMessage, setDevMockMessage] = useState(null)
  const [devMockLoading, setDevMockLoading] = useState(false)
  const [cookLoopReport, setCookLoopReport] = useState(() => loadStashedCookLoopReport())
  const [cookLoopLoading, setCookLoopLoading] = useState(false)
  const [cookLoopMessage, setCookLoopMessage] = useState(null)
  const [devApiState, setDevApiState] = useState(() => getApiBaseResolutionDebug())
  const [devApiInput, setDevApiInput] = useState('')
  const [devApiMessage, setDevApiMessage] = useState(null)
  const [devApiBusy, setDevApiBusy] = useState(false)
  const [webviewCloseMessage, setWebviewCloseMessage] = useState(null)
  const [webviewCloseBusy, setWebviewCloseBusy] = useState(false)
  const [costcoPurgeExpired, setCostcoPurgeExpired] = useState(() =>
    isCostcoDiagnosticPurgeEnabled()
  )

  useEffect(() => {
    const dbg = getApiBaseResolutionDebug()
    setDevApiState(dbg)
    setDevApiInput(dbg.manualStored || '')
  }, [])

  const handleRefreshSuggestions = async () => {
    if (!userId) return
    setRefreshingSuggestions(true)
    setRefreshSuggestionsMessage(null)
    try {
      await api.suggestions.triggerGeneration(userId, {
        triggerReason: 'manual_refresh',
        householdId: householdId ?? null,
      })
      setRefreshSuggestionsMessage('Suggestions updated.')
      setTimeout(() => setRefreshSuggestionsMessage(null), 4000)
    } catch (err) {
      console.error('Refresh suggestions failed:', err)
      setRefreshSuggestionsMessage(
        err.response?.data?.error || 'Could not refresh suggestions. Try again later.'
      )
    } finally {
      setRefreshingSuggestions(false)
    }
  }

  return (
    <details className="mb-6 rounded-meald-lg border border-dashed border-[var(--color-error)]/40 bg-forest-mid/50">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--color-error)] list-none [&::-webkit-details-marker]:hidden">
        Dev Tools
      </summary>
      <div className="px-4 pb-4 space-y-4 border-t border-forest-light/50 pt-4">
        <div className="p-3 rounded-meald-md bg-forest-light/50 space-y-2">
          <h3 className="text-sm font-medium text-cream">Refresh suggestions</h3>
          <p className="text-xs text-sage-light">
            Regenerate the background suggestion pool from your current pantry (may take a minute).
          </p>
          {refreshSuggestionsMessage ? (
            <p className="text-xs text-cream" role="status">{refreshSuggestionsMessage}</p>
          ) : null}
          <button
            type="button"
            className="btn btn-primary text-sm py-1.5 px-3"
            disabled={refreshingSuggestions || !userId}
            onClick={() => void handleRefreshSuggestions()}
          >
            {refreshingSuggestions ? 'Refreshing…' : 'Refresh suggestions'}
          </button>
        </div>

        <div className="p-3 rounded-meald-md bg-forest-light/50 space-y-3">
          <h3 className="text-sm font-medium text-cream">Dev: API base URL</h3>
          <p className="text-xs text-sage-light">
            Effective: <code className="text-cream break-all">{devApiState.url}</code>{' '}
            <span>({devApiState.source})</span>
          </p>
          {devApiState.manualStored ? (
            <p className="text-xs text-sage-light">
              Manual override:{' '}
              <code className="text-cream break-all">{devApiState.manualStored}</code>
            </p>
          ) : null}
          {devApiState.syncedStored ? (
            <p className="text-xs text-sage-light">
              Synced cache:{' '}
              <code className="text-cream break-all">{devApiState.syncedStored}</code>
            </p>
          ) : null}
          {!shouldSyncApiBaseFromSupabase() ? (
            <p className="text-xs text-amber-200/90">
              Supabase auto-sync is off unless{' '}
              <code className="text-cream">VITE_ENABLE_DEV_SETTINGS=1</code>.
            </p>
          ) : null}
          <label className="block text-xs text-sage-light">
            Manual override
            <input
              type="text"
              className="input mt-1 w-full text-sm font-mono"
              placeholder="http://192.168.x.x:5000/api"
              value={devApiInput}
              onChange={(e) => setDevApiInput(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary text-sm py-1.5 px-3"
              disabled={devApiBusy}
              onClick={async () => {
                setDevApiBusy(true)
                setDevApiMessage(null)
                try {
                  await setApiBaseUrlOverride(devApiInput)
                  setDevApiState(getApiBaseResolutionDebug())
                  setDevApiMessage('Saved override.')
                } catch (e) {
                  setDevApiMessage(e?.message || String(e))
                } finally {
                  setDevApiBusy(false)
                }
              }}
            >
              Save override
            </button>
            <button
              type="button"
              className="btn btn-ghost text-sm py-1.5 px-3"
              disabled={devApiBusy}
              onClick={async () => {
                setDevApiBusy(true)
                setDevApiMessage(null)
                try {
                  await setApiBaseUrlOverride('')
                  setDevApiInput('')
                  setDevApiState(getApiBaseResolutionDebug())
                  setDevApiMessage('Cleared manual override.')
                } catch (e) {
                  setDevApiMessage(e?.message || String(e))
                } finally {
                  setDevApiBusy(false)
                }
              }}
            >
              Clear override
            </button>
            <button
              type="button"
              className="btn btn-ghost text-sm py-1.5 px-3"
              disabled={devApiBusy || !shouldSyncApiBaseFromSupabase()}
              onClick={async () => {
                setDevApiBusy(true)
                setDevApiMessage(null)
                try {
                  const r = await refreshSyncedApiBaseUrl()
                  if (r.skipped) {
                    setDevApiMessage('Server sync skipped (not a dev settings build).')
                  } else if (!r.ok) {
                    setDevApiMessage(r.error || 'Refresh failed')
                  } else {
                    setDevApiState(getApiBaseResolutionDebug())
                    setDevApiMessage(
                      r.changed
                        ? `Updated from server: ${r.value || '(cleared)'}`
                        : 'Already up to date.'
                    )
                  }
                } catch (e) {
                  setDevApiMessage(e?.message || String(e))
                } finally {
                  setDevApiBusy(false)
                }
              }}
            >
              Refresh from server
            </button>
            <button
              type="button"
              className="btn btn-ghost text-sm py-1.5 px-3"
              disabled={devApiBusy}
              onClick={async () => {
                setDevApiBusy(true)
                setDevApiMessage(null)
                try {
                  await api.healthCheck()
                  setDevApiMessage('Health check OK.')
                } catch (e) {
                  setDevApiMessage(
                    e?.response?.data?.error || e?.message || 'Health check failed'
                  )
                } finally {
                  setDevApiBusy(false)
                }
              }}
            >
              Test connection
            </button>
          </div>
          {devApiMessage ? (
            <p className="text-xs text-sage-light wrap-break-word" role="status">{devApiMessage}</p>
          ) : null}
        </div>

        <div className="p-3 rounded-meald-md bg-forest-light/50 space-y-2">
          <h3 className="text-sm font-medium text-cream">Dev: Costco token diagnostics</h3>
          <label className="flex items-start gap-2 text-xs text-sage-light cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={costcoPurgeExpired}
              onChange={(e) => {
                const next = e.target.checked
                setCostcoPurgeExpired(next)
                setCostcoDiagnosticPurgeEnabled(next)
              }}
            />
            <span>
              Run B: purge expired IdToken/AccessToken before sign-in (never RefreshToken).
            </span>
          </label>
        </div>

        <div className="p-3 rounded-meald-md bg-forest-light/50 space-y-2">
          <h3 className="text-sm font-medium text-cream">Dev: WebView cleanup</h3>
          <button
            type="button"
            className="btn btn-ghost text-sm py-1.5 px-3"
            disabled={webviewCloseBusy}
            onClick={async () => {
              setWebviewCloseBusy(true)
              setWebviewCloseMessage(null)
              try {
                await clearCostcoInAppBrowserSession()
                const listed =
                  typeof window !== 'undefined' && window.__mealdWebViews?.list
                    ? window.__mealdWebViews.list()
                    : []
                setWebviewCloseMessage(
                  `WebView cleanup done. Tracked instances: ${listed.length}.`
                )
              } catch (e) {
                setWebviewCloseMessage(e?.message || String(e))
              } finally {
                setWebviewCloseBusy(false)
              }
            }}
          >
            Force close WebViews
          </button>
          {webviewCloseMessage ? (
            <p className="text-xs text-sage-light wrap-break-word" role="status">
              {webviewCloseMessage}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 items-start">
          <button
            type="button"
            onClick={async () => {
              await api.devResetOnboarding()
              await supabase.auth.updateUser({
                data: {
                  onboarding_completed_at: null,
                  cold_start_step: null,
                  cold_start_grocery_connected: null,
                  cold_start_pantry_template_completed_at: null,
                  whats_for_dinner_unlocked: null,
                  bridge_chose_providers: null,
                  bridge_chose_manual: null,
                  cold_start_skip_grocery: null,
                },
              })
              window.location.reload()
            }}
            className="text-sm text-[var(--color-error)] underline"
          >
            Reset onboarding state
          </button>
          <div className="flex flex-col gap-1.5 w-full sm:flex-row sm:flex-wrap sm:items-center">
            <button
              type="button"
              disabled={devMockLoading || !userId}
              onClick={async () => {
                if (!userId) return
                setDevMockMessage(null)
                setDevMockLoading(true)
                try {
                  const r = await api.devLoadMockReceipts('all', { reset: false })
                  setDevMockMessage(
                    `Mock receipts: stored ${r.receipts_stored ?? 0}, pantry +${r.items_added_to_pantry ?? 0}.`
                  )
                } catch (e) {
                  setDevMockMessage(e?.message || String(e))
                } finally {
                  setDevMockLoading(false)
                }
              }}
              className="text-sm text-[var(--color-forest)] underline disabled:opacity-50"
            >
              Load mock receipts
            </button>
            <button
              type="button"
              disabled={devMockLoading || !userId}
              onClick={async () => {
                if (!userId) return
                setDevMockMessage(null)
                setDevMockLoading(true)
                try {
                  const r = await api.devLoadMockReceipts('all', { reset: true })
                  setDevMockMessage(
                    `Reset + mock: stored ${r.receipts_stored ?? 0}, pantry +${r.items_added_to_pantry ?? 0}.`
                  )
                } catch (e) {
                  setDevMockMessage(e?.message || String(e))
                } finally {
                  setDevMockLoading(false)
                }
              }}
              className="text-sm text-[var(--color-error)] underline disabled:opacity-50"
            >
              Reset pantry & load mock receipts
            </button>
          </div>
          {devMockMessage ? (
            <p className="text-xs text-sage-light max-w-prose wrap-break-word">{devMockMessage}</p>
          ) : null}

          <div className="mt-2 p-3 rounded-meald-md bg-forest-light/50 space-y-2 w-full">
            <h3 className="text-sm font-medium text-cream">Dev: Cook-loop sandbox</h3>
            <p className="text-xs text-sage-light">
              Do not tap Refresh suggestions before cooking the DEV card — generation clears
              unused pool rows.
            </p>
            <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                disabled={cookLoopLoading || !userId}
                onClick={async () => {
                  if (!userId) return
                  setCookLoopMessage(null)
                  setCookLoopLoading(true)
                  try {
                    const r = await api.devCookLoopReset()
                    stashCookLoopReport(r)
                    setCookLoopReport(r)
                    postDevLog('cookLoopQa', compactCookLoopQaLog(r))
                    setCookLoopMessage(r.ok ? 'Sandbox reset.' : 'Reset with failures.')
                  } catch (e) {
                    setCookLoopMessage(e?.response?.data?.error || e?.message || String(e))
                  } finally {
                    setCookLoopLoading(false)
                  }
                }}
                className="text-sm text-[var(--color-forest)] underline disabled:opacity-50"
              >
                Reset cook-loop sandbox
              </button>
              <button
                type="button"
                disabled={cookLoopLoading || !userId}
                onClick={async () => {
                  if (!userId) return
                  setCookLoopMessage(null)
                  setCookLoopLoading(true)
                  try {
                    const r = await api.devCookLoopRun()
                    stashCookLoopReport(r)
                    setCookLoopReport(r)
                    postDevLog('cookLoopQa', compactCookLoopQaLog(r))
                    setCookLoopMessage(r.ok ? 'Cook-loop QA passed.' : 'QA failed.')
                  } catch (e) {
                    setCookLoopMessage(e?.response?.data?.error || e?.message || String(e))
                  } finally {
                    setCookLoopLoading(false)
                  }
                }}
                className="text-sm text-[var(--color-forest)] underline disabled:opacity-50"
              >
                Run cook-loop QA
              </button>
            </div>
            {cookLoopMessage ? (
              <p className="text-xs text-sage-light wrap-break-word" role="status">{cookLoopMessage}</p>
            ) : null}
          </div>
        </div>
      </div>
    </details>
  )
}
