-- Repeatable funnel events (recipe opens, cook logs) for capture-rate measurement.
-- Idempotent: safe if a timestamped copy already applied remotely.

ALTER TABLE funnel_events DROP CONSTRAINT IF EXISTS funnel_events_event_check;

ALTER TABLE funnel_events ADD CONSTRAINT funnel_events_event_check CHECK (
  event IN (
    'funnel_sign_in',
    'funnel_store_connected',
    'funnel_receipts_synced',
    'funnel_staples_confirmed',
    'funnel_first_suggestion_viewed',
    'funnel_first_cook_logged',
    'recipe_detail_opened',
    'cook_logged'
  )
);

CREATE TABLE IF NOT EXISTS funnel_repeatable_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (
    event IN ('recipe_detail_opened', 'cook_logged')
  ),
  session_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE funnel_repeatable_events IS 'Repeatable funnel events (no idempotency per user)';

CREATE INDEX IF NOT EXISTS idx_funnel_repeatable_events_user ON funnel_repeatable_events (user_id);
CREATE INDEX IF NOT EXISTS idx_funnel_repeatable_events_event ON funnel_repeatable_events (event);

ALTER TABLE funnel_repeatable_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own funnel_repeatable_events" ON funnel_repeatable_events;
CREATE POLICY "Users can view own funnel_repeatable_events"
  ON funnel_repeatable_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own funnel_repeatable_events" ON funnel_repeatable_events;
CREATE POLICY "Users can insert own funnel_repeatable_events"
  ON funnel_repeatable_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages funnel_repeatable_events" ON funnel_repeatable_events;
CREATE POLICY "Service role manages funnel_repeatable_events"
  ON funnel_repeatable_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT ON public.funnel_repeatable_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.funnel_repeatable_events TO service_role;
REVOKE ALL ON public.funnel_repeatable_events FROM anon;
