/**
 * GlitchTip-compatible error monitoring (@sentry/react).
 * DSN-gated; no PII sent by default.
 */

import * as Sentry from '@sentry/react'

let initialized = false

const SENSITIVE_KEY_RE = /authorization|token|secret|password|cookie|email|jwt|api[_-]?key|credential|session/i

const PROVIDER_DENY_URLS = [
  /safeway\.com/i,
  /costco\.com/i,
  /contentstack\.com/i,
]

function scrubMapping(data) {
  if (!data || typeof data !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = '[Filtered]'
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value
    } else {
      out[key] = '[Filtered]'
    }
  }
  return out
}

function beforeSend(event) {
  if (event?.request) {
    delete event.request.cookies
    delete event.request.data
    if (event.request.headers) {
      event.request.headers = scrubMapping(event.request.headers)
    }
  }
  if (event?.user) {
    const id = event.user.id
    event.user = id ? { id } : {}
  }
  if (event?.extra) {
    event.extra = scrubMapping(event.extra)
  }
  return event
}

function beforeBreadcrumb(crumb) {
  if (!crumb) return crumb
  const category = String(crumb.category || '').toLowerCase()
  if (category === 'console' || category === 'xhr' || category === 'fetch' || category === 'http') {
    delete crumb.data
    delete crumb.message
  } else if (crumb.data) {
    crumb.data = scrubMapping(crumb.data)
  }
  return crumb
}

function registerGlobalHandlers() {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (event) => {
    if (event.error instanceof Error) {
      Sentry.captureException(event.error)
    } else {
      Sentry.captureMessage(event.message || 'Unhandled error', 'error')
    }
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    if (reason instanceof Error) {
      Sentry.captureException(reason)
    } else {
      Sentry.captureMessage(String(reason ?? 'Unhandled rejection'), 'error')
    }
  })
}

export function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn || initialized) return

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_RELEASE || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    denyUrls: PROVIDER_DENY_URLS,
    beforeSend,
    beforeBreadcrumb,
  })

  registerGlobalHandlers()
  initialized = true
}

export function setMonitoringUser(userId) {
  if (!initialized) return
  if (userId) {
    Sentry.setUser({ id: userId })
  } else {
    Sentry.setUser(null)
  }
}

export function captureHandledError(error, context = {}) {
  if (!initialized) return null
  return Sentry.withScope((scope) => {
    scope.setContext('handled', scrubMapping(context))
    const requestId = context.requestId || context.request_id
    if (requestId) {
      scope.setTag('request_id', String(requestId))
    }
    const syncId = context.syncId || context.sync_id
    if (syncId) {
      scope.setTag('sync_id', String(syncId))
    }
    if (error instanceof Error) {
      return Sentry.captureException(error)
    }
    return Sentry.captureMessage(String(error ?? 'Handled error'), 'error')
  })
}

export function addBreadcrumb(breadcrumb) {
  if (!initialized) return
  Sentry.addBreadcrumb({
    ...breadcrumb,
    data: breadcrumb?.data ? scrubMapping(breadcrumb.data) : undefined,
  })
}

export function setMonitoringTag(key, value) {
  if (!initialized) return
  if (key && value != null) {
    Sentry.setTag(String(key), String(value))
  }
}

export { Sentry }
