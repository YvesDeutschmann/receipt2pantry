-- Add rejected_recipes tracking to wizard session
-- This allows the system to track which recipes have been declined
-- and avoid showing them again for the same meal slot

ALTER TABLE meal_plan_wizard_session 
ADD COLUMN IF NOT EXISTS rejected_recipes JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN meal_plan_wizard_session.rejected_recipes IS 'Array of recipe IDs that have been rejected during this wizard session';
