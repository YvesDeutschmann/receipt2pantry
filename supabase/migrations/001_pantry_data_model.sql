-- GrocerySync Pantry Data Model Migration
-- Creates tables for product normalization, pantry management, and cooking logs

-- ============================================================================
-- TABLES
-- ============================================================================

-- Product Mappings: Cache for normalized product names
CREATE TABLE IF NOT EXISTS product_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_name TEXT NOT NULL UNIQUE,
    base_ingredient TEXT NOT NULL,
    variant TEXT,
    normalized_name TEXT NOT NULL,
    product_type TEXT,
    category TEXT,
    tags TEXT[],
    quantity_info JSONB,
    confidence_score DECIMAL(3,2),
    source TEXT,
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pantry Items: User's current ingredient inventory
CREATE TABLE IF NOT EXISTS pantry_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    base_ingredient TEXT NOT NULL,
    variant TEXT,
    normalized_name TEXT NOT NULL,
    product_type TEXT,
    category TEXT,
    quantity DECIMAL(10,2) DEFAULT 1,
    unit TEXT,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_receipt_id UUID REFERENCES receipts(id) ON DELETE SET NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    tags TEXT[],
    metadata JSONB,
    CONSTRAINT unique_user_ingredient_variant UNIQUE(user_id, base_ingredient, variant, unit)
);

-- Cooking Log: Track what recipes were cooked
CREATE TABLE IF NOT EXISTS cooking_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    recipe_id TEXT,
    recipe_name TEXT NOT NULL,
    servings INTEGER NOT NULL,
    cooked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ingredients_used JSONB,
    metadata JSONB
);

-- Ingredient Substitutions: Unified table for variants and ingredient swaps
CREATE TABLE IF NOT EXISTS ingredient_substitutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient TEXT NOT NULL,
    substitute TEXT NOT NULL,
    substitution_type TEXT NOT NULL CHECK (substitution_type IN ('variant', 'ingredient')),
    ratio DECIMAL(3,2) DEFAULT 1.0,
    category TEXT,
    confidence DECIMAL(3,2),
    acceptable BOOLEAN DEFAULT TRUE,
    notes TEXT,
    source TEXT,
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_ingredient_substitute UNIQUE(ingredient, substitute)
);

-- Receipt Items: Update to ensure all required columns exist
-- Note: This is idempotent - only adds columns if they don't exist
DO $$ 
BEGIN
    -- Add quantity_info if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'receipt_items' AND column_name = 'quantity_info'
    ) THEN
        ALTER TABLE receipt_items ADD COLUMN quantity_info JSONB;
    END IF;

    -- Add unit_price if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'receipt_items' AND column_name = 'unit_price'
    ) THEN
        ALTER TABLE receipt_items ADD COLUMN unit_price DECIMAL(10,2);
    END IF;
END $$;

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Product Mappings indexes
CREATE INDEX IF NOT EXISTS idx_product_mappings_raw_name ON product_mappings(raw_name);
CREATE INDEX IF NOT EXISTS idx_product_mappings_normalized_name ON product_mappings(normalized_name);
CREATE INDEX IF NOT EXISTS idx_product_mappings_base_ingredient ON product_mappings(base_ingredient);

-- Pantry Items indexes
CREATE INDEX IF NOT EXISTS idx_pantry_items_user_id ON pantry_items(user_id);
CREATE INDEX IF NOT EXISTS idx_pantry_items_base_ingredient ON pantry_items(base_ingredient);
CREATE INDEX IF NOT EXISTS idx_pantry_items_normalized_name ON pantry_items(normalized_name);
CREATE INDEX IF NOT EXISTS idx_pantry_items_user_base ON pantry_items(user_id, base_ingredient);

-- Receipt Items indexes (if not already present)
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt_id ON receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_user_id ON receipt_items(user_id);

-- Cooking Log indexes
CREATE INDEX IF NOT EXISTS idx_cooking_log_user_id ON cooking_log(user_id);
CREATE INDEX IF NOT EXISTS idx_cooking_log_cooked_at ON cooking_log(cooked_at DESC);

-- Ingredient Substitutions indexes
CREATE INDEX IF NOT EXISTS idx_substitutions_ingredient ON ingredient_substitutions(ingredient);
CREATE INDEX IF NOT EXISTS idx_substitutions_type ON ingredient_substitutions(substitution_type);
CREATE INDEX IF NOT EXISTS idx_substitutions_ingredient_type ON ingredient_substitutions(ingredient, substitution_type);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all new tables
ALTER TABLE product_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pantry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cooking_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_substitutions ENABLE ROW LEVEL SECURITY;

-- Product Mappings: Read-only for all authenticated users
CREATE POLICY "Anyone can read product mappings"
    ON product_mappings FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Only admins can insert product mappings"
    ON product_mappings FOR INSERT
    TO authenticated
    WITH CHECK (false); -- Will be managed by service role

CREATE POLICY "Only admins can update product mappings"
    ON product_mappings FOR UPDATE
    TO authenticated
    USING (false); -- Will be managed by service role

-- Pantry Items: Users can only access their own pantry
CREATE POLICY "Users can view own pantry items"
    ON pantry_items FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pantry items"
    ON pantry_items FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pantry items"
    ON pantry_items FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own pantry items"
    ON pantry_items FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- Cooking Log: Users can only access their own cooking history
CREATE POLICY "Users can view own cooking log"
    ON cooking_log FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own cooking log"
    ON cooking_log FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cooking log"
    ON cooking_log FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own cooking log"
    ON cooking_log FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- Ingredient Substitutions: Read-only for all authenticated users
CREATE POLICY "Anyone can read substitutions"
    ON ingredient_substitutions FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Only admins can insert substitutions"
    ON ingredient_substitutions FOR INSERT
    TO authenticated
    WITH CHECK (false); -- Will be managed by service role

CREATE POLICY "Only admins can update substitutions"
    ON ingredient_substitutions FOR UPDATE
    TO authenticated
    USING (false); -- Will be managed by service role

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update updated_at timestamp on product_mappings
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_product_mappings_updated_at
    BEFORE UPDATE ON product_mappings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE product_mappings IS 'Cache for normalized product names from raw receipt data';
COMMENT ON TABLE pantry_items IS 'User ingredient inventory with variant tracking';
COMMENT ON TABLE cooking_log IS 'History of cooked recipes and ingredients consumed';
COMMENT ON TABLE ingredient_substitutions IS 'Unified table for ingredient variants and substitutions';

COMMENT ON COLUMN ingredient_substitutions.substitution_type IS 'Type: variant (same base, different variant) or ingredient (different ingredients)';
COMMENT ON COLUMN ingredient_substitutions.acceptable IS 'Whether this substitution is recommended (false for non-ideal swaps like salted butter in baking)';
COMMENT ON COLUMN pantry_items.variant IS 'Ingredient variant (e.g., salted, unsalted, whole, 2%)';
COMMENT ON COLUMN product_mappings.quantity_info IS 'Extracted quantity data: {amount: number, unit: string}';


