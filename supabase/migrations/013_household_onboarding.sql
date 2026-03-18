-- Household Onboarding Migration
-- Adds size and dietary_restrictions columns to households for onboarding flow

-- ============================================================================
-- ADD COLUMNS TO HOUSEHOLDS
-- ============================================================================

ALTER TABLE households
ADD COLUMN IF NOT EXISTS size INTEGER NOT NULL DEFAULT 2 CHECK (size BETWEEN 1 AND 99),
ADD COLUMN IF NOT EXISTS dietary_restrictions TEXT[] NOT NULL DEFAULT '{}';

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN households.size IS 'Number of people in household (1-99), used for recipe yield calculation';
COMMENT ON COLUMN households.dietary_restrictions IS 'Hard dietary restrictions: allergies and intolerances (tree_nuts, peanuts, shellfish, etc.)';
