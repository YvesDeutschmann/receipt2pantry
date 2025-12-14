-- Migration: Login Sessions Table
-- Description: Create table to track login sessions that require MFA
-- Author: GrocerySync
-- Date: 2025-10-16

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create login_sessions table
CREATE TABLE IF NOT EXISTS login_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending_mfa', 'awaiting_code', 'completed', 'failed', 'expired')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Create index for efficient cleanup queries
CREATE INDEX IF NOT EXISTS idx_login_sessions_expires ON login_sessions(expires_at);

-- Create index for user lookups
CREATE INDEX IF NOT EXISTS idx_login_sessions_user ON login_sessions(user_id);

-- Enable Row Level Security
ALTER TABLE login_sessions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own login sessions" ON login_sessions;
DROP POLICY IF EXISTS "Users can insert their own login sessions" ON login_sessions;
DROP POLICY IF EXISTS "Users can update their own login sessions" ON login_sessions;
DROP POLICY IF EXISTS "Users can delete their own login sessions" ON login_sessions;

-- Create RLS policies
CREATE POLICY "Users can view their own login sessions"
ON login_sessions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own login sessions"
ON login_sessions FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own login sessions"
ON login_sessions FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own login sessions"
ON login_sessions FOR DELETE
USING (auth.uid() = user_id);

-- Add comment to table
COMMENT ON TABLE login_sessions IS 'Tracks login sessions that require multi-factor authentication';

-- Add comments to columns
COMMENT ON COLUMN login_sessions.id IS 'Unique session identifier';
COMMENT ON COLUMN login_sessions.user_id IS 'User who initiated the login session';
COMMENT ON COLUMN login_sessions.provider IS 'Provider name (e.g., safeway, albertsons)';
COMMENT ON COLUMN login_sessions.state IS 'Current state of the login session';
COMMENT ON COLUMN login_sessions.error_message IS 'Error message if login failed';
COMMENT ON COLUMN login_sessions.created_at IS 'When the session was created';
COMMENT ON COLUMN login_sessions.expires_at IS 'When the session will expire';
COMMENT ON COLUMN login_sessions.completed_at IS 'When the session was completed successfully';

