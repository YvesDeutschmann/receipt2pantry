-- ==============================================================================
-- Pantry Trust Step 1: extend upsert_pantry_item RPC with depletion fields + backfill
-- ==============================================================================

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
      source, template_confirmed,
      depletion_class, purchase_date, available_until, quantity_purchased
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
      v_template_confirmed,
      NULLIF(trim(p_item->>'depletion_class'), ''),
      (p_item->>'purchase_date')::timestamptz,
      (p_item->>'available_until')::date,
      (p_item->>'quantity_purchased')::numeric
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
      depletion_class = COALESCE(public.pantry_items.depletion_class, EXCLUDED.depletion_class),
      purchase_date = COALESCE(public.pantry_items.purchase_date, EXCLUDED.purchase_date),
      available_until = COALESCE(public.pantry_items.available_until, EXCLUDED.available_until),
      quantity_purchased = COALESCE(public.pantry_items.quantity_purchased, EXCLUDED.quantity_purchased),
      updated_at = now()
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.pantry_items (
      user_id, household_id, base_ingredient, variant, unit, normalized_name,
      quantity, product_type, category, tags, metadata, last_receipt_id,
      source, template_confirmed,
      depletion_class, purchase_date, available_until, quantity_purchased
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
      v_template_confirmed,
      NULLIF(trim(p_item->>'depletion_class'), ''),
      (p_item->>'purchase_date')::timestamptz,
      (p_item->>'available_until')::date,
      (p_item->>'quantity_purchased')::numeric
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
      depletion_class = COALESCE(public.pantry_items.depletion_class, EXCLUDED.depletion_class),
      purchase_date = COALESCE(public.pantry_items.purchase_date, EXCLUDED.purchase_date),
      available_until = COALESCE(public.pantry_items.available_until, EXCLUDED.available_until),
      quantity_purchased = COALESCE(public.pantry_items.quantity_purchased, EXCLUDED.quantity_purchased),
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

-- Backfill existing rows (never touch quantity_remaining, hard_expire_date, deleted_at)

-- 1. depletion_class: NULL rows only
UPDATE pantry_items pi
SET depletion_class = COALESCE(ic.depletion_class, 'STAPLE')
FROM item_classification ic
WHERE pi.depletion_class IS NULL
  AND ic.item_name = pi.base_ingredient;

UPDATE pantry_items
SET depletion_class = 'STAPLE'
WHERE depletion_class IS NULL;

-- 2. purchase_date
UPDATE pantry_items
SET purchase_date = added_at
WHERE purchase_date IS NULL;

-- 3. available_until (PERISHABLE + shelf_life_days)
UPDATE pantry_items pi
SET available_until = (pi.purchase_date::date + ic.shelf_life_days)
FROM item_classification ic
WHERE pi.available_until IS NULL
  AND pi.depletion_class = 'PERISHABLE'
  AND ic.item_name = pi.base_ingredient
  AND ic.shelf_life_days IS NOT NULL
  AND pi.purchase_date IS NOT NULL;

-- 4. quantity_purchased
UPDATE pantry_items
SET quantity_purchased = quantity
WHERE quantity_purchased IS NULL;
