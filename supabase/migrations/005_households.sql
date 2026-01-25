-- Household Sharing Migration
-- Creates tables for household management and updates existing tables for household-scoped data

-- ============================================================================
-- HOUSEHOLD TABLES
-- ============================================================================

-- Households: Core household entity
CREATE TABLE IF NOT EXISTS households (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    join_code TEXT NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Household Members: Junction table linking users to households
CREATE TABLE IF NOT EXISTS household_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(household_id, user_id),
    UNIQUE(user_id) -- user can only be in one household at a time
);

-- ============================================================================
-- MODIFY EXISTING TABLES
-- Add household_id to shared resources
-- ============================================================================

-- Add household_id to pantry_items
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'pantry_items' AND column_name = 'household_id'
    ) THEN
        ALTER TABLE pantry_items ADD COLUMN household_id UUID REFERENCES households(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Add household_id to receipts
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'receipts' AND column_name = 'household_id'
    ) THEN
        ALTER TABLE receipts ADD COLUMN household_id UUID REFERENCES households(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Add household_id to cooking_log
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'cooking_log' AND column_name = 'household_id'
    ) THEN
        ALTER TABLE cooking_log ADD COLUMN household_id UUID REFERENCES households(id) ON DELETE CASCADE;
    END IF;
END $$;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_households_join_code ON households(join_code);
CREATE INDEX IF NOT EXISTS idx_households_created_by ON households(created_by);

CREATE INDEX IF NOT EXISTS idx_household_members_household ON household_members(household_id);
CREATE INDEX IF NOT EXISTS idx_household_members_user ON household_members(user_id);

CREATE INDEX IF NOT EXISTS idx_pantry_items_household ON pantry_items(household_id);
CREATE INDEX IF NOT EXISTS idx_receipts_household ON receipts(household_id);
CREATE INDEX IF NOT EXISTS idx_cooking_log_household ON cooking_log(household_id);

-- ============================================================================
-- UPDATE UNIQUE CONSTRAINT ON PANTRY_ITEMS
-- Change from user-scoped to household-scoped uniqueness
-- ============================================================================

-- Drop old constraint if exists and create new one
DO $$
BEGIN
    -- Drop the old user-based constraint
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'unique_user_ingredient_variant' 
        AND table_name = 'pantry_items'
    ) THEN
        ALTER TABLE pantry_items DROP CONSTRAINT unique_user_ingredient_variant;
    END IF;
    
    -- Add new household-based constraint (if household_id is set)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'unique_household_ingredient_variant' 
        AND table_name = 'pantry_items'
    ) THEN
        -- Create a unique index that works with nullable household_id during transition
        CREATE UNIQUE INDEX IF NOT EXISTS unique_household_ingredient_variant 
        ON pantry_items(household_id, base_ingredient, variant, unit) 
        WHERE household_id IS NOT NULL;
    END IF;
END $$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on new tables
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;

-- Households RLS Policies
CREATE POLICY "Users can view households they belong to"
    ON households FOR SELECT
    TO authenticated
    USING (
        id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Authenticated users can create households"
    ON households FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "Owners can update their household"
    ON households FOR UPDATE
    TO authenticated
    USING (
        id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid() AND role = 'owner'
        )
    );

CREATE POLICY "Owners can delete their household"
    ON households FOR DELETE
    TO authenticated
    USING (
        id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid() AND role = 'owner'
        )
    );

-- Household Members RLS Policies
CREATE POLICY "Users can view members of their household"
    ON household_members FOR SELECT
    TO authenticated
    USING (
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can join households"
    ON household_members FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can leave households"
    ON household_members FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Owners can remove members"
    ON household_members FOR DELETE
    TO authenticated
    USING (
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid() AND role = 'owner'
        )
    );

-- ============================================================================
-- UPDATE EXISTING RLS POLICIES
-- Add household-based access to shared resources
-- ============================================================================

-- Drop existing pantry policies and create new ones
DROP POLICY IF EXISTS "Users can view own pantry items" ON pantry_items;
DROP POLICY IF EXISTS "Users can insert own pantry items" ON pantry_items;
DROP POLICY IF EXISTS "Users can update own pantry items" ON pantry_items;
DROP POLICY IF EXISTS "Users can delete own pantry items" ON pantry_items;

CREATE POLICY "Household members can view pantry items"
    ON pantry_items FOR SELECT
    TO authenticated
    USING (
        -- Legacy: user's own items without household
        (household_id IS NULL AND user_id = auth.uid())
        OR
        -- New: household-scoped items
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can insert pantry items"
    ON pantry_items FOR INSERT
    TO authenticated
    WITH CHECK (
        -- Legacy: user's own items without household
        (household_id IS NULL AND user_id = auth.uid())
        OR
        -- New: household-scoped items
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can update pantry items"
    ON pantry_items FOR UPDATE
    TO authenticated
    USING (
        -- Legacy: user's own items without household
        (household_id IS NULL AND user_id = auth.uid())
        OR
        -- New: household-scoped items
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can delete pantry items"
    ON pantry_items FOR DELETE
    TO authenticated
    USING (
        -- Legacy: user's own items without household
        (household_id IS NULL AND user_id = auth.uid())
        OR
        -- New: household-scoped items
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

-- Drop existing receipt policies and create new ones
DROP POLICY IF EXISTS "Users can view their own receipts" ON receipts;
DROP POLICY IF EXISTS "Users can insert their own receipts" ON receipts;

CREATE POLICY "Household members can view receipts"
    ON receipts FOR SELECT
    TO authenticated
    USING (
        -- Legacy: user's own receipts without household
        (household_id IS NULL AND user_id = auth.uid())
        OR
        -- New: household-scoped receipts
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can insert receipts"
    ON receipts FOR INSERT
    TO authenticated
    WITH CHECK (
        -- Legacy: user's own receipts without household
        (household_id IS NULL AND user_id = auth.uid())
        OR
        -- New: household-scoped receipts
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

-- Drop existing cooking_log policies and create new ones
DROP POLICY IF EXISTS "Users can view own cooking log" ON cooking_log;
DROP POLICY IF EXISTS "Users can insert own cooking log" ON cooking_log;
DROP POLICY IF EXISTS "Users can update own cooking log" ON cooking_log;
DROP POLICY IF EXISTS "Users can delete own cooking log" ON cooking_log;

CREATE POLICY "Household members can view cooking log"
    ON cooking_log FOR SELECT
    TO authenticated
    USING (
        -- Legacy: user's own log without household
        (household_id IS NULL AND user_id = auth.uid())
        OR
        -- New: household-scoped log
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can insert cooking log"
    ON cooking_log FOR INSERT
    TO authenticated
    WITH CHECK (
        -- Legacy: user's own log without household
        (household_id IS NULL AND user_id = auth.uid())
        OR
        -- New: household-scoped log
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can update cooking log"
    ON cooking_log FOR UPDATE
    TO authenticated
    USING (
        -- Legacy: user's own log without household
        (household_id IS NULL AND user_id = auth.uid())
        OR
        -- New: household-scoped log
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Household members can delete cooking log"
    ON cooking_log FOR DELETE
    TO authenticated
    USING (
        -- Legacy: user's own log without household
        (household_id IS NULL AND user_id = auth.uid())
        OR
        -- New: household-scoped log
        household_id IN (
            SELECT household_id FROM household_members 
            WHERE user_id = auth.uid()
        )
    );

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update updated_at timestamp on households
CREATE TRIGGER update_households_updated_at
    BEFORE UPDATE ON households
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to generate a random join code
CREATE OR REPLACE FUNCTION generate_join_code(length INTEGER DEFAULT 6)
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- Exclude confusing chars (0,O,1,I)
    result TEXT := '';
    i INTEGER;
BEGIN
    FOR i IN 1..length LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::INTEGER, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to get user's household ID
CREATE OR REPLACE FUNCTION get_user_household_id(p_user_id UUID)
RETURNS UUID AS $$
DECLARE
    v_household_id UUID;
BEGIN
    SELECT household_id INTO v_household_id
    FROM household_members
    WHERE user_id = p_user_id
    LIMIT 1;
    
    RETURN v_household_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- DATA MIGRATION
-- Create personal households for existing users with data
-- ============================================================================

-- This creates a household for each user who has pantry items or receipts
-- and assigns that data to their new household
DO $$
DECLARE
    user_record RECORD;
    new_household_id UUID;
    new_join_code TEXT;
BEGIN
    -- Find users with existing data but no household
    FOR user_record IN 
        SELECT DISTINCT user_id 
        FROM (
            SELECT user_id FROM pantry_items WHERE household_id IS NULL
            UNION
            SELECT user_id FROM receipts WHERE household_id IS NULL
            UNION
            SELECT user_id FROM cooking_log WHERE household_id IS NULL
        ) AS users_with_data
        WHERE user_id NOT IN (SELECT user_id FROM household_members)
    LOOP
        -- Generate unique join code
        LOOP
            new_join_code := generate_join_code();
            EXIT WHEN NOT EXISTS (SELECT 1 FROM households WHERE join_code = new_join_code);
        END LOOP;
        
        -- Create household for user
        INSERT INTO households (name, join_code, created_by)
        VALUES ('My Household', new_join_code, user_record.user_id)
        RETURNING id INTO new_household_id;
        
        -- Add user as owner
        INSERT INTO household_members (household_id, user_id, role)
        VALUES (new_household_id, user_record.user_id, 'owner');
        
        -- Migrate existing data to household
        UPDATE pantry_items SET household_id = new_household_id 
        WHERE user_id = user_record.user_id AND household_id IS NULL;
        
        UPDATE receipts SET household_id = new_household_id 
        WHERE user_id = user_record.user_id AND household_id IS NULL;
        
        UPDATE cooking_log SET household_id = new_household_id 
        WHERE user_id = user_record.user_id AND household_id IS NULL;
        
        RAISE NOTICE 'Created household % for user %', new_household_id, user_record.user_id;
    END LOOP;
END $$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE households IS 'Household groups that share pantry, receipts, and cooking data';
COMMENT ON COLUMN households.join_code IS 'Shareable code for joining the household';
COMMENT ON COLUMN households.created_by IS 'User who created the household';

COMMENT ON TABLE household_members IS 'Junction table linking users to their household';
COMMENT ON COLUMN household_members.role IS 'Member role: owner (can manage) or member (can view/edit shared data)';

COMMENT ON FUNCTION generate_join_code IS 'Generate a random alphanumeric join code for households';
COMMENT ON FUNCTION get_user_household_id IS 'Get the household ID for a given user';
