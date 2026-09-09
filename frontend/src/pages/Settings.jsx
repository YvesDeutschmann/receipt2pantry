import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Store, Users } from 'lucide-react'
import {
  api,
  getApiBaseResolutionDebug,
  postDevLog,
  refreshSyncedApiBaseUrl,
  setApiBaseUrlOverride,
  shouldSyncApiBaseFromSupabase,
} from '../services/apiClient'
import { supabase } from '../services/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import HouseholdModal from '../components/HouseholdModal'
import PageHeader from '../components/PageHeader'
import {
  isCostcoDiagnosticPurgeEnabled,
  setCostcoDiagnosticPurgeEnabled,
} from '../services/costcoDiagnosticSettings'
import { clearCostcoInAppBrowserSession } from '../services/costcoWebViewBridge'
import {
  compactCookLoopQaLog,
  loadStashedCookLoopReport,
  stashCookLoopReport,
} from '../utils/cookLoopQa'

function Settings() {
  const [household, setHousehold] = useState(null)
  const [loading, setLoading] = useState(true)
  const [householdModalOpen, setHouseholdModalOpen] = useState(false)
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

  const showDevTools =
    import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEV_SETTINGS === '1'

  const { user } = useAuth()
  const userId = user?.id

  useEffect(() => {
    fetchHousehold()
  }, [userId])

  useEffect(() => {
    if (!showDevTools) return
    const dbg = getApiBaseResolutionDebug()
    setDevApiState(dbg)
    setDevApiInput(dbg.manualStored || '')
  }, [showDevTools])

  const fetchHousehold = async () => {
    try {
      const response = await api.getHousehold(userId)
      setHousehold(response.household)
    } catch (err) {
      console.error('Failed to fetch household:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleHouseholdChange = (newHousehold) => {
    setHousehold(newHousehold)
  }

  const handleRefreshSuggestions = async () => {
    if (!userId) return
    setRefreshingSuggestions(true)
    setRefreshSuggestionsMessage(null)
    try {
      await api.suggestions.triggerGeneration(userId, {
        triggerReason: 'manual_refresh',
        householdId: household?.id ?? null,
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
    <div>
      <PageHeader
        title="Settings"
        subtitle="Manage your account preferences and application settings."
      />

      <div className="space-y-6">
        {/* Household Settings */}
        <div className="card">
          <h2 className="text-xl font-display font-semibold text-cream mb-4">Household</h2>
          <p className="text-sm text-sage-light mb-4">
            Share your pantry, receipts, and cooking history with family members.
          </p>
          
          {loading ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-terra"></div>
            </div>
          ) : household ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-forest-light rounded-mise-md">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-forest rounded-mise-md">
                    <Users className="w-6 h-6 text-terra" />
                  </div>
                  <div>
                    <p className="font-medium text-cream">{household.name}</p>
                    <p className="text-sm text-sage-light">
                      You are {household.role === 'owner' ? 'the owner' : 'a member'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setHouseholdModalOpen(true)}
                  className="btn btn-ghost"
                >
                  Manage
                </button>
              </div>
              
              {household.role === 'owner' && (
                <div className="alert alert-info">
                  <p className="text-sm mb-2">
                    Invite others with your join code:
                  </p>
                  <code className="inline-block px-3 py-1 bg-forest-mid border border-forest-light rounded-mise-sm font-mono text-lg tracking-widest text-cream">
                    {household.join_code}
                  </code>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="mx-auto w-12 h-12 bg-forest-light rounded-full flex items-center justify-center mb-3">
                <Users className="w-6 h-6 text-sage-light" />
              </div>
              <p className="text-sage-light mb-4">
                No household yet. Create or join one to share with family.
              </p>
              <button
                onClick={() => setHouseholdModalOpen(true)}
                className="btn btn-primary"
              >
                Set Up Household
              </button>
            </div>
          )}
        </div>

        {/* Connected Stores - links to Providers */}
        <div className="card">
          <h2 className="text-xl font-display font-semibold text-cream mb-2">Recipe suggestions</h2>
          <p className="text-sm text-sage-light mb-4">
            Regenerate your background suggestion pool from your current pantry (may take a minute).
          </p>
          {refreshSuggestionsMessage && (
            <p className="text-sm text-cream mb-3" role="status">
              {refreshSuggestionsMessage}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={refreshingSuggestions || !userId}
            onClick={() => void handleRefreshSuggestions()}
          >
            {refreshingSuggestions ? 'Refreshing…' : 'Refresh suggestions'}
          </button>
        </div>

        <Link to="/providers" className="block">
          <div className="card hover:shadow-lg transition-shadow cursor-pointer">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-forest rounded-mise-md">
                  <Store className="w-6 h-6 text-terra" />
                </div>
                <div>
                  <h2 className="text-xl font-display font-semibold text-cream">Connected Stores</h2>
                  <p className="text-sm text-sage-light">
                    Connect Safeway, Costco, and other grocery accounts to sync receipts
                  </p>
                </div>
              </div>
              <span className="text-terra font-medium">Manage →</span>
            </div>
          </div>
        </Link>

        <div className="card">
          <h2 className="text-xl font-display font-semibold text-cream mb-4">Account Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-sage-light mb-2">
                Email
              </label>
              <input
                type="email"
                placeholder="user@example.com"
                className="input"
                disabled
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-sage-light mb-2">
                Name
              </label>
              <input
                type="text"
                placeholder="Your Name"
                className="input"
                disabled
              />
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-xl font-display font-semibold text-cream mb-4">Preferences</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-cream">Email Notifications</p>
                <p className="text-sm text-sage-light">
                  Receive notifications about new receipts
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" />
                <div className="w-11 h-6 bg-forest-light peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-terra/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-cream after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-cream after:border-forest-light after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-terra"></div>
              </label>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-cream">Auto-sync Receipts</p>
                <p className="text-sm text-sage-light">
                  Automatically fetch new receipts daily
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" defaultChecked />
                <div className="w-11 h-6 bg-forest-light peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-terra/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-cream after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-cream after:border-forest-light after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-terra"></div>
              </label>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-xl font-display font-semibold mb-4 text-[var(--color-error)]">Danger Zone</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border border-[var(--color-error)] rounded-mise-md">
              <div>
                <p className="font-medium text-cream">Delete Account</p>
                <p className="text-sm text-sage-light">
                  Permanently delete your account and all data
                </p>
              </div>
              <button className="btn bg-[var(--color-error)] text-cream hover:opacity-90">
                Delete
              </button>
            </div>
          </div>
        </div>

        {showDevTools && (
          <div className="card border-dashed border-[var(--color-error)]/50">
            <h2 className="text-sm font-medium text-[var(--color-error)] mb-2">Dev Tools</h2>
            <div className="mb-6 p-3 rounded-mise-md bg-forest-light/50 space-y-3 w-full max-w-xl">
              <h3 className="text-sm font-medium text-cream">Dev: API base URL</h3>
              <p className="text-xs text-sage-light">
                Effective:{' '}
                <code className="text-cream break-all">{devApiState.url}</code>{' '}
                <span className="text-sage-light">({devApiState.source})</span>
              </p>
              {devApiState.manualStored ? (
                <p className="text-xs text-sage-light">
                  Manual override stored:{' '}
                  <code className="text-cream break-all">{devApiState.manualStored}</code>
                </p>
              ) : null}
              {devApiState.syncedStored ? (
                <p className="text-xs text-sage-light">
                  Last synced from Supabase (cache):{' '}
                  <code className="text-cream break-all">{devApiState.syncedStored}</code>
                </p>
              ) : null}
              {!shouldSyncApiBaseFromSupabase() ? (
                <p className="text-xs text-amber-200/90">
                  Supabase auto-sync is off in this build (only in dev or when{' '}
                  <code className="text-cream">VITE_ENABLE_DEV_SETTINGS=1</code>).
                </p>
              ) : null}
              <label className="block text-xs text-sage-light">
                Manual override (optional)
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
                <p className="text-xs text-sage-light wrap-break-word" role="status">
                  {devApiMessage}
                </p>
              ) : null}
            </div>
            <div className="mb-6 p-3 rounded-mise-md bg-forest-light/50 space-y-2 w-full max-w-xl">
              <h3 className="text-sm font-medium text-cream">Dev: Costco token diagnostics</h3>
              <p className="text-xs text-sage-light">
                Auto-captures MSAL census checkpoints and <code>/token</code> exchange metadata
                during Costco sync (no Chrome DevTools). Login timeout is 15 minutes in dev builds.
              </p>
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
                  Arm before B3 only; leave off for Run A and B1.
                </span>
              </label>
            </div>
            <div className="mb-6 p-3 rounded-mise-md bg-forest-light/50 space-y-2 w-full max-w-xl">
              <h3 className="text-sm font-medium text-cream">Dev: WebView cleanup</h3>
              <p className="text-xs text-sage-light">
                Force-close tracked InAppBrowser instances (orphan cleanup). Last resort on device:{' '}
                <code className="text-cream">adb shell am force-stop com.meald.app</code>
              </p>
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
                      `Mock receipts: stored ${r.receipts_stored ?? 0}, pantry +${r.items_added_to_pantry ?? 0}. ` +
                        (r.errors?.length ? `Errors: ${r.errors.join('; ')}` : '')
                    )
                  } catch (e) {
                    setDevMockMessage(e?.message || String(e))
                  } finally {
                    setDevMockLoading(false)
                  }
                }}
                className="text-sm text-[var(--color-forest)] underline disabled:opacity-50"
              >
                Load mock receipts (Safeway + Costco)
              </button>
              <span className="text-sage-light text-xs hidden sm:inline">·</span>
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
                      `Reset + mock: stored ${r.receipts_stored ?? 0}, pantry +${r.items_added_to_pantry ?? 0}. ` +
                        (r.errors?.length ? `Errors: ${r.errors.join('; ')}` : '')
                    )
                  } catch (e) {
                    setDevMockMessage(e?.message || String(e))
                  } finally {
                    setDevMockLoading(false)
                  }
                }}
                className="text-sm text-[var(--color-error)] underline disabled:opacity-50"
              >
                Reset pantry & receipts, then load mock receipts
              </button>
            </div>
            {devMockMessage && (
              <p className="text-xs text-sage-light mt-2 max-w-prose wrap-break-word">{devMockMessage}</p>
            )}
            <div className="mt-4 p-3 rounded-mise-md bg-forest-light/50 space-y-2 w-full max-w-xl">
              <h3 className="text-sm font-medium text-cream">Dev: Cook-loop sandbox</h3>
              <p className="text-xs text-sage-light">
                Seeds paired pantry + pool card for <code className="text-cream">dev_cook_loop</code>.
                Do not tap Refresh suggestions before cooking the DEV card — generation clears unused pool rows.
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
                      setCookLoopMessage(
                        r.ok
                          ? 'Sandbox reset. Cook [DEV] Cook-loop pasta from What’s for Dinner.'
                          : `Reset with failures: ${(r.checks || []).filter((c) => !c.ok).map((c) => c.id).join(', ')}`
                      )
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
                      setCookLoopMessage(
                        r.ok
                          ? 'Cook-loop QA passed (server cook).'
                          : `QA failed: ${(r.checks || []).filter((c) => !c.ok).map((c) => c.id).join(', ')}`
                      )
                    } catch (e) {
                      setCookLoopMessage(e?.response?.data?.error || e?.message || String(e))
                    } finally {
                      setCookLoopLoading(false)
                    }
                  }}
                  className="text-sm text-[var(--color-forest)] underline disabled:opacity-50"
                >
                  Run cook-loop QA (server)
                </button>
                <button
                  type="button"
                  disabled={cookLoopLoading || !userId}
                  onClick={async () => {
                    if (!userId) return
                    setCookLoopMessage(null)
                    setCookLoopLoading(true)
                    try {
                      const r = await api.devCookLoopReport()
                      stashCookLoopReport(r)
                      setCookLoopReport(r)
                      postDevLog('cookLoopQa', compactCookLoopQaLog(r))
                      setCookLoopMessage(r.ok ? 'Report: all checks passed.' : 'Report: failures present.')
                    } catch (e) {
                      setCookLoopMessage(e?.response?.data?.error || e?.message || String(e))
                    } finally {
                      setCookLoopLoading(false)
                    }
                  }}
                  className="text-sm text-sage-light underline disabled:opacity-50"
                >
                  Refresh report
                </button>
              </div>
              {cookLoopMessage ? (
                <p className="text-xs text-sage-light wrap-break-word" role="status">{cookLoopMessage}</p>
              ) : null}
              {cookLoopReport?.checks?.length ? (
                <ul className="text-xs text-sage-light space-y-0.5 mt-2">
                  {cookLoopReport.checks.map((c) => (
                    <li key={c.id} className={c.ok ? 'text-green-300/90' : 'text-amber-200/90'}>
                      {c.ok ? '✓' : '✗'} {c.id}
                    </li>
                  ))}
                  {(cookLoopReport.client_checks || []).map((c) => (
                    <li key={`client-${c.id}`} className={c.ok ? 'text-green-300/90' : 'text-amber-200/90'}>
                      {c.ok ? '✓' : '✗'} {c.id} (client)
                    </li>
                  ))}
                </ul>
              ) : null}
              {cookLoopReport ? (
                <pre className="text-[10px] text-sage-light/80 overflow-x-auto max-h-40 mt-2 p-2 bg-forest/40 rounded">
                  {JSON.stringify(cookLoopReport, null, 2)}
                </pre>
              ) : null}
            </div>
            </div>
          </div>
        )}
      </div>

      {/* Household Modal */}
      <HouseholdModal
        isOpen={householdModalOpen}
        onClose={() => setHouseholdModalOpen(false)}
        userId={userId}
        onHouseholdChange={handleHouseholdChange}
      />
    </div>
  )
}

export default Settings
