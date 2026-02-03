-- Meal Planning Migration
-- Creates tables for meal planning wizard, meal plans, and shopping lists

-- ============================================================================
-- MEAL PLAN TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS meal_plan (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    meal_date DATE NOT NULL,
    meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner')),
    recipe_id TEXT, -- Spoonacular recipe ID (nullable for staple meals)
    recipe_name TEXT NOT NULL,
    recipe_image TEXT,
    servings INTEGER NOT NULL,
    is_leftover BOOLEAN DEFAULT FALSE,
    leftover_from_id UUID REFERENCES meal_plan(id) ON DELETE SET NULL,
    manually_marked_leftover BOOLEAN DEFAULT FALSE,
    ingredients_reserved JSONB, -- Snapshot of ingredients used
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (household_id, meal_date, meal_type)
);

CREATE INDEX idx_meal_plan_household ON meal_plan(household_id);
CREATE INDEX idx_meal_plan_date_range ON meal_plan(household_id, meal_date);

-- ============================================================================
-- SHOPPING LIST TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS shopping_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    ingredient_name TEXT NOT NULL,
    quantity DECIMAL(10,2),
    unit TEXT,
    needed_for_recipe TEXT, -- Recipe name that needs this
    is_purchased BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    purchased_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_shopping_list_household ON shopping_list(household_id);
CREATE INDEX idx_shopping_list_purchased ON shopping_list(household_id, is_purchased);

-- ============================================================================
-- WIZARD SESSION TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS meal_plan_wizard_session (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_pantry JSONB NOT NULL, -- Virtual pantry state
    meal_slots JSONB NOT NULL, -- Configuration for which meals to plan
    current_slot INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '2 hours'
);

CREATE INDEX idx_wizard_session_household ON meal_plan_wizard_session(household_id);
CREATE INDEX idx_wizard_session_expires ON meal_plan_wizard_session(expires_at);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on new tables
ALTER TABLE meal_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plan_wizard_session ENABLE ROW LEVEL SECURITY;

-- Meal Plan RLS Policies
CREATE POLICY "Household members can view meal plans"
    ON meal_plan FOR SELECT
    TO authenticated
    USING (
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can insert meal plans"
    ON meal_plan FOR INSERT
    TO authenticated
    WITH CHECK (
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
        AND user_id = auth.uid()
    );

CREATE POLICY "Household members can update meal plans"
    ON meal_plan FOR UPDATE
    TO authenticated
    USING (
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can delete meal plans"
    ON meal_plan FOR DELETE
    TO authenticated
    USING (
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

-- Shopping List RLS Policies
CREATE POLICY "Household members can view shopping list"
    ON shopping_list FOR SELECT
    TO authenticated
    USING (
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can insert shopping list items"
    ON shopping_list FOR INSERT
    TO authenticated
    WITH CHECK (
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can update shopping list items"
    ON shopping_list FOR UPDATE
    TO authenticated
    USING (
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can delete shopping list items"
    ON shopping_list FOR DELETE
    TO authenticated
    USING (
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

-- Wizard Session RLS Policies
CREATE POLICY "Users can view their own wizard sessions"
    ON meal_plan_wizard_session FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        AND household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create wizard sessions"
    ON meal_plan_wizard_session FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update their wizard sessions"
    ON meal_plan_wizard_session FOR UPDATE
    TO authenticated
    USING (
        user_id = auth.uid()
        AND household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete their wizard sessions"
    ON meal_plan_wizard_session FOR DELETE
    TO authenticated
    USING (
        user_id = auth.uid()
        AND household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

-- ============================================================================
-- CLEANUP FUNCTION FOR EXPIRED SESSIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_wizard_sessions()
RETURNS void AS $$
BEGIN
    DELETE FROM meal_plan_wizard_session
    WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE meal_plan IS 'Weekly meal plans for households';
COMMENT ON COLUMN meal_plan.ingredients_reserved IS 'Snapshot of ingredients used when meal was planned';
COMMENT ON COLUMN meal_plan.is_leftover IS 'True if this meal is leftovers from another meal';
COMMENT ON COLUMN meal_plan.leftover_from_id IS 'Reference to the meal this is leftover from';

COMMENT ON TABLE shopping_list IS 'Auto-generated shopping list from meal plan';
COMMENT ON COLUMN shopping_list.needed_for_recipe IS 'Recipe name that requires this ingredient';

COMMENT ON TABLE meal_plan_wizard_session IS 'Temporary session storage for meal planning wizard';
COMMENT ON COLUMN meal_plan_wizard_session.session_pantry IS 'Virtual pantry state during wizard session';
COMMENT ON COLUMN meal_plan_wizard_session.meal_slots IS 'Configuration for which meals to plan (breakfast, lunch, dinner)';
