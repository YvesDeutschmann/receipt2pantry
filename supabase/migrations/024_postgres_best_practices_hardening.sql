-- ==============================================================================
-- Postgres best-practice hardening (Supabase skill)
-- ==============================================================================
-- Addresses critical/high findings:
--   1. SECURITY DEFINER RPCs callable by authenticated without auth checks
--   2. household_members self-referential RLS (infinite recursion risk)
--   3. bare auth.uid() in policies (initplan / per-row evaluation)
--   4. receipt_items RLS not household-aware
--   5. missing FK indexes; soft-delete uniqueness; AI views privilege leak
-- ==============================================================================

-- ----------------------------------------------------------------------------
-- 1. Membership helpers (SECURITY DEFINER, bypass RLS — break recursion)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_household_member(p_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.household_members
    WHERE household_id = p_household_id
      AND user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.is_household_owner(p_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.household_members
    WHERE household_id = p_household_id
      AND user_id = (SELECT auth.uid())
      AND role = 'owner'
  );
$$;

REVOKE ALL ON FUNCTION public.is_household_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_household_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_household_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_household_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_household_member(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_household_owner(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Lock down SECURITY DEFINER RPCs (service_role only + caller checks)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION store_receipt_with_items(
  p_receipt jsonb,
  p_items   jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt_id uuid;
  v_item       jsonb;
  v_caller     uuid := (SELECT auth.uid());
  v_user_id    uuid := (p_receipt->>'user_id')::uuid;
BEGIN
  -- When called with a user JWT, forbid impersonation. service_role has null uid.
  IF v_caller IS NOT NULL AND v_user_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'forbidden: receipt user_id does not match caller';
  END IF;

  INSERT INTO receipts (
    user_id, household_id, grocery_account_id, provider,
    order_id, order_date, total_amount, num_items,
    raw_data, fetched_at, created_at
  )
  VALUES (
    v_user_id,
    NULLIF(trim(p_receipt->>'household_id'), '')::uuid,
    NULLIF(trim(p_receipt->>'grocery_account_id'), '')::uuid,
    p_receipt->>'provider',
    p_receipt->>'order_id',
    (p_receipt->>'order_date')::date,
    (p_receipt->>'total_amount')::numeric,
    COALESCE((p_receipt->>'num_items')::int, 0),
    COALESCE(p_receipt->'raw_data', '{}'::jsonb),
    (p_receipt->>'fetched_at')::timestamptz,
    COALESCE((p_receipt->>'created_at')::timestamptz, now())
  )
  ON CONFLICT (user_id, provider, order_id) DO NOTHING
  RETURNING id INTO v_receipt_id;

  IF v_receipt_id IS NOT NULL THEN
    FOR v_item IN SELECT elem FROM jsonb_array_elements(p_items) AS elem
    LOOP
      INSERT INTO receipt_items (
        receipt_id, user_id, name, category, price, quantity,
        quantity_info, regular_price, savings, created_at
      )
      VALUES (
        v_receipt_id,
        COALESCE(NULLIF(trim(v_item->>'user_id'), '')::uuid, v_user_id),
        v_item->>'name',
        COALESCE(v_item->>'category', 'UNKNOWN'),
        (v_item->>'price')::numeric,
        COALESCE((v_item->>'quantity')::numeric, 1),
        v_item->'quantity_info',
        (v_item->>'regular_price')::numeric,
        (v_item->>'savings')::numeric,
        COALESCE((v_item->>'created_at')::timestamptz, now())
      );
    END LOOP;
  END IF;

  RETURN v_receipt_id;
END;
$$;

REVOKE ALL ON FUNCTION store_receipt_with_items(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION store_receipt_with_items(jsonb, jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION store_receipt_with_items(jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION store_receipt_with_items(jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION soft_delete_pantry_item(
  p_pantry_item_id uuid,
  p_user_id uuid,
  p_item_name text,
  p_depletion_class text,
  p_purchase_date date,
  p_deleted_at timestamptz,
  p_reason text,
  p_days_in_pantry integer,
  p_was_cooked boolean,
  p_put_back_count integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hist_id uuid;
  v_updated int;
  v_caller uuid := (SELECT auth.uid());
BEGIN
  IF v_caller IS NOT NULL AND p_user_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'forbidden: pantry user_id does not match caller';
  END IF;

  UPDATE pantry_items
  SET deleted_at = p_deleted_at
  WHERE id = p_pantry_item_id
    AND user_id = p_user_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'pantry item not found, wrong user, or already deleted';
  END IF;

  INSERT INTO depletion_history (
    user_id,
    pantry_item_id,
    item_name,
    depletion_class,
    purchase_date,
    deleted_at,
    reason,
    days_in_pantry,
    was_cooked,
    put_back_count
  ) VALUES (
    p_user_id,
    p_pantry_item_id,
    p_item_name,
    p_depletion_class,
    p_purchase_date,
    p_deleted_at,
    p_reason,
    p_days_in_pantry,
    p_was_cooked,
    p_put_back_count
  )
  RETURNING id INTO v_hist_id;

  RETURN v_hist_id;
END;
$$;

REVOKE ALL ON FUNCTION soft_delete_pantry_item(
  uuid, uuid, text, text, date, timestamptz, text, integer, boolean, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION soft_delete_pantry_item(
  uuid, uuid, text, text, date, timestamptz, text, integer, boolean, integer
) FROM authenticated;
REVOKE ALL ON FUNCTION soft_delete_pantry_item(
  uuid, uuid, text, text, date, timestamptz, text, integer, boolean, integer
) FROM anon;
GRANT EXECUTE ON FUNCTION soft_delete_pantry_item(
  uuid, uuid, text, text, date, timestamptz, text, integer, boolean, integer
) TO service_role;

-- Harden log_ai_processing: search_path + revoke public/authenticated
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
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total_tokens INTEGER;
    v_estimated_cost DECIMAL(10,6);
    v_id UUID;
    v_caller uuid := (SELECT auth.uid());
BEGIN
    IF v_caller IS NOT NULL
       AND p_user_id IS NOT NULL
       AND p_user_id IS DISTINCT FROM v_caller THEN
      RAISE EXCEPTION 'forbidden: ai log user_id does not match caller';
    END IF;

    v_total_tokens := COALESCE(p_input_tokens, 0) + COALESCE(p_output_tokens, 0);
    v_estimated_cost := (
        COALESCE(p_input_tokens, 0) * 0.00000015 +
        COALESCE(p_output_tokens, 0) * 0.0000006
    );

    INSERT INTO ai_processing_log (
        operation, model, input_tokens, output_tokens, total_tokens,
        estimated_cost, duration_ms, success, error_message,
        user_id, receipt_id, items_processed,
        request_metadata, response_metadata
    ) VALUES (
        p_operation, p_model, p_input_tokens, p_output_tokens, v_total_tokens,
        v_estimated_cost, p_duration_ms, p_success, p_error_message,
        COALESCE(p_user_id, v_caller), p_receipt_id, p_items_processed,
        p_request_metadata, p_response_metadata
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION log_ai_processing(
  text, text, integer, integer, integer, boolean, text, uuid, uuid, integer, jsonb, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION log_ai_processing(
  text, text, integer, integer, integer, boolean, text, uuid, uuid, integer, jsonb, jsonb
) FROM authenticated;
REVOKE ALL ON FUNCTION log_ai_processing(
  text, text, integer, integer, integer, boolean, text, uuid, uuid, integer, jsonb, jsonb
) FROM anon;
GRANT EXECUTE ON FUNCTION log_ai_processing(
  text, text, integer, integer, integer, boolean, text, uuid, uuid, integer, jsonb, jsonb
) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Rewrite household / shared RLS with helpers + (select auth.uid())
-- ----------------------------------------------------------------------------

-- households
DROP POLICY IF EXISTS "Users can view households they belong to" ON households;
DROP POLICY IF EXISTS "Authenticated users can create households" ON households;
DROP POLICY IF EXISTS "Owners can update their household" ON households;
DROP POLICY IF EXISTS "Owners can delete their household" ON households;

CREATE POLICY "Users can view households they belong to"
    ON households FOR SELECT
    TO authenticated
    USING (public.is_household_member(id));

CREATE POLICY "Authenticated users can create households"
    ON households FOR INSERT
    TO authenticated
    WITH CHECK (created_by = (SELECT auth.uid()));

CREATE POLICY "Owners can update their household"
    ON households FOR UPDATE
    TO authenticated
    USING (public.is_household_owner(id));

CREATE POLICY "Owners can delete their household"
    ON households FOR DELETE
    TO authenticated
    USING (public.is_household_owner(id));

-- household_members (no self-referential subquery)
DROP POLICY IF EXISTS "Users can view members of their household" ON household_members;
DROP POLICY IF EXISTS "Users can join households" ON household_members;
DROP POLICY IF EXISTS "Users can leave households" ON household_members;
DROP POLICY IF EXISTS "Owners can remove members" ON household_members;

CREATE POLICY "Users can view members of their household"
    ON household_members FOR SELECT
    TO authenticated
    USING (
      public.is_household_member(household_id)
      OR user_id = (SELECT auth.uid())
    );

CREATE POLICY "Users can join households"
    ON household_members FOR INSERT
    TO authenticated
    WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can leave households"
    ON household_members FOR DELETE
    TO authenticated
    USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Owners can remove members"
    ON household_members FOR DELETE
    TO authenticated
    USING (public.is_household_owner(household_id));

-- pantry_items
DROP POLICY IF EXISTS "Household members can view pantry items" ON pantry_items;
DROP POLICY IF EXISTS "Household members can insert pantry items" ON pantry_items;
DROP POLICY IF EXISTS "Household members can update pantry items" ON pantry_items;
DROP POLICY IF EXISTS "Household members can delete pantry items" ON pantry_items;

CREATE POLICY "Household members can view pantry items"
    ON pantry_items FOR SELECT
    TO authenticated
    USING (
        (household_id IS NULL AND user_id = (SELECT auth.uid()))
        OR public.is_household_member(household_id)
    );

CREATE POLICY "Household members can insert pantry items"
    ON pantry_items FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND (
          (household_id IS NULL)
          OR public.is_household_member(household_id)
        )
    );

CREATE POLICY "Household members can update pantry items"
    ON pantry_items FOR UPDATE
    TO authenticated
    USING (
        (household_id IS NULL AND user_id = (SELECT auth.uid()))
        OR public.is_household_member(household_id)
    )
    WITH CHECK (
        (household_id IS NULL AND user_id = (SELECT auth.uid()))
        OR public.is_household_member(household_id)
    );

CREATE POLICY "Household members can delete pantry items"
    ON pantry_items FOR DELETE
    TO authenticated
    USING (
        (household_id IS NULL AND user_id = (SELECT auth.uid()))
        OR public.is_household_member(household_id)
    );

-- receipts
DROP POLICY IF EXISTS "Household members can view receipts" ON receipts;
DROP POLICY IF EXISTS "Household members can insert receipts" ON receipts;

CREATE POLICY "Household members can view receipts"
    ON receipts FOR SELECT
    TO authenticated
    USING (
        (household_id IS NULL AND user_id = (SELECT auth.uid()))
        OR public.is_household_member(household_id)
    );

CREATE POLICY "Household members can insert receipts"
    ON receipts FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND (
          (household_id IS NULL)
          OR public.is_household_member(household_id)
        )
    );

-- receipt_items: align with household-scoped receipts
DROP POLICY IF EXISTS "Users can view their own receipt items" ON receipt_items;
DROP POLICY IF EXISTS "Users can insert their own receipt items" ON receipt_items;

CREATE POLICY "Household members can view receipt items"
    ON receipt_items FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM receipts r
        WHERE r.id = receipt_items.receipt_id
          AND (
            (r.household_id IS NULL AND r.user_id = (SELECT auth.uid()))
            OR public.is_household_member(r.household_id)
          )
      )
    );

CREATE POLICY "Household members can insert receipt items"
    ON receipt_items FOR INSERT
    TO authenticated
    WITH CHECK (
      user_id = (SELECT auth.uid())
      AND EXISTS (
        SELECT 1 FROM receipts r
        WHERE r.id = receipt_items.receipt_id
          AND (
            (r.household_id IS NULL AND r.user_id = (SELECT auth.uid()))
            OR public.is_household_member(r.household_id)
          )
      )
    );

-- cooking_log
DROP POLICY IF EXISTS "Household members can view cooking log" ON cooking_log;
DROP POLICY IF EXISTS "Household members can insert cooking log" ON cooking_log;
DROP POLICY IF EXISTS "Household members can update cooking log" ON cooking_log;
DROP POLICY IF EXISTS "Household members can delete cooking log" ON cooking_log;

CREATE POLICY "Household members can view cooking log"
    ON cooking_log FOR SELECT
    TO authenticated
    USING (
        (household_id IS NULL AND user_id = (SELECT auth.uid()))
        OR public.is_household_member(household_id)
    );

CREATE POLICY "Household members can insert cooking log"
    ON cooking_log FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND (
          (household_id IS NULL)
          OR public.is_household_member(household_id)
        )
    );

CREATE POLICY "Household members can update cooking log"
    ON cooking_log FOR UPDATE
    TO authenticated
    USING (
        (household_id IS NULL AND user_id = (SELECT auth.uid()))
        OR public.is_household_member(household_id)
    );

CREATE POLICY "Household members can delete cooking log"
    ON cooking_log FOR DELETE
    TO authenticated
    USING (
        (household_id IS NULL AND user_id = (SELECT auth.uid()))
        OR public.is_household_member(household_id)
    );

-- meal_plan
DROP POLICY IF EXISTS "Household members can view meal plans" ON meal_plan;
DROP POLICY IF EXISTS "Household members can insert meal plans" ON meal_plan;
DROP POLICY IF EXISTS "Household members can update meal plans" ON meal_plan;
DROP POLICY IF EXISTS "Household members can delete meal plans" ON meal_plan;

CREATE POLICY "Household members can view meal plans"
    ON meal_plan FOR SELECT
    TO authenticated
    USING (public.is_household_member(household_id));

CREATE POLICY "Household members can insert meal plans"
    ON meal_plan FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_household_member(household_id)
        AND user_id = (SELECT auth.uid())
    );

CREATE POLICY "Household members can update meal plans"
    ON meal_plan FOR UPDATE
    TO authenticated
    USING (public.is_household_member(household_id));

CREATE POLICY "Household members can delete meal plans"
    ON meal_plan FOR DELETE
    TO authenticated
    USING (public.is_household_member(household_id));

-- shopping_list
DROP POLICY IF EXISTS "Household members can view shopping list" ON shopping_list;
DROP POLICY IF EXISTS "Household members can insert shopping list items" ON shopping_list;
DROP POLICY IF EXISTS "Household members can update shopping list items" ON shopping_list;
DROP POLICY IF EXISTS "Household members can delete shopping list items" ON shopping_list;

CREATE POLICY "Household members can view shopping list"
    ON shopping_list FOR SELECT
    TO authenticated
    USING (public.is_household_member(household_id));

CREATE POLICY "Household members can insert shopping list items"
    ON shopping_list FOR INSERT
    TO authenticated
    WITH CHECK (public.is_household_member(household_id));

CREATE POLICY "Household members can update shopping list items"
    ON shopping_list FOR UPDATE
    TO authenticated
    USING (public.is_household_member(household_id));

CREATE POLICY "Household members can delete shopping list items"
    ON shopping_list FOR DELETE
    TO authenticated
    USING (public.is_household_member(household_id));

-- meal_plan_wizard_session
DROP POLICY IF EXISTS "Users can view their own wizard sessions" ON meal_plan_wizard_session;
DROP POLICY IF EXISTS "Users can create wizard sessions" ON meal_plan_wizard_session;
DROP POLICY IF EXISTS "Users can update their wizard sessions" ON meal_plan_wizard_session;
DROP POLICY IF EXISTS "Users can delete their wizard sessions" ON meal_plan_wizard_session;

CREATE POLICY "Users can view their own wizard sessions"
    ON meal_plan_wizard_session FOR SELECT
    TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        AND public.is_household_member(household_id)
    );

CREATE POLICY "Users can create wizard sessions"
    ON meal_plan_wizard_session FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND public.is_household_member(household_id)
    );

CREATE POLICY "Users can update their wizard sessions"
    ON meal_plan_wizard_session FOR UPDATE
    TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        AND public.is_household_member(household_id)
    );

CREATE POLICY "Users can delete their wizard sessions"
    ON meal_plan_wizard_session FOR DELETE
    TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        AND public.is_household_member(household_id)
    );

-- pool_generation / suggestion_pool
DROP POLICY IF EXISTS "Household members can view pool_generation" ON pool_generation;
DROP POLICY IF EXISTS "Household members can insert pool_generation" ON pool_generation;
DROP POLICY IF EXISTS "Household members can update pool_generation" ON pool_generation;
DROP POLICY IF EXISTS "Household members can view suggestion_pool" ON suggestion_pool;
DROP POLICY IF EXISTS "Household members can insert suggestion_pool" ON suggestion_pool;
DROP POLICY IF EXISTS "Household members can update suggestion_pool" ON suggestion_pool;
DROP POLICY IF EXISTS "Household members can delete suggestion_pool" ON suggestion_pool;

CREATE POLICY "Household members can view pool_generation"
    ON pool_generation FOR SELECT
    TO authenticated
    USING (public.is_household_member(household_id));

CREATE POLICY "Household members can insert pool_generation"
    ON pool_generation FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND public.is_household_member(household_id)
    );

CREATE POLICY "Household members can update pool_generation"
    ON pool_generation FOR UPDATE
    TO authenticated
    USING (public.is_household_member(household_id));

CREATE POLICY "Household members can view suggestion_pool"
    ON suggestion_pool FOR SELECT
    TO authenticated
    USING (public.is_household_member(household_id));

CREATE POLICY "Household members can insert suggestion_pool"
    ON suggestion_pool FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = (SELECT auth.uid())
        AND public.is_household_member(household_id)
    );

CREATE POLICY "Household members can update suggestion_pool"
    ON suggestion_pool FOR UPDATE
    TO authenticated
    USING (public.is_household_member(household_id));

CREATE POLICY "Household members can delete suggestion_pool"
    ON suggestion_pool FOR DELETE
    TO authenticated
    USING (public.is_household_member(household_id));

-- ----------------------------------------------------------------------------
-- 4. User-scoped policies: wrap auth.uid() for initplan caching
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view their own grocery accounts" ON grocery_accounts;
DROP POLICY IF EXISTS "Users can insert their own grocery accounts" ON grocery_accounts;
DROP POLICY IF EXISTS "Users can update their own grocery accounts" ON grocery_accounts;
DROP POLICY IF EXISTS "Users can delete their own grocery accounts" ON grocery_accounts;

CREATE POLICY "Users can view their own grocery accounts"
    ON grocery_accounts FOR SELECT
    USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can insert their own grocery accounts"
    ON grocery_accounts FOR INSERT
    WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can update their own grocery accounts"
    ON grocery_accounts FOR UPDATE
    USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can delete their own grocery accounts"
    ON grocery_accounts FOR DELETE
    USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can view their own automation logs" ON automation_logs;
DROP POLICY IF EXISTS "Users can insert their own automation logs" ON automation_logs;

CREATE POLICY "Users can view their own automation logs"
    ON automation_logs FOR SELECT
    USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can insert their own automation logs"
    ON automation_logs FOR INSERT
    WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can view their own login sessions" ON login_sessions;
DROP POLICY IF EXISTS "Users can insert their own login sessions" ON login_sessions;
DROP POLICY IF EXISTS "Users can update their own login sessions" ON login_sessions;
DROP POLICY IF EXISTS "Users can delete their own login sessions" ON login_sessions;

CREATE POLICY "Users can view their own login sessions"
    ON login_sessions FOR SELECT
    USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can insert their own login sessions"
    ON login_sessions FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can update their own login sessions"
    ON login_sessions FOR UPDATE
    USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can delete their own login sessions"
    ON login_sessions FOR DELETE
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view own AI logs" ON ai_processing_log;
CREATE POLICY "Users can view own AI logs"
    ON ai_processing_log FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own recipe bans" ON recipe_bans;
DROP POLICY IF EXISTS "Users can insert their own recipe bans" ON recipe_bans;
DROP POLICY IF EXISTS "Users can delete their own recipe bans" ON recipe_bans;

CREATE POLICY "Users can view their own recipe bans"
    ON recipe_bans FOR SELECT
    USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can insert their own recipe bans"
    ON recipe_bans FOR INSERT
    WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can delete their own recipe bans"
    ON recipe_bans FOR DELETE
    USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can view own ingredient_signals" ON ingredient_signals;
DROP POLICY IF EXISTS "Users can insert own ingredient_signals" ON ingredient_signals;
DROP POLICY IF EXISTS "Users can update own ingredient_signals" ON ingredient_signals;

CREATE POLICY "Users can view own ingredient_signals"
    ON ingredient_signals FOR SELECT
    USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can insert own ingredient_signals"
    ON ingredient_signals FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can update own ingredient_signals"
    ON ingredient_signals FOR UPDATE
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

-- depletion / purchase / preferences (from 017)
DROP POLICY IF EXISTS "Users can view own depletion_history" ON depletion_history;
DROP POLICY IF EXISTS "Users can insert own depletion_history" ON depletion_history;
CREATE POLICY "Users can view own depletion_history"
  ON depletion_history FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can insert own depletion_history"
  ON depletion_history FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can view own purchase_history" ON purchase_history;
DROP POLICY IF EXISTS "Users can insert own purchase_history" ON purchase_history;
CREATE POLICY "Users can view own purchase_history"
  ON purchase_history FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can insert own purchase_history"
  ON purchase_history FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can view own user_preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can insert own user_preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can update own user_preferences" ON user_preferences;
CREATE POLICY "Users can view own user_preferences"
  ON user_preferences FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can insert own user_preferences"
  ON user_preferences FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can update own user_preferences"
  ON user_preferences FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
-- 5. Missing FK indexes
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_automation_logs_grocery_account
  ON automation_logs (grocery_account_id);
CREATE INDEX IF NOT EXISTS idx_pantry_items_last_receipt
  ON pantry_items (last_receipt_id);
CREATE INDEX IF NOT EXISTS idx_ai_log_receipt_id
  ON ai_processing_log (receipt_id);
CREATE INDEX IF NOT EXISTS idx_meal_plan_leftover_from
  ON meal_plan (leftover_from_id);
CREATE INDEX IF NOT EXISTS idx_meal_plan_user
  ON meal_plan (user_id);
CREATE INDEX IF NOT EXISTS idx_wizard_session_user
  ON meal_plan_wizard_session (user_id);
CREATE INDEX IF NOT EXISTS idx_pool_generation_user
  ON pool_generation (user_id);
CREATE INDEX IF NOT EXISTS idx_suggestion_pool_user
  ON suggestion_pool (user_id);
CREATE INDEX IF NOT EXISTS idx_depletion_history_pantry_item
  ON depletion_history (pantry_item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_history_receipt
  ON purchase_history (receipt_import_id);

-- Partial indexes for common filtered access patterns
CREATE INDEX IF NOT EXISTS idx_pantry_items_household_active
  ON pantry_items (household_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_suggestion_pool_unused
  ON suggestion_pool (household_id, meal_type)
  WHERE status = 'unused';
CREATE INDEX IF NOT EXISTS idx_pool_generation_in_progress
  ON pool_generation (household_id)
  WHERE status = 'in_progress';

-- ----------------------------------------------------------------------------
-- 6. Soft-delete-aware uniqueness on pantry
-- ----------------------------------------------------------------------------

DROP INDEX IF EXISTS unique_household_ingredient_variant;
CREATE UNIQUE INDEX unique_household_ingredient_variant
  ON pantry_items (household_id, base_ingredient, variant, unit)
  WHERE household_id IS NOT NULL AND deleted_at IS NULL;

DROP INDEX IF EXISTS unique_user_ingredient_variant_null_household;
CREATE UNIQUE INDEX unique_user_ingredient_variant_null_household
  ON pantry_items (user_id, base_ingredient, variant, unit)
  WHERE household_id IS NULL AND deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 7. AI aggregate views: invoker security + revoke broad access
-- ----------------------------------------------------------------------------

ALTER VIEW ai_usage_daily SET (security_invoker = true);
ALTER VIEW ai_cost_monthly SET (security_invoker = true);

REVOKE ALL ON TABLE ai_usage_daily FROM PUBLIC;
REVOKE ALL ON TABLE ai_usage_daily FROM anon;
REVOKE ALL ON TABLE ai_usage_daily FROM authenticated;
REVOKE ALL ON TABLE ai_cost_monthly FROM PUBLIC;
REVOKE ALL ON TABLE ai_cost_monthly FROM anon;
REVOKE ALL ON TABLE ai_cost_monthly FROM authenticated;
GRANT SELECT ON TABLE ai_usage_daily TO service_role;
GRANT SELECT ON TABLE ai_cost_monthly TO service_role;

-- ----------------------------------------------------------------------------
-- 8. Fix contradictory FK: created_by NOT NULL + ON DELETE SET NULL
-- ----------------------------------------------------------------------------

ALTER TABLE households
  DROP CONSTRAINT IF EXISTS households_created_by_fkey;

ALTER TABLE households
  ADD CONSTRAINT households_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
