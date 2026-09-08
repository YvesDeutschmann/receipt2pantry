-- QA household-join live test users (to-be-merged-user-1 / 2).
-- Unusable as logins: NULL password, unconfirmed email, @example.com.

-- Owner A: user …0003, household …0004, join code TBMERA
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
SELECT
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'to-be-merged-user-1@example.com',
    NULL,
    NULL,
    NOW(),
    NOW(),
    '{"provider": "email", "providers": ["email"]}',
    '{"name": "to-be-merged-user-1"}',
    false,
    '',
    ''
WHERE NOT EXISTS (
    SELECT 1 FROM auth.users WHERE email = 'to-be-merged-user-1@example.com'
)
ON CONFLICT (id) DO NOTHING;

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
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000003',
    '{"sub": "00000000-0000-0000-0000-000000000003", "email": "to-be-merged-user-1@example.com"}',
    'email',
    NOW(),
    NOW(),
    NOW()
)
ON CONFLICT (provider_id, provider) DO NOTHING;

-- Joiner B: user …0005 (household …0006 created below)
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
SELECT
    '00000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'to-be-merged-user-2@example.com',
    NULL,
    NULL,
    NOW(),
    NOW(),
    '{"provider": "email", "providers": ["email"]}',
    '{"name": "to-be-merged-user-2"}',
    false,
    '',
    ''
WHERE NOT EXISTS (
    SELECT 1 FROM auth.users WHERE email = 'to-be-merged-user-2@example.com'
)
ON CONFLICT (id) DO NOTHING;

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
    '00000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000005',
    '{"sub": "00000000-0000-0000-0000-000000000005", "email": "to-be-merged-user-2@example.com"}',
    'email',
    NOW(),
    NOW(),
    NOW()
)
ON CONFLICT (provider_id, provider) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM household_members
        WHERE user_id = '00000000-0000-0000-0000-000000000003'
    ) THEN
        INSERT INTO households (
            id,
            name,
            created_by,
            join_code,
            size,
            dietary_restrictions
        )
        VALUES (
            '00000000-0000-0000-0000-000000000004',
            'to-be-merged-user-1',
            '00000000-0000-0000-0000-000000000003',
            'TBMERA',
            3,
            ARRAY['peanuts']::text[]
        )
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO household_members (
            household_id,
            user_id,
            role
        )
        VALUES (
            '00000000-0000-0000-0000-000000000004',
            '00000000-0000-0000-0000-000000000003',
            'owner'
        )
        ON CONFLICT (user_id) DO NOTHING;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM household_members
        WHERE user_id = '00000000-0000-0000-0000-000000000005'
    ) THEN
        INSERT INTO households (
            id,
            name,
            created_by,
            join_code,
            size,
            dietary_restrictions
        )
        VALUES (
            '00000000-0000-0000-0000-000000000006',
            'to-be-merged-user-2',
            '00000000-0000-0000-0000-000000000005',
            'TBMERB',
            2,
            ARRAY[]::text[]
        )
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO household_members (
            household_id,
            user_id,
            role
        )
        VALUES (
            '00000000-0000-0000-0000-000000000006',
            '00000000-0000-0000-0000-000000000005',
            'owner'
        )
        ON CONFLICT (user_id) DO NOTHING;
    END IF;
END $$;
