-- AI Processing Log Migration
-- Creates tables for tracking AI usage and performance

-- ============================================================================
-- TABLES
-- ============================================================================

-- AI Processing Log: Track AI API usage for monitoring and cost analysis
CREATE TABLE IF NOT EXISTS ai_processing_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Request details
    operation TEXT NOT NULL, -- 'parse_receipt', 'normalize_batch', 'detect_store'
    model TEXT NOT NULL, -- e.g., 'gpt-4o-mini'
    
    -- Token usage
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    
    -- Cost tracking (in USD)
    estimated_cost DECIMAL(10,6),
    
    -- Performance
    duration_ms INTEGER,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    error_message TEXT,
    
    -- Context
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    receipt_id UUID REFERENCES receipts(id) ON DELETE SET NULL,
    items_processed INTEGER,
    
    -- Metadata
    request_metadata JSONB,
    response_metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index for querying by date and operation
CREATE INDEX IF NOT EXISTS idx_ai_log_created_at ON ai_processing_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_log_operation ON ai_processing_log(operation);
CREATE INDEX IF NOT EXISTS idx_ai_log_user_id ON ai_processing_log(user_id);

-- Add source column to product_mappings if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'product_mappings' AND column_name = 'source'
    ) THEN
        ALTER TABLE product_mappings ADD COLUMN source TEXT DEFAULT 'rule_based';
    END IF;
END $$;

-- Add confidence_score column to product_mappings if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'product_mappings' AND column_name = 'confidence_score'
    ) THEN
        ALTER TABLE product_mappings ADD COLUMN confidence_score DECIMAL(3,2) DEFAULT 0.6;
    END IF;
END $$;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- View for daily AI usage summary
CREATE OR REPLACE VIEW ai_usage_daily AS
SELECT 
    DATE(created_at) as date,
    operation,
    model,
    COUNT(*) as request_count,
    SUM(total_tokens) as total_tokens,
    SUM(estimated_cost) as total_cost,
    AVG(duration_ms) as avg_duration_ms,
    SUM(CASE WHEN success THEN 1 ELSE 0 END) as success_count,
    SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) as error_count,
    SUM(items_processed) as total_items_processed
FROM ai_processing_log
GROUP BY DATE(created_at), operation, model
ORDER BY date DESC, operation;

-- View for monthly cost summary
CREATE OR REPLACE VIEW ai_cost_monthly AS
SELECT 
    DATE_TRUNC('month', created_at) as month,
    model,
    COUNT(*) as request_count,
    SUM(total_tokens) as total_tokens,
    SUM(estimated_cost) as total_cost,
    SUM(items_processed) as total_items_processed
FROM ai_processing_log
WHERE success = TRUE
GROUP BY DATE_TRUNC('month', created_at), model
ORDER BY month DESC;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on ai_processing_log
ALTER TABLE ai_processing_log ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (idempotent)
DROP POLICY IF EXISTS "Users can view own AI logs" ON ai_processing_log;
DROP POLICY IF EXISTS "Service role can manage AI logs" ON ai_processing_log;

-- Policy: Users can view their own AI processing logs
CREATE POLICY "Users can view own AI logs"
    ON ai_processing_log
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Service role can insert/update all logs
CREATE POLICY "Service role can manage AI logs"
    ON ai_processing_log
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to log AI processing
CREATE OR REPLACE FUNCTION log_ai_processing(
    p_operation TEXT,
    p_model TEXT,
    p_input_tokens INTEGER DEFAULT NULL,
    p_output_tokens INTEGER DEFAULT NULL,
    p_duration_ms INTEGER DEFAULT NULL,
    p_success BOOLEAN DEFAULT TRUE,
    p_error_message TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_receipt_id UUID DEFAULT NULL,
    p_items_processed INTEGER DEFAULT NULL,
    p_request_metadata JSONB DEFAULT NULL,
    p_response_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_total_tokens INTEGER;
    v_estimated_cost DECIMAL(10,6);
    v_id UUID;
BEGIN
    -- Calculate total tokens
    v_total_tokens := COALESCE(p_input_tokens, 0) + COALESCE(p_output_tokens, 0);
    
    -- Estimate cost based on GPT-4o-mini pricing
    -- Input: $0.15/1M tokens, Output: $0.60/1M tokens
    v_estimated_cost := (
        COALESCE(p_input_tokens, 0) * 0.00000015 +
        COALESCE(p_output_tokens, 0) * 0.0000006
    );
    
    INSERT INTO ai_processing_log (
        operation,
        model,
        input_tokens,
        output_tokens,
        total_tokens,
        estimated_cost,
        duration_ms,
        success,
        error_message,
        user_id,
        receipt_id,
        items_processed,
        request_metadata,
        response_metadata
    ) VALUES (
        p_operation,
        p_model,
        p_input_tokens,
        p_output_tokens,
        v_total_tokens,
        v_estimated_cost,
        p_duration_ms,
        p_success,
        p_error_message,
        p_user_id,
        p_receipt_id,
        p_items_processed,
        p_request_metadata,
        p_response_metadata
    )
    RETURNING id INTO v_id;
    
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

