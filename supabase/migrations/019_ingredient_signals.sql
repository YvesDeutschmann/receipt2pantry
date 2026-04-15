-- Phase 3: aspirational buyer / recipe dismiss signals (per user, per normalized item name)

CREATE TABLE IF NOT EXISTS ingredient_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  dismiss_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_user_item_signal UNIQUE (user_id, item_name)
);

COMMENT ON TABLE ingredient_signals IS 'Soft counters for recipe dismissals per pantry item name; not stored on pantry_items';

CREATE INDEX IF NOT EXISTS idx_ingredient_signals_user ON ingredient_signals (user_id);

ALTER TABLE ingredient_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ingredient_signals"
  ON ingredient_signals FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ingredient_signals"
  ON ingredient_signals FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ingredient_signals"
  ON ingredient_signals FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role manages ingredient_signals"
  ON ingredient_signals FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS update_ingredient_signals_updated_at ON ingredient_signals;
CREATE TRIGGER update_ingredient_signals_updated_at
  BEFORE UPDATE ON ingredient_signals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
