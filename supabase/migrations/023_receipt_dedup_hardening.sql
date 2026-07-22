-- ==============================================================================
-- 01c.1: Receipt dedup hardening — user+provider scoped key, idempotent RPC
-- ==============================================================================

-- Replace global UNIQUE(order_id) with per-user, per-provider dedup key.
-- Safe on DBs that already satisfy the old global constraint (stricter).
ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_order_id_key;

ALTER TABLE receipts
  ADD CONSTRAINT receipts_user_provider_order_id_key
  UNIQUE (user_id, provider, order_id);

-- Idempotent upsert: ON CONFLICT DO NOTHING, return NULL for duplicates.
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
BEGIN
  INSERT INTO receipts (
    user_id, household_id, grocery_account_id, provider,
    order_id, order_date, total_amount, num_items,
    raw_data, fetched_at, created_at
  )
  VALUES (
    (p_receipt->>'user_id')::uuid,
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
        (v_item->>'user_id')::uuid,
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

COMMENT ON FUNCTION store_receipt_with_items(jsonb, jsonb) IS
  'Inserts a receipt and its items in a single transaction; returns NULL if duplicate (user_id, provider, order_id).';

GRANT EXECUTE ON FUNCTION store_receipt_with_items(jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION store_receipt_with_items(jsonb, jsonb) TO authenticated;
