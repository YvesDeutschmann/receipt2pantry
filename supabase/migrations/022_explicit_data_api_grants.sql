-- Explicit Data API grants for all public tables
--
-- Starting May 30 2026 (new projects) and October 30 2026 (all projects),
-- Supabase no longer auto-grants Data API access to tables in the public
-- schema.  Without explicit GRANTs, PostgREST / supabase-js will return
-- 42501 errors.
--
-- This migration adds the minimum required grants per role, matching the
-- access patterns already defined by each table's RLS policies.
--
-- Roles used:
--   authenticated – logged-in users (all app traffic)
--   service_role  – backend admin client (bypasses RLS)
--   anon          – not used by this app; no grants issued
--
-- The migration is fully idempotent: re-running it is a no-op.

-- ============================================================================
-- 001_initial_schema tables
-- ============================================================================

-- grocery_accounts: CRUD by authenticated (RLS: own rows)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grocery_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grocery_accounts TO service_role;

-- receipts: SELECT + INSERT by authenticated (RLS: own/household rows); UPDATE by service_role
GRANT SELECT, INSERT, UPDATE ON public.receipts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipts TO service_role;

-- receipt_items: SELECT + INSERT by authenticated (RLS: via receipts ownership)
GRANT SELECT, INSERT ON public.receipt_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipt_items TO service_role;

-- automation_logs: SELECT + INSERT by authenticated (RLS: own rows)
GRANT SELECT, INSERT ON public.automation_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_logs TO service_role;

-- ============================================================================
-- 002_login_sessions
-- ============================================================================

-- login_sessions: CRUD by authenticated (RLS: own rows)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.login_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.login_sessions TO service_role;

-- ============================================================================
-- 003_pantry_data_model tables
-- ============================================================================

-- product_mappings: SELECT-only by authenticated (RLS: read-only); managed by service_role
GRANT SELECT ON public.product_mappings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_mappings TO service_role;

-- pantry_items: CRUD by authenticated (RLS: own/household rows)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pantry_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pantry_items TO service_role;

-- cooking_log: CRUD by authenticated (RLS: own/household rows)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cooking_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cooking_log TO service_role;

-- ingredient_substitutions: SELECT-only by authenticated (RLS: read-only); managed by service_role
GRANT SELECT ON public.ingredient_substitutions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingredient_substitutions TO service_role;

-- ============================================================================
-- 004_ai_processing
-- ============================================================================

-- ai_processing_log: SELECT by authenticated (own rows); full access by service_role
GRANT SELECT ON public.ai_processing_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_processing_log TO service_role;

-- ============================================================================
-- 005_households tables
-- ============================================================================

-- households: CRUD by authenticated (RLS: membership-scoped)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.households TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.households TO service_role;

-- household_members: SELECT + INSERT + DELETE by authenticated (RLS: membership-scoped)
GRANT SELECT, INSERT, DELETE ON public.household_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.household_members TO service_role;

-- ============================================================================
-- 009_meal_planning tables
-- ============================================================================

-- meal_plan: CRUD by authenticated (RLS: household-scoped)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meal_plan TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meal_plan TO service_role;

-- shopping_list: CRUD by authenticated (RLS: household-scoped)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopping_list TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopping_list TO service_role;

-- meal_plan_wizard_session: CRUD by authenticated (RLS: user + household scoped)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meal_plan_wizard_session TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meal_plan_wizard_session TO service_role;

-- ============================================================================
-- 012_recipe_bans
-- ============================================================================

-- recipe_bans: SELECT + INSERT + DELETE by authenticated (RLS: own rows); UPDATE by service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_bans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_bans TO service_role;

-- ============================================================================
-- 014_pantry_template_support
-- ============================================================================

-- staples_template: SELECT-only by authenticated (RLS: read-only); managed by service_role
GRANT SELECT ON public.staples_template TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staples_template TO service_role;

-- ============================================================================
-- 015_canonical_ingredients
-- ============================================================================

-- canonical_ingredients: SELECT-only by authenticated (RLS: read-only); managed by service_role
GRANT SELECT ON public.canonical_ingredients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.canonical_ingredients TO service_role;

-- ============================================================================
-- 016_suggestion_pool tables
-- ============================================================================

-- pool_generation: SELECT + INSERT + UPDATE by authenticated (RLS: household-scoped)
GRANT SELECT, INSERT, UPDATE ON public.pool_generation TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pool_generation TO service_role;

-- suggestion_pool: CRUD by authenticated (RLS: household-scoped)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suggestion_pool TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suggestion_pool TO service_role;

-- ============================================================================
-- 017_depletion_data_model tables
-- ============================================================================

-- item_classification: SELECT-only by authenticated (RLS: read-only); managed by service_role
GRANT SELECT ON public.item_classification TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_classification TO service_role;

-- depletion_history: SELECT + INSERT by authenticated (RLS: own rows)
GRANT SELECT, INSERT ON public.depletion_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.depletion_history TO service_role;

-- purchase_history: SELECT + INSERT by authenticated (RLS: own rows)
GRANT SELECT, INSERT ON public.purchase_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_history TO service_role;

-- user_preferences: SELECT + INSERT + UPDATE by authenticated (RLS: own rows)
GRANT SELECT, INSERT, UPDATE ON public.user_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO service_role;

-- ============================================================================
-- 019_ingredient_signals
-- ============================================================================

-- ingredient_signals: SELECT + INSERT + UPDATE by authenticated (RLS: own rows);
-- full access also via service_role policy
GRANT SELECT, INSERT, UPDATE ON public.ingredient_signals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingredient_signals TO service_role;
