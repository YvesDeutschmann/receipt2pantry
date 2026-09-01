-- Add diagnostic phases for Costco token discovery runs (Run A/B auto-capture)

ALTER TABLE sync_events DROP CONSTRAINT IF EXISTS sync_events_phase_check;

ALTER TABLE sync_events ADD CONSTRAINT sync_events_phase_check CHECK (
  phase IN (
    'session_begin',
    'session_busy',
    'session_preempted',
    'webview_opened',
    'webview_open_failed',
    'auth_complete',
    'tokens_received',
    'receipts_received',
    'close_requested',
    'close_confirmed',
    'close_failed',
    'close_skipped_not_owner',
    'close_unconfirmed',
    'login_timeout',
    'silent_timeout',
    'closed_early',
    'loop_detected',
    'ingest_started',
    'ingest_failed',
    'sync_succeeded',
    'sync_failed',
    'sync_skipped',
    'needs_reconnect',
    'diagnostic_checkpoint',
    'token_exchange'
  )
);
