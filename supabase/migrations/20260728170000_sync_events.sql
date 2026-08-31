-- Provider sync lifecycle telemetry (append-only; opaque user id + phase metadata only)

CREATE TABLE IF NOT EXISTS sync_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('costco', 'safeway')),
  phase TEXT NOT NULL CHECK (
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
      'needs_reconnect'
    )
  ),
  sync_id UUID NOT NULL,
  session_id UUID,
  mode TEXT CHECK (mode IS NULL OR mode IN ('login', 'silent')),
  reason TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sync_events IS 'Client provider sync lifecycle phases; append-only per sync attempt';

CREATE INDEX IF NOT EXISTS idx_sync_events_user_occurred ON sync_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_events_provider_phase ON sync_events (provider, phase);
CREATE INDEX IF NOT EXISTS idx_sync_events_sync_id ON sync_events (sync_id);

ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sync_events"
  ON sync_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sync_events"
  ON sync_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role manages sync_events"
  ON sync_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- One row per sync attempt with terminal phase and duration
CREATE OR REPLACE VIEW sync_attempt_outcomes AS
WITH ranked AS (
  SELECT
    sync_id,
    user_id,
    provider,
    mode,
    phase,
    reason,
    occurred_at,
    ROW_NUMBER() OVER (PARTITION BY sync_id ORDER BY occurred_at DESC) AS rn,
    MIN(occurred_at) OVER (PARTITION BY sync_id) AS started_at,
    MAX(occurred_at) OVER (PARTITION BY sync_id) AS ended_at
  FROM sync_events
)
SELECT
  sync_id,
  user_id,
  provider,
  mode,
  phase AS terminal_phase,
  reason AS terminal_reason,
  started_at,
  ended_at,
  EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000 AS duration_ms
FROM ranked
WHERE rn = 1;

COMMENT ON VIEW sync_attempt_outcomes IS 'Latest phase per sync_id with attempt duration (no PII beyond user_id)';
