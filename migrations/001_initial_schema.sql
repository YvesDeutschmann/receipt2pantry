-- Initial database schema for Meald
-- This migration creates all core tables with proper relationships and indexes

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- GROCERY ACCOUNTS TABLE
-- Links users to grocery providers with credential references
-- ==============================================================================
CREATE TABLE grocery_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    username TEXT NOT NULL,
    vault_key_id TEXT NOT NULL, -- Reference to AWS Secrets Manager secret
    is_active BOOLEAN NOT NULL DEFAULT true,
    mfa_required BOOLEAN NOT NULL DEFAULT false,
    last_successful_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Ensure one account per user per provider
    UNIQUE(user_id, provider)
);

-- Index for user lookups
CREATE INDEX idx_grocery_accounts_user_provider 
ON grocery_accounts(user_id, provider);

-- ==============================================================================
-- RECEIPTS TABLE
-- Stores parsed receipt metadata and raw data
-- ==============================================================================
CREATE TABLE receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    grocery_account_id UUID REFERENCES grocery_accounts(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    order_id TEXT NOT NULL,
    order_date DATE NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    num_items INTEGER NOT NULL,
    raw_data JSONB NOT NULL, -- Full receipt data including all items
    fetched_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Ensure one receipt per order ID
    UNIQUE(order_id)
);

-- Index for user and date-based queries
CREATE INDEX idx_receipts_user_date 
ON receipts(user_id, order_date DESC);

-- Index for order ID lookups
CREATE INDEX idx_receipts_order_id 
ON receipts(order_id);

-- Index for grocery account lookups
CREATE INDEX idx_receipts_grocery_account 
ON receipts(grocery_account_id);

-- Index for JSONB queries on raw_data
CREATE INDEX idx_receipts_raw_data 
ON receipts USING GIN (raw_data);

-- ==============================================================================
-- RECEIPT ITEMS TABLE
-- Individual items from receipts for easy querying
-- ==============================================================================
CREATE TABLE receipt_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    regular_price DECIMAL(10, 2),
    savings DECIMAL(10, 2),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for receipt lookups
CREATE INDEX idx_receipt_items_receipt 
ON receipt_items(receipt_id);

-- Index for item name searches
CREATE INDEX idx_receipt_items_name 
ON receipt_items USING GIN (to_tsvector('english', name));

-- Index for category filtering
CREATE INDEX idx_receipt_items_category 
ON receipt_items(category);

-- ==============================================================================
-- AUTOMATION LOGS TABLE
-- Tracks automation runs for debugging and monitoring
-- ==============================================================================
CREATE TABLE automation_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    grocery_account_id UUID REFERENCES grocery_accounts(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'mfa_required', 'partial')),
    error_message TEXT,
    receipts_fetched INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for user and date-based queries
CREATE INDEX idx_automation_logs_user_started 
ON automation_logs(user_id, started_at DESC);

-- Index for status filtering
CREATE INDEX idx_automation_logs_status 
ON automation_logs(status);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Enable RLS to ensure users can only access their own data
-- ==============================================================================

-- Enable RLS on all tables
ALTER TABLE grocery_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_logs ENABLE ROW LEVEL SECURITY;

-- Grocery Accounts RLS Policies
CREATE POLICY "Users can view their own grocery accounts"
ON grocery_accounts FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own grocery accounts"
ON grocery_accounts FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own grocery accounts"
ON grocery_accounts FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own grocery accounts"
ON grocery_accounts FOR DELETE
USING (auth.uid() = user_id);

-- Receipts RLS Policies
CREATE POLICY "Users can view their own receipts"
ON receipts FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own receipts"
ON receipts FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Receipt Items RLS Policies
CREATE POLICY "Users can view their own receipt items"
ON receipt_items FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM receipts
        WHERE receipts.id = receipt_items.receipt_id
        AND receipts.user_id = auth.uid()
    )
);

CREATE POLICY "Users can insert their own receipt items"
ON receipt_items FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM receipts
        WHERE receipts.id = receipt_items.receipt_id
        AND receipts.user_id = auth.uid()
    )
);

-- Automation Logs RLS Policies
CREATE POLICY "Users can view their own automation logs"
ON automation_logs FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own automation logs"
ON automation_logs FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- ==============================================================================
-- FUNCTIONS AND TRIGGERS
-- Automatic timestamp updates
-- ==============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for grocery_accounts
CREATE TRIGGER update_grocery_accounts_updated_at
BEFORE UPDATE ON grocery_accounts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ==============================================================================
-- COMMENTS
-- Add helpful comments for documentation
-- ==============================================================================

COMMENT ON TABLE grocery_accounts IS 'Links users to grocery provider accounts';
COMMENT ON COLUMN grocery_accounts.vault_key_id IS 'AWS Secrets Manager secret ID containing encrypted credentials';
COMMENT ON TABLE receipts IS 'Stores parsed receipt metadata from grocery providers';
COMMENT ON COLUMN receipts.raw_data IS 'Full receipt data in JSON format including all items and metadata';
COMMENT ON TABLE receipt_items IS 'Individual items extracted from receipts for easy querying';
COMMENT ON TABLE automation_logs IS 'Logs of automated receipt fetching runs for monitoring';

