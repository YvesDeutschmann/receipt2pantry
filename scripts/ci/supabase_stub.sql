-- Minimal stub of Supabase-managed objects required by app migrations.
-- Used by scripts/ci/validate_supabase_migrations.sh on vanilla Postgres.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  confirmation_token text,
  recovery_token text
);

CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid,
  provider_id text,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_data jsonb,
  provider text,
  last_sign_in_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (provider_id, provider)
);

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'sub', '')::uuid;
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- supabase_vault is not packaged on vanilla Postgres. Stub the schema the
-- vault RPC migration wraps so CI can apply it without the real extension.
CREATE SCHEMA IF NOT EXISTS vault;

CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE,
  description text,
  secret text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE OR REPLACE VIEW vault.decrypted_secrets AS
SELECT id, name, description, secret AS decrypted_secret, created_at, updated_at
FROM vault.secrets;

CREATE OR REPLACE FUNCTION vault.create_secret(
  new_secret text,
  new_name text DEFAULT NULL,
  new_description text DEFAULT NULL,
  new_key_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO vault.secrets (name, description, secret)
  VALUES (new_name, new_description, new_secret)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION vault.update_secret(
  secret_id uuid,
  new_secret text DEFAULT NULL,
  new_name text DEFAULT NULL,
  new_description text DEFAULT NULL,
  new_key_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE vault.secrets s
  SET
    secret = COALESCE(new_secret, s.secret),
    name = COALESCE(new_name, s.name),
    description = COALESCE(new_description, s.description),
    updated_at = now()
  WHERE s.id = secret_id;
END;
$$;

GRANT USAGE ON SCHEMA vault TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON vault.secrets TO service_role;
GRANT SELECT ON vault.decrypted_secrets TO service_role;

-- Supabase default privileges for objects created by postgres in public
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
