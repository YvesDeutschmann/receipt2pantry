-- Create test user for development
-- This user ID matches the hardcoded ID in the frontend: 00000000-0000-0000-0000-000000000001

-- Insert test user into auth.users
INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    confirmation_token,
    recovery_token
)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'test@example.com',
    -- Password: 'test123' (hashed with bcrypt)
    '$2a$10$XK9V5q5KzKxqVq5KzKxqUOKzKxqVq5KzKxqVq5KzKxqVq5KzKxqU',
    NOW(),
    NOW(),
    NOW(),
    '{"provider": "email", "providers": ["email"]}',
    '{"name": "Test User"}',
    false,
    '',
    ''
)
ON CONFLICT (id) DO NOTHING;

-- Create an identity for the test user
INSERT INTO auth.identities (
    id,
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '{"sub": "00000000-0000-0000-0000-000000000001", "email": "test@example.com"}',
    'email',
    NOW(),
    NOW(),
    NOW()
)
ON CONFLICT (provider_id, provider) DO NOTHING;

-- Check if test user already has a household, if not create one
DO $$
BEGIN
    -- Only create household if user is not already a member of one
    IF NOT EXISTS (
        SELECT 1 FROM household_members 
        WHERE user_id = '00000000-0000-0000-0000-000000000001'
    ) THEN
        -- Create a default household for the test user
        INSERT INTO households (
            id,
            name,
            created_by,
            join_code
        )
        VALUES (
            '00000000-0000-0000-0000-000000000002',
            'Test Household',
            '00000000-0000-0000-0000-000000000001',
            'TEST123'
        )
        ON CONFLICT (id) DO NOTHING;
        
        -- Add test user as member of test household
        INSERT INTO household_members (
            household_id,
            user_id,
            role
        )
        VALUES (
            '00000000-0000-0000-0000-000000000002',
            '00000000-0000-0000-0000-000000000001',
            'owner'
        )
        ON CONFLICT (user_id) DO NOTHING;
    END IF;
END $$;
