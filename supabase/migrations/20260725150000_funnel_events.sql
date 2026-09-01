-- Activation funnel telemetry (opaque user id + event metadata only; no PII columns)

CREATE TABLE IF NOT EXISTS funnel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (
    event IN (
      'funnel_sign_in',
      'funnel_store_connected',
      'funnel_receipts_synced',
      'funnel_staples_confirmed',
      'funnel_first_suggestion_viewed',
      'funnel_first_cook_logged'
    )
  ),
  session_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_user_funnel_event UNIQUE (user_id, event)
);

COMMENT ON TABLE funnel_events IS 'Client activation funnel events; idempotent per user+event';

CREATE INDEX IF NOT EXISTS idx_funnel_events_user ON funnel_events (user_id);
CREATE INDEX IF NOT EXISTS idx_funnel_events_event ON funnel_events (event);

ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own funnel_events"
  ON funnel_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own funnel_events"
  ON funnel_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role manages funnel_events"
  ON funnel_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Aggregate funnel counts (no user identifiers exposed)
CREATE OR REPLACE VIEW funnel_conversion AS
SELECT
  COUNT(*) FILTER (WHERE event = 'funnel_sign_in') AS sign_in,
  COUNT(*) FILTER (WHERE event = 'funnel_store_connected') AS store_connected,
  COUNT(*) FILTER (WHERE event = 'funnel_receipts_synced') AS receipts_synced,
  COUNT(*) FILTER (WHERE event = 'funnel_staples_confirmed') AS staples_confirmed,
  COUNT(*) FILTER (WHERE event = 'funnel_first_suggestion_viewed') AS first_suggestion_viewed,
  COUNT(*) FILTER (WHERE event = 'funnel_first_cook_logged') AS first_cook_logged
FROM funnel_events;

COMMENT ON VIEW funnel_conversion IS 'Activation funnel step counts (aggregate only, no PII)';
