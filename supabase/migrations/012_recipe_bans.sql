-- Recipe Bans and Accepted Recipes Tracking
-- Adds support for banning recipes for 6 months and tracking accepted recipes

-- ============================================================================
-- RECIPE BANS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS recipe_bans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    recipe_id TEXT NOT NULL,
    recipe_name TEXT,
    banned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '6 months',
    UNIQUE (user_id, recipe_id)
);

CREATE INDEX idx_recipe_bans_user ON recipe_bans(user_id);
CREATE INDEX idx_recipe_bans_expires ON recipe_bans(expires_at);
CREATE INDEX idx_recipe_bans_user_recipe ON recipe_bans(user_id, recipe_id);

-- ============================================================================
-- ADD ACCEPTED RECIPES TO WIZARD SESSION
-- ============================================================================

ALTER TABLE meal_plan_wizard_session 
ADD COLUMN IF NOT EXISTS accepted_recipes JSONB DEFAULT '[]'::jsonb;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE recipe_bans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own recipe bans"
    ON recipe_bans FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own recipe bans"
    ON recipe_bans FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own recipe bans"
    ON recipe_bans FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE recipe_bans IS 'Recipes that users have permanently banned for 6 months';
COMMENT ON COLUMN recipe_bans.expires_at IS 'When the ban expires and recipe can be suggested again';
COMMENT ON COLUMN meal_plan_wizard_session.accepted_recipes IS 'Recipe IDs accepted during this wizard session (excluded from future suggestions)';
