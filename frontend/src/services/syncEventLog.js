/**
 * Provider sync lifecycle telemetry: Sentry breadcrumbs + offline queue → POST /api/telemetry/sync.
 * GlitchTip events only for anomalies (deduped per provider+phase per session).
 */

import { supabase } from './supabaseClient'
import { getEffectiveApiBaseUrl, initApiBaseUrl } from './apiClient'
import { addBreadcrumb, captureHandledError, setMonitoringTag } from './monitoring'
import * as syncTelemetry from './syncTelemetry'

const STORAGE_KEY = 'sync_event_log_queue'
const MAX_EVENTS = 500
const FLUSH_DEBOUNCE_MS = 1500
const MAX_METADATA_KEYS = 10
const MAX_FLUSH_BATCH = 50
const MAX_POISON_RETRIES = 2
const DETAIL_RESERVED_KEYS = new Set(['mode', 'reason', 'syncId', 'timestamp', 'metadata'])
const ANOMALY_COOLDOWN_MS = 10 * 60 * 1000
const SKIP_ESCALATION_THRESHOLD = 3
const SKIP_ESCALATION_WINDOW_MS = 24 * 60 * 60 * 1000

const appSessionId = crypto.randomUUID()

/** @type {Record<string, { syncId: string, mode: 'login'|'silent', startedAt: number }>} */
const activeAttempts = {}

/** @type {Record<string, number>} */
const anomalyLastSent = {}

/** @type {Record<string, { skips: number[], lastSuccessAt: number | null }>} */
const skipTracker = {}

const ANOMALY_PHASES = new Set([
  'webview_open_failed',
  'close_failed',
  'close_skipped_not_owner',
  'close_unconfirmed',
  'login_timeout',
  'silent_timeout',
  'closed_early',
  'loop_detected',
  'ingest_failed',
  'sync_failed',
  'needs_reconnect',
])

const FAIL_REASON_BY_PHASE = {
  close_failed: 'webview_timeout',
  close_unconfirmed: 'webview_timeout',
  close_skipped_not_owner: 'unknown',
  login_timeout: 'webview_timeout',
  silent_timeout: 'webview_timeout',
  closed_early: 'webview_closed_early',
  loop_detected: 'unknown',
  ingest_failed: 'unknown',
  sync_failed: 'unknown',
  needs_reconnect: 'token_expired',
  webview_open_failed: 'unknown',
}

/** @type {boolean | null} */
let _preferencesAvailableCache = null

let flushTimer = null

async function isPreferencesAvailable(probeKey) {
  if (_preferencesAvailableCache !== null) return _preferencesAvailableCache
  try {
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.get({ key: probeKey })
    _preferencesAvailableCache = true
  } catch {
    _preferencesAvailableCache = false
  }
  return _preferencesAvailableCache
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(metadata)) {
    const t = typeof value
    if (t === 'string' || t === 'number' || t === 'boolean') {
      if (t === 'string' && value.length > 200) {
        out[key] = value.slice(0, 200)
      } else {
        out[key] = value
      }
    }
  }
  return capMetadataKeys(out)
}

function capMetadataKeys(meta, max = MAX_METADATA_KEYS) {
  const keys = Object.keys(meta)
  if (keys.length <= max) return meta
  const out = {}
  for (let i = 0; i < max; i++) out[keys[i]] = meta[keys[i]]
  return out
}

function metadataFromDetail(detail) {
  if (!detail || typeof detail !== 'object') return {}
  if (detail.metadata && typeof detail.metadata === 'object') {
    return sanitizeMetadata(detail.metadata)
  }
  const rest = {}
  for (const [key, value] of Object.entries(detail)) {
    if (!DETAIL_RESERVED_KEYS.has(key)) rest[key] = value
  }
  return sanitizeMetadata(rest)
}

async function loadQueue() {
  try {
    const usePrefs = await isPreferencesAvailable(STORAGE_KEY)
    if (usePrefs) {
      const { Preferences } = await import('@capacitor/preferences')
      const { value } = await Preferences.get({ key: STORAGE_KEY })
      if (value == null || value === '') return []
      try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
    if (typeof localStorage !== 'undefined') {
      const s = localStorage.getItem(STORAGE_KEY)
      if (s == null || s === '') return []
      try {
        const parsed = JSON.parse(s)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
  } catch {
    /* ignore */
  }
  return []
}

async function saveQueue(events) {
  const json = JSON.stringify(events)
  try {
    const usePrefs = await isPreferencesAvailable(STORAGE_KEY)
    if (usePrefs) {
      const { Preferences } = await import('@capacitor/preferences')
      await Preferences.set({ key: STORAGE_KEY, value: json })
      return
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, json)
    }
  } catch {
    /* ignore */
  }
}

function tierForMode(mode) {
  if (mode === 'login') return 't2'
  if (mode === 'silent') return 't3'
  return 't4'
}

async function mirrorSyncTelemetry(provider, phase, detail = {}) {
  const mode = detail.mode || activeAttempts[provider]?.mode
  const tier = tierForMode(mode)
  try {
    if (phase === 'session_begin') {
      await syncTelemetry.record({ provider, tier, outcome: 'attempt' })
    } else if (phase === 'sync_succeeded') {
      const startedAt = activeAttempts[provider]?.startedAt
      const durationMs = startedAt ? Date.now() - startedAt : undefined
      await syncTelemetry.record({ provider, tier, outcome: 'success', durationMs })
    } else if (
      phase === 'sync_failed' ||
      phase === 'ingest_failed' ||
      phase === 'needs_reconnect' ||
      ANOMALY_PHASES.has(phase)
    ) {
      const reason = FAIL_REASON_BY_PHASE[phase] || detail.reason || 'unknown'
      await syncTelemetry.record({ provider, tier, outcome: 'fail', reason })
    }
  } catch {
    /* never throw */
  }
}

function shouldSendAnomaly(provider, phase) {
  const key = `${provider}:${phase}`
  const last = anomalyLastSent[key]
  if (last != null && Date.now() - last < ANOMALY_COOLDOWN_MS) {
    return false
  }
  anomalyLastSent[key] = Date.now()
  return true
}

function trackSkipEscalation(provider) {
  const now = Date.now()
  if (!skipTracker[provider]) {
    skipTracker[provider] = { skips: [], lastSuccessAt: null }
  }
  const tracker = skipTracker[provider]
  tracker.skips = tracker.skips.filter((t) => now - t < SKIP_ESCALATION_WINDOW_MS)
  tracker.skips.push(now)
  const recentSuccess =
    tracker.lastSuccessAt != null && now - tracker.lastSuccessAt < SKIP_ESCALATION_WINDOW_MS
  if (!recentSuccess && tracker.skips.length >= SKIP_ESCALATION_THRESHOLD) {
    tracker.skips = []
    return true
  }
  return false
}

function noteSyncSuccess(provider) {
  if (!skipTracker[provider]) {
    skipTracker[provider] = { skips: [], lastSuccessAt: null }
  }
  skipTracker[provider].lastSuccessAt = Date.now()
  skipTracker[provider].skips = []
}

function scheduleFlush() {
  if (flushTimer != null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flush()
  }, FLUSH_DEBOUNCE_MS)
}

/**
 * Start a new sync attempt; returns opaque sync_id for correlation.
 * @param {'costco'|'safeway'} provider
 * @param {'login'|'silent'} mode
 * @returns {string}
 */
export function beginSyncAttempt(provider, mode) {
  const syncId = crypto.randomUUID()
  activeAttempts[provider] = { syncId, mode, startedAt: Date.now() }
  setMonitoringTag('sync_id', syncId)
  void logPhase(provider, 'session_begin', { syncId, mode })
  return syncId
}

export function getActiveSyncId(provider) {
  return activeAttempts[provider]?.syncId ?? null
}

export function getAppSessionId() {
  return appSessionId
}

/**
 * @param {'costco'|'safeway'} provider
 * @param {string} phase
 * @param {object} [detail]
 */
export async function logPhase(provider, phase, detail = {}) {
  try {
    const syncId = detail.syncId || activeAttempts[provider]?.syncId || crypto.randomUUID()
    const mode = detail.mode || activeAttempts[provider]?.mode || null
    const reason = detail.reason != null ? String(detail.reason).slice(0, 500) : undefined
    const metadata = metadataFromDetail(detail)

    addBreadcrumb({
      category: 'sync',
      message: `${provider}:${phase}`,
      level: ANOMALY_PHASES.has(phase) ? 'warning' : 'info',
      data: { provider, phase, sync_id: syncId, mode, reason, ...metadata },
    })

    const entry = {
      provider,
      phase,
      syncId,
      sessionId: appSessionId,
      mode,
      reason,
      timestamp: detail.timestamp ?? Date.now(),
      metadata,
      sent: false,
    }

    const queue = await loadQueue()
    queue.push(entry)
    while (queue.length > MAX_EVENTS) {
      queue.shift()
    }
    await saveQueue(queue)

    void mirrorSyncTelemetry(provider, phase, { ...detail, mode })

    if (phase === 'sync_succeeded') {
      noteSyncSuccess(provider)
      delete activeAttempts[provider]
    }

    if (phase === 'sync_skipped') {
      if (trackSkipEscalation(provider)) {
        if (shouldSendAnomaly(provider, 'sync_skipped')) {
          const syncId = detail.syncId || activeAttempts[provider]?.syncId
          captureHandledError(
            new Error(`Sync anomaly: ${provider} sync_skipped (consecutive_skips_escalated)`),
            {
              sync_id: syncId,
              provider,
              phase: 'sync_skipped',
              reason: 'consecutive_skips_escalated',
              mode: detail.mode || activeAttempts[provider]?.mode,
            }
          )
        }
      }
    }

    scheduleFlush()
  } catch {
    /* never throw */
  }
}

/**
 * Log phase + send deduped GlitchTip event for anomalies.
 */
export async function reportAnomaly(provider, phase, detail = {}) {
  await logPhase(provider, phase, detail)
  if (!ANOMALY_PHASES.has(phase) && phase !== 'sync_skipped') {
    return
  }
  if (!shouldSendAnomaly(provider, phase)) {
    return
  }
  const syncId = detail.syncId || activeAttempts[provider]?.syncId
  const message = `Sync anomaly: ${provider} ${phase}${detail.reason ? ` (${detail.reason})` : ''}`
  captureHandledError(new Error(message), {
    sync_id: syncId,
    provider,
    phase,
    reason: detail.reason,
    mode: detail.mode || activeAttempts[provider]?.mode,
    ...metadataFromDetail(detail),
  })
}

export async function flush() {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    return { sent: 0 }
  }

  const queue = await loadQueue()
  const pending = queue.filter((e) => !e.sent)
  if (pending.length === 0) {
    return { sent: 0 }
  }

  await initApiBaseUrl()
  const base = getEffectiveApiBaseUrl().url.replace(/\/+$/, '')
  const url = `${base}/telemetry/sync`

  const activeSyncId = Object.values(activeAttempts)[0]?.syncId
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  }
  if (activeSyncId) {
    headers['X-Sync-Id'] = activeSyncId
  }

  let totalSent = 0

  for (let offset = 0; offset < pending.length; offset += MAX_FLUSH_BATCH) {
    const batch = pending.slice(offset, offset + MAX_FLUSH_BATCH)
    const body = {
      events: batch.map((entry) => ({
        provider: entry.provider,
        phase: entry.phase,
        syncId: entry.syncId,
        sessionId: entry.sessionId,
        mode: entry.mode,
        reason: entry.reason,
        timestamp: entry.timestamp,
        metadata: capMetadataKeys(entry.metadata || {}),
      })),
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      if (response.ok) {
        const batchKeys = new Set(
          batch.map((e) => `${e.syncId}:${e.phase}:${e.timestamp}`)
        )
        for (const entry of queue) {
          const key = `${entry.syncId}:${entry.phase}:${entry.timestamp}`
          if (batchKeys.has(key)) {
            entry.sent = true
            entry.poisonRetries = 0
            totalSent += 1
          }
        }
        continue
      }

      if (response.status === 400 && batch.length > 1) {
        for (const entry of batch) {
          const singleBody = {
            events: [
              {
                provider: entry.provider,
                phase: entry.phase,
                syncId: entry.syncId,
                sessionId: entry.sessionId,
                mode: entry.mode,
                reason: entry.reason,
                timestamp: entry.timestamp,
                metadata: capMetadataKeys(entry.metadata || {}),
              },
            ],
          }
          const singleResp = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(singleBody),
          })
          const key = `${entry.syncId}:${entry.phase}:${entry.timestamp}`
          if (singleResp.ok) {
            for (const q of queue) {
              if (`${q.syncId}:${q.phase}:${q.timestamp}` === key) {
                q.sent = true
                q.poisonRetries = 0
                totalSent += 1
              }
            }
          } else {
            for (const q of queue) {
              if (`${q.syncId}:${q.phase}:${q.timestamp}` === key) {
                q.poisonRetries = (q.poisonRetries || 0) + 1
                if (q.poisonRetries >= MAX_POISON_RETRIES) {
                  q.sent = true
                }
              }
            }
          }
        }
        continue
      }

      if (response.status === 400) {
        for (const entry of batch) {
          entry.poisonRetries = (entry.poisonRetries || 0) + 1
          if (entry.poisonRetries >= MAX_POISON_RETRIES) {
            entry.sent = true
          }
        }
      }
    } catch {
      break
    }
  }

  await saveQueue(queue)
  return { sent: totalSent }
}

export async function reset() {
  try {
    const usePrefs = await isPreferencesAvailable(STORAGE_KEY)
    if (usePrefs) {
      const { Preferences } = await import('@capacitor/preferences')
      await Preferences.remove({ key: STORAGE_KEY })
    } else if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    /* ignore */
  }
}

export async function dump() {
  return loadQueue()
}

/** @enum {string} */
export const SyncPhase = {
  SESSION_BEGIN: 'session_begin',
  SESSION_BUSY: 'session_busy',
  SESSION_PREEMPTED: 'session_preempted',
  WEBVIEW_OPENED: 'webview_opened',
  WEBVIEW_OPEN_FAILED: 'webview_open_failed',
  AUTH_COMPLETE: 'auth_complete',
  TOKENS_RECEIVED: 'tokens_received',
  RECEIPTS_RECEIVED: 'receipts_received',
  CLOSE_REQUESTED: 'close_requested',
  CLOSE_CONFIRMED: 'close_confirmed',
  CLOSE_FAILED: 'close_failed',
  CLOSE_SKIPPED_NOT_OWNER: 'close_skipped_not_owner',
  CLOSE_UNCONFIRMED: 'close_unconfirmed',
  LOGIN_TIMEOUT: 'login_timeout',
  SILENT_TIMEOUT: 'silent_timeout',
  CLOSED_EARLY: 'closed_early',
  LOOP_DETECTED: 'loop_detected',
  INGEST_STARTED: 'ingest_started',
  INGEST_FAILED: 'ingest_failed',
  SYNC_SUCCEEDED: 'sync_succeeded',
  SYNC_FAILED: 'sync_failed',
  SYNC_SKIPPED: 'sync_skipped',
  NEEDS_RECONNECT: 'needs_reconnect',
  DIAGNOSTIC_CHECKPOINT: 'diagnostic_checkpoint',
  TOKEN_EXCHANGE: 'token_exchange',
  WEBVIEW_ORPHAN_CLOSED: 'webview_orphan_closed',
}

if (
  typeof window !== 'undefined' &&
  typeof window.localStorage?.getItem === 'function' &&
  window.localStorage.getItem('SYNC_EVENT_LOG_DEV_PANEL') === '1'
) {
  window.__syncEventLog = { dump, reset, flush, beginSyncAttempt, getAppSessionId }
}
