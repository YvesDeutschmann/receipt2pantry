-- ==============================================================================
-- Partial unique index for pantry_items when household_id IS NULL
-- ==============================================================================
-- The existing unique_household_ingredient_variant index (005) only applies
-- WHERE household_id IS NOT NULL. Users without a household (legacy mode) have
-- household_id NULL; uniqueness is per-user via (user_id, base_ingredient, variant, unit).
-- This index enables ON CONFLICT for upserts in that case and prevents duplicates.
-- ==============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS unique_user_ingredient_variant_null_household
  ON pantry_items (user_id, base_ingredient, variant, unit)
  WHERE household_id IS NULL;
