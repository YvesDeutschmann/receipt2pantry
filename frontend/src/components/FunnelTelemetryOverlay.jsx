import { useCallback, useEffect, useState } from 'react'
import { dump, subscribe } from '../services/funnelTelemetry'
import {
  exportDumpToDevLog,
  isFunnelTelemetryExportEnabled,
  summarizeDump,
  FUNNEL_TELEMETRY_EXPORT_CHANGED,
} from '../services/funnelTelemetryExport'

/**
 * On-device funnel dump. Avoids attaching Chrome DevTools during WebView login.
 */
export default function FunnelTelemetryOverlay() {
  const [enabled, setEnabled] = useState(() => isFunnelTelemetryExportEnabled())
  const [expanded, setExpanded] = useState(false)
  const [events, setEvents] = useState([])
  const [shipped, setShipped] = useState(false)

  const refresh = useCallback(async () => {
    const next = await dump()
    setEvents(Array.isArray(next) ? next : [])
  }, [])

  useEffect(() => {
    const syncEnabled = () => setEnabled(isFunnelTelemetryExportEnabled())
    syncEnabled()
    window.addEventListener(FUNNEL_TELEMETRY_EXPORT_CHANGED, syncEnabled)
    return () => {
      window.removeEventListener(FUNNEL_TELEMETRY_EXPORT_CHANGED, syncEnabled)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    void refresh()
    return subscribe(() => {
      void refresh()
    })
  }, [enabled, refresh])

  if (!enabled) return null

  const summary = summarizeDump(events)
  const pill = summary.receiptsSynced
    ? `Receipts synced (${summary.matchCount ?? 0})`
    : `Funnel ${summary.count}/6`

  return (
    <div
      data-testid="funnel-telemetry-overlay"
      className="fixed right-3 z-[80] max-w-[min(100%-1.5rem,20rem)] rounded-mise-md border border-terra/40 bg-forest/95 text-cream shadow-lg"
      style={{ bottom: 'calc(var(--safe-area-inset-bottom) + 4.5rem)' }}
    >
      <button
        type="button"
        className="w-full px-3 py-2 text-left text-xs font-medium"
        aria-label={expanded ? 'collapse funnel dump' : 'expand funnel dump'}
        onClick={() => setExpanded((open) => !open)}
      >
        {pill}
      </button>
      {expanded ? (
        <div className="border-t border-cream/10 px-3 pb-3 pt-2 space-y-2">
          <ol className="text-[11px] leading-snug text-sage-light space-y-0.5">
            {summary.events.length === 0 ? (
              <li>No events yet</li>
            ) : (
              summary.events.map((name, index) => (
                <li key={`${name}-${index}`}>{name.replace('funnel_', '')}</li>
              ))
            )}
          </ol>
          {summary.receiptsSynced ? (
            <p className="text-[11px] text-terra-light">
              Receipts synced · matchCount: {summary.matchCount}
            </p>
          ) : (
            <p className="text-[11px] text-sage-light">Waiting for receipt fetch…</p>
          )}
          {summary.coldStartDeltaMs != null ? (
            <p className="text-[11px] text-sage-light">
              Δt first suggestion: {summary.coldStartDeltaMs}ms
              {summary.coldStartDeltaMs < 180000 ? ' (under 3 min)' : ' (over 3 min)'}
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost text-xs min-h-0 py-1.5 px-2"
            onClick={async () => {
              await exportDumpToDevLog('manual')
              setShipped(true)
            }}
          >
            Send dump to backend
          </button>
          {shipped ? (
            <p className="text-[11px] text-sage-light" role="status">
              Sent to /api/dev/log
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
