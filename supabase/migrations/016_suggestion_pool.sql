-- Suggestion pool: pre-generated recipe suggestions per household
-- Pool generation runs server-side; RLS for authenticated household members.

-- ============================================================================
-- HOUSEHOLD PREFERENCE: which meal types to include in pool generation
-- ============================================================================

ALTER TABLE households
ADD COLUMN IF NOT EXISTS suggestion_meal_slots JSONB NOT NULL DEFAULT '{"breakfast": true, "lunch": true, "dinner": true}'::jsonb;

COMMENT ON COLUMN households.suggestion_meal_slots IS 'Which meal types (breakfast/lunch/dinner) to use for suggestion pool generation; at least one should be true';

-- ============================================================================
-- POOL GENERATION RUNS (mutex + audit)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pool_generation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    trigger_reason TEXT NOT NULL CHECK (
        trigger_reason IN ('onboarding', 'receipt_scan', 'manual_refresh', 'low_watermark')
    ),
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (
        status IN ('in_progress', 'completed', 'partial', 'failed')
    ),
    meal_types_requested JSONB NOT NULL DEFAULT '[]'::jsonb,
    suggestions_generated INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pool_generation_household ON pool_generation(household_id);
CREATE INDEX IF NOT EXISTS idx_pool_generation_status ON pool_generation(household_id, status);

-- ============================================================================
-- SUGGESTION POOL ROWS
-- ============================================================================

CREATE TABLE IF NOT EXISTS suggestion_pool (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner')),
    recipe_id TEXT NOT NULL,
    recipe_name TEXT NOT NULL,
    recipe_image TEXT,
    recipe_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    match_score DECIMAL(5, 4),
    status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'swiped')),
    generation_id UUID REFERENCES pool_generation(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT suggestion_pool_household_recipe_unique UNIQUE (household_id, recipe_id)
);

CREATE INDEX IF NOT EXISTS idx_suggestion_pool_household_meal ON suggestion_pool(household_id, meal_type);
CREATE INDEX IF NOT EXISTS idx_suggestion_pool_household_status ON suggestion_pool(household_id, status);
CREATE INDEX IF NOT EXISTS idx_suggestion_pool_generation ON suggestion_pool(generation_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE pool_generation ENABLE ROW LEVEL SECURITY;
ALTER TABLE suggestion_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members can view pool_generation"
    ON pool_generation FOR SELECT
    TO authenticated
    USING (
        household_id IN (
            SELECT household_id FROM household_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can insert pool_generation"
    ON pool_generation FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND household_id IN (
            SELECT household_id FROM household_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can update pool_generation"
    ON pool_generation FOR UPDATE
    TO authenticated
    USING (
        household_id IN (
            SELECT household_id FROM household_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can view suggestion_pool"
    ON suggestion_pool FOR SELECT
    TO authenticated
    USING (
        household_id IN (
            SELECT household_id FROM household_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can insert suggestion_pool"
    ON suggestion_pool FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND household_id IN (
            SELECT household_id FROM household_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can update suggestion_pool"
    ON suggestion_pool FOR UPDATE
    TO authenticated
    USING (
        household_id IN (
            SELECT household_id FROM household_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can delete suggestion_pool"
    ON suggestion_pool FOR DELETE
    TO authenticated
    USING (
        household_id IN (
            SELECT household_id FROM household_members
            WHERE user_id = auth.uid()
        )
    );
