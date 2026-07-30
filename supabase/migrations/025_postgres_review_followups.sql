-- ==============================================================================
-- Code-review follow-ups for 024 (idempotent, safe to re-apply pieces)
-- ==============================================================================
-- 1. upsert_pantry_item RPC (partial unique indexes cannot use PostgREST on_conflict)
-- 2. SECURITY DEFINER functions: empty search_path + qualified names
-- 3. log_ai_processing: stop auto-attributing rows to caller
-- 4. households.created_by: nullable + ON DELETE SET NULL (real user-delete fix)
-- ==============================================================================

-- ----------------------------------------------------------------------------
-- 1. Pantry upsert RPC (service_role only)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_pantry_item(p_item jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_user_id uuid := (p_item->>'user_id')::uuid;
  v_household_id uuid := NULLIF(trim(p_item->>'household_id'), '')::uuid;
  v_variant text := NULLIF(trim(p_item->>'variant'), '');
  v_unit text := NULLIF(trim(p_item->>'unit'), '');
  v_last_receipt uuid := NULLIF(trim(p_item->>'last_receipt_id'), '')::uuid;
  v_source text := NULLIF(trim(p_item->>'source'), '');
  v_template_confirmed boolean := COALESCE((p_item->>'template_confirmed')::boolean, false);
  v_tags text[] := COALESCE(
    (SELECT array_agg(elem)
     FROM jsonb_array_elements_text(COALESCE(p_item->'tags', '[]'::jsonb)) AS elem),
    ARRAY[]::text[]
  );
BEGIN
  IF v_household_id IS NOT NULL THEN
    INSERT INTO public.pantry_items (
      user_id, household_id, base_ingredient, variant, unit, normalized_name,
      quantity, product_type, category, tags, metadata, last_receipt_id,
      source, template_confirmed
    )
    VALUES (
      v_user_id,
      v_household_id,
      p_item->>'base_ingredient',
      v_variant,
      v_unit,
      p_item->>'normalized_name',
      COALESCE((p_item->>'quantity')::numeric, 1),
      NULLIF(trim(p_item->>'product_type'), ''),
      NULLIF(trim(p_item->>'category'), ''),
      v_tags,
      COALESCE(p_item->'metadata', '{}'::jsonb),
      v_last_receipt,
      v_source,
      v_template_confirmed
    )
    ON CONFLICT (household_id, base_ingredient, variant, unit)
      WHERE household_id IS NOT NULL AND deleted_at IS NULL
    DO UPDATE SET
      normalized_name = EXCLUDED.normalized_name,
      quantity = EXCLUDED.quantity,
      product_type = COALESCE(EXCLUDED.product_type, public.pantry_items.product_type),
      category = COALESCE(EXCLUDED.category, public.pantry_items.category),
      tags = EXCLUDED.tags,
      metadata = EXCLUDED.metadata,
      last_receipt_id = COALESCE(EXCLUDED.last_receipt_id, public.pantry_items.last_receipt_id),
      source = COALESCE(EXCLUDED.source, public.pantry_items.source),
      template_confirmed = COALESCE(
        EXCLUDED.template_confirmed, public.pantry_items.template_confirmed
      ),
      updated_at = now()
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.pantry_items (
      user_id, household_id, base_ingredient, variant, unit, normalized_name,
      quantity, product_type, category, tags, metadata, last_receipt_id,
      source, template_confirmed
    )
    VALUES (
      v_user_id,
      NULL,
      p_item->>'base_ingredient',
      v_variant,
      v_unit,
      p_item->>'normalized_name',
      COALESCE((p_item->>'quantity')::numeric, 1),
      NULLIF(trim(p_item->>'product_type'), ''),
      NULLIF(trim(p_item->>'category'), ''),
      v_tags,
      COALESCE(p_item->'metadata', '{}'::jsonb),
      v_last_receipt,
      v_source,
      v_template_confirmed
    )
    ON CONFLICT (user_id, base_ingredient, variant, unit)
      WHERE household_id IS NULL AND deleted_at IS NULL
    DO UPDATE SET
      normalized_name = EXCLUDED.normalized_name,
      quantity = EXCLUDED.quantity,
      product_type = COALESCE(EXCLUDED.product_type, public.pantry_items.product_type),
      category = COALESCE(EXCLUDED.category, public.pantry_items.category),
      tags = EXCLUDED.tags,
      metadata = EXCLUDED.metadata,
      last_receipt_id = COALESCE(EXCLUDED.last_receipt_id, public.pantry_items.last_receipt_id),
      source = COALESCE(EXCLUDED.source, public.pantry_items.source),
      template_confirmed = COALESCE(
        EXCLUDED.template_confirmed, public.pantry_items.template_confirmed
      ),
      updated_at = now()
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.upsert_pantry_item(jsonb) IS
  'Upsert active pantry row using partial unique indexes; service_role only.';

REVOKE ALL ON FUNCTION public.upsert_pantry_item(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_pantry_item(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_pantry_item(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_pantry_item(jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Membership helpers — empty search_path
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_household_member(p_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
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
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.household_members
    WHERE household_id = p_household_id
      AND user_id = (SELECT auth.uid())
      AND role = 'owner'
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. Lock-down RPCs — empty search_path + qualified tables
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.store_receipt_with_items(
  p_receipt jsonb,
  p_items   jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt_id uuid;
  v_item       jsonb;
  v_caller     uuid := (SELECT auth.uid());
  v_user_id    uuid := (p_receipt->>'user_id')::uuid;
BEGIN
  IF v_caller IS NOT NULL AND v_user_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'forbidden: receipt user_id does not match caller';
  END IF;

  INSERT INTO public.receipts (
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
      INSERT INTO public.receipt_items (
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

CREATE OR REPLACE FUNCTION public.soft_delete_pantry_item(
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
SET search_path = ''
AS $$
DECLARE
  v_hist_id uuid;
  v_updated int;
  v_caller uuid := (SELECT auth.uid());
BEGIN
  IF v_caller IS NOT NULL AND p_user_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'forbidden: pantry user_id does not match caller';
  END IF;

  UPDATE public.pantry_items
  SET deleted_at = p_deleted_at
  WHERE id = p_pantry_item_id
    AND user_id = p_user_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'pantry item not found, wrong user, or already deleted';
  END IF;

  INSERT INTO public.depletion_history (
    user_id, pantry_item_id, item_name, depletion_class, purchase_date,
    deleted_at, reason, days_in_pantry, was_cooked, put_back_count
  ) VALUES (
    p_user_id, p_pantry_item_id, p_item_name, p_depletion_class, p_purchase_date,
    p_deleted_at, p_reason, p_days_in_pantry, p_was_cooked, p_put_back_count
  )
  RETURNING id INTO v_hist_id;

  RETURN v_hist_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_ai_processing(
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
SET search_path = ''
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

    INSERT INTO public.ai_processing_log (
        operation, model, input_tokens, output_tokens, total_tokens,
        estimated_cost, duration_ms, success, error_message,
        user_id, receipt_id, items_processed,
        request_metadata, response_metadata
    ) VALUES (
        p_operation, p_model, p_input_tokens, p_output_tokens, v_total_tokens,
        v_estimated_cost, p_duration_ms, p_success, p_error_message,
        p_user_id, p_receipt_id, p_items_processed,
        p_request_metadata, p_response_metadata
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- Re-apply EXECUTE grants (CREATE OR REPLACE resets to default privileges)
REVOKE ALL ON FUNCTION public.store_receipt_with_items(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_receipt_with_items(jsonb, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.soft_delete_pantry_item(
  uuid, uuid, text, text, date, timestamptz, text, integer, boolean, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_pantry_item(
  uuid, uuid, text, text, date, timestamptz, text, integer, boolean, integer
) TO service_role;

REVOKE ALL ON FUNCTION public.log_ai_processing(
  text, text, integer, integer, integer, boolean, text, uuid, uuid, integer, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_ai_processing(
  text, text, integer, integer, integer, boolean, text, uuid, uuid, integer, jsonb, jsonb
) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. households.created_by — allow auth user deletion
-- ----------------------------------------------------------------------------

ALTER TABLE public.households
  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.households
  DROP CONSTRAINT IF EXISTS households_created_by_fkey;

ALTER TABLE public.households
  ADD CONSTRAINT households_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
