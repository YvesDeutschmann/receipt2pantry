-- Revoke legacy Supabase default anon privileges on public tables.
-- Migration 022 granted only to authenticated/service_role; defaults were never revoked.
-- Intentional exception: app_config SELECT for mobile/dev URL sync (021).

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Re-apply the intentional anon exception from 021_app_config.sql
GRANT SELECT ON public.app_config TO anon;
