-- =============================================================================
-- COMBINED MIGRATIONS FOR RECEIPT2PANTRY
-- Run this entire script in the Supabase SQL Editor
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 001: INITIAL SCHEMA
-- ==============================================================================

-- GROCERY ACCOUNTS TABLE
CREATE TABLE IF NOT EXISTS grocery_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    provider TEXT NOT NULL,
    username TEXT NOT NULL,
    vault_key_id TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    mfa_required BOOLEAN NOT NULL DEFAULT false,
    last_successful_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_grocery_accounts_user_provider ON grocery_accounts(user_id, provider);

-- RECEIPTS TABLE
CREATE TABLE IF NOT EXISTS receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    grocery_account_id UUID REFERENCES grocery_accounts(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    order_id TEXT NOT NULL,
    order_date DATE NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    num_items INTEGER NOT NULL,
    raw_data JSONB NOT NULL,
    fetched_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(order_id)
);

CREATE INDEX IF NOT EXISTS idx_receipts_user_date ON receipts(user_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_order_id ON receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_receipts_grocery_account ON receipts(grocery_account_id);
CREATE INDEX IF NOT EXISTS idx_receipts_raw_data ON receipts USING GIN (raw_data);

-- RECEIPT ITEMS TABLE
CREATE TABLE IF NOT EXISTS receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    regular_price DECIMAL(10, 2),
    savings DECIMAL(10, 2),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_name ON receipt_items USING GIN (to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_receipt_items_category ON receipt_items(category);

-- AUTOMATION LOGS TABLE
CREATE TABLE IF NOT EXISTS automation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    grocery_account_id UUID REFERENCES grocery_accounts(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'mfa_required', 'partial')),
    error_message TEXT,
    receipts_fetched INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_user_started ON automation_logs(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_logs_status ON automation_logs(status);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for grocery_accounts
DROP TRIGGER IF EXISTS update_grocery_accounts_updated_at ON grocery_accounts;
CREATE TRIGGER update_grocery_accounts_updated_at
BEFORE UPDATE ON grocery_accounts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ==============================================================================
-- 002: LOGIN SESSIONS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS login_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    provider TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending_mfa', 'awaiting_code', 'completed', 'failed', 'expired')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_login_sessions_expires ON login_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_login_sessions_user ON login_sessions(user_id);

-- ==============================================================================
-- 003: PANTRY DATA MODEL
-- ==============================================================================

-- Product Mappings
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
    source TEXT DEFAULT 'rule_based',
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_mappings_raw_name ON product_mappings(raw_name);
CREATE INDEX IF NOT EXISTS idx_product_mappings_normalized_name ON product_mappings(normalized_name);
CREATE INDEX IF NOT EXISTS idx_product_mappings_base_ingredient ON product_mappings(base_ingredient);

-- Pantry Items
CREATE TABLE IF NOT EXISTS pantry_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
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
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_pantry_items_user_id ON pantry_items(user_id);
CREATE INDEX IF NOT EXISTS idx_pantry_items_base_ingredient ON pantry_items(base_ingredient);
CREATE INDEX IF NOT EXISTS idx_pantry_items_normalized_name ON pantry_items(normalized_name);
CREATE INDEX IF NOT EXISTS idx_pantry_items_user_base ON pantry_items(user_id, base_ingredient);

-- Cooking Log
CREATE TABLE IF NOT EXISTS cooking_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    recipe_id TEXT,
    recipe_name TEXT NOT NULL,
    servings INTEGER NOT NULL,
    cooked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ingredients_used JSONB,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_cooking_log_user_id ON cooking_log(user_id);
CREATE INDEX IF NOT EXISTS idx_cooking_log_cooked_at ON cooking_log(cooked_at DESC);

-- Ingredient Substitutions
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

CREATE INDEX IF NOT EXISTS idx_substitutions_ingredient ON ingredient_substitutions(ingredient);
CREATE INDEX IF NOT EXISTS idx_substitutions_type ON ingredient_substitutions(substitution_type);
CREATE INDEX IF NOT EXISTS idx_substitutions_ingredient_type ON ingredient_substitutions(ingredient, substitution_type);

-- Add columns to receipt_items if needed
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'receipt_items' AND column_name = 'quantity_info'
    ) THEN
        ALTER TABLE receipt_items ADD COLUMN quantity_info JSONB;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'receipt_items' AND column_name = 'unit_price'
    ) THEN
        ALTER TABLE receipt_items ADD COLUMN unit_price DECIMAL(10,2);
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'receipt_items' AND column_name = 'unit'
    ) THEN
        ALTER TABLE receipt_items ADD COLUMN unit TEXT DEFAULT 'count';
    END IF;
END $$;

-- Trigger for product_mappings
DROP TRIGGER IF EXISTS update_product_mappings_updated_at ON product_mappings;
CREATE TRIGGER update_product_mappings_updated_at
    BEFORE UPDATE ON product_mappings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ==============================================================================
-- 004: AI PROCESSING LOG
-- ==============================================================================

CREATE TABLE IF NOT EXISTS ai_processing_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    estimated_cost DECIMAL(10,6),
    duration_ms INTEGER,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    error_message TEXT,
    user_id UUID,
    receipt_id UUID REFERENCES receipts(id) ON DELETE SET NULL,
    items_processed INTEGER,
    request_metadata JSONB,
    response_metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_log_created_at ON ai_processing_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_log_operation ON ai_processing_log(operation);
CREATE INDEX IF NOT EXISTS idx_ai_log_user_id ON ai_processing_log(user_id);

-- ==============================================================================
-- 005: HOUSEHOLDS
-- ==============================================================================

-- Households table
CREATE TABLE IF NOT EXISTS households (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    join_code TEXT NOT NULL UNIQUE,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_households_join_code ON households(join_code);
CREATE INDEX IF NOT EXISTS idx_households_created_by ON households(created_by);

-- Household Members
CREATE TABLE IF NOT EXISTS household_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(household_id, user_id),
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_household_members_household ON household_members(household_id);
CREATE INDEX IF NOT EXISTS idx_household_members_user ON household_members(user_id);

-- Add household_id to existing tables
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'pantry_items' AND column_name = 'household_id'
    ) THEN
        ALTER TABLE pantry_items ADD COLUMN household_id UUID REFERENCES households(id) ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'receipts' AND column_name = 'household_id'
    ) THEN
        ALTER TABLE receipts ADD COLUMN household_id UUID REFERENCES households(id) ON DELETE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'cooking_log' AND column_name = 'household_id'
    ) THEN
        ALTER TABLE cooking_log ADD COLUMN household_id UUID REFERENCES households(id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pantry_items_household ON pantry_items(household_id);
CREATE INDEX IF NOT EXISTS idx_receipts_household ON receipts(household_id);
CREATE INDEX IF NOT EXISTS idx_cooking_log_household ON cooking_log(household_id);

-- Trigger for households
DROP TRIGGER IF EXISTS update_households_updated_at ON households;
CREATE TRIGGER update_households_updated_at
    BEFORE UPDATE ON households
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Helper function to generate join codes
CREATE OR REPLACE FUNCTION generate_join_code(length INTEGER DEFAULT 6)
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    result TEXT := '';
    i INTEGER;
BEGIN
    FOR i IN 1..length LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::INTEGER, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Helper function to get user's household ID
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

-- ==============================================================================
-- DONE! Your database schema is now ready.
-- ==============================================================================
