-- Atomic soft-delete + depletion_history insert (single transaction)
-- Used by run_expiry_cleanup and process_cook_event (UNIT_ITEM depleted).

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
BEGIN
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

COMMENT ON FUNCTION soft_delete_pantry_item(
  uuid, uuid, text, text, date, timestamptz, text, integer, boolean, integer
) IS
  'Atomically soft-deletes a pantry row and appends depletion_history; rolls back on failure.';

GRANT EXECUTE ON FUNCTION soft_delete_pantry_item(
  uuid, uuid, text, text, date, timestamptz, text, integer, boolean, integer
) TO service_role;
GRANT EXECUTE ON FUNCTION soft_delete_pantry_item(
  uuid, uuid, text, text, date, timestamptz, text, integer, boolean, integer
) TO authenticated;
