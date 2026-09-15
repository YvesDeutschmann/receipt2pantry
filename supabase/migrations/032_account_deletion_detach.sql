-- Account deletion: allow pantry cascade through depletion_history; transactional household detach.

-- ----------------------------------------------------------------------------
-- 1. depletion_history.pantry_item_id — ON DELETE CASCADE (was RESTRICT)
-- ----------------------------------------------------------------------------

ALTER TABLE public.depletion_history
  DROP CONSTRAINT IF EXISTS depletion_history_pantry_item_id_fkey;

ALTER TABLE public.depletion_history
  ADD CONSTRAINT depletion_history_pantry_item_id_fkey
  FOREIGN KEY (pantry_item_id) REFERENCES public.pantry_items (id) ON DELETE CASCADE;

-- ----------------------------------------------------------------------------
-- 2. detach_user_for_account_deletion — service_role only
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.detach_user_for_account_deletion(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_household_id uuid;
  v_member_count integer;
  v_successor_id uuid;
  v_was_owner boolean;
  v_promoted boolean := false;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'none';
  END IF;

  -- Household from membership or leftover scoped rows
  SELECT h.id
  INTO v_household_id
  FROM public.households h
  WHERE h.id IN (
    SELECT hm.household_id FROM public.household_members hm WHERE hm.user_id = p_user_id
    UNION
    SELECT pi.household_id FROM public.pantry_items pi
      WHERE pi.user_id = p_user_id AND pi.household_id IS NOT NULL
    UNION
    SELECT r.household_id FROM public.receipts r
      WHERE r.user_id = p_user_id AND r.household_id IS NOT NULL
  )
  ORDER BY h.created_at
  LIMIT 1
  FOR UPDATE;

  IF v_household_id IS NULL THEN
    RETURN 'none';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_member_count
  FROM public.household_members hm
  WHERE hm.household_id = v_household_id;

  -- Sole member deleting their account: remove the whole household.
  IF v_member_count = 1 AND EXISTS (
    SELECT 1 FROM public.household_members hm
    WHERE hm.household_id = v_household_id AND hm.user_id = p_user_id
  ) THEN
    DELETE FROM public.households WHERE id = v_household_id;
    RETURN 'deleted';
  END IF;

  -- Orphan household (no members left): delete it.
  IF v_member_count = 0 THEN
    DELETE FROM public.households WHERE id = v_household_id;
    RETURN 'deleted';
  END IF;

  -- Successor: current owner if not departing, else earliest other member
  SELECT hm.user_id
  INTO v_successor_id
  FROM public.household_members hm
  WHERE hm.household_id = v_household_id
    AND hm.role = 'owner'
    AND hm.user_id <> p_user_id
  LIMIT 1;

  IF v_successor_id IS NULL THEN
    SELECT hm.user_id
    INTO v_successor_id
    FROM public.household_members hm
    WHERE hm.household_id = v_household_id
      AND hm.user_id <> p_user_id
    ORDER BY hm.joined_at ASC
    LIMIT 1;
  END IF;

  IF v_successor_id IS NULL THEN
    DELETE FROM public.households WHERE id = v_household_id;
    RETURN 'deleted';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.household_members hm
    WHERE hm.household_id = v_household_id
      AND hm.user_id = p_user_id
      AND hm.role = 'owner'
  ) INTO v_was_owner;

  IF v_was_owner THEN
    UPDATE public.household_members
    SET role = 'owner'
    WHERE household_id = v_household_id AND user_id = v_successor_id;
    v_promoted := true;
  END IF;

  -- Drop departing rows that would violate unique constraints after reassignment
  DELETE FROM public.receipts r1
  WHERE r1.user_id = p_user_id
    AND r1.household_id = v_household_id
    AND EXISTS (
      SELECT 1 FROM public.receipts r2
      WHERE r2.user_id = v_successor_id
        AND r2.provider = r1.provider
        AND r2.order_id = r1.order_id
    );

  DELETE FROM public.suggestion_pool sp1
  WHERE sp1.user_id = p_user_id
    AND sp1.household_id = v_household_id
    AND EXISTS (
      SELECT 1 FROM public.suggestion_pool sp2
      WHERE sp2.household_id = v_household_id
        AND sp2.recipe_id = sp1.recipe_id
        AND sp2.user_id <> p_user_id
    );

  DELETE FROM public.pantry_items p1
  WHERE p1.user_id = p_user_id
    AND p1.household_id = v_household_id
    AND p1.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.pantry_items p2
      WHERE p2.household_id = v_household_id
        AND p2.base_ingredient = p1.base_ingredient
        AND COALESCE(p2.variant, '') = COALESCE(p1.variant, '')
        AND COALESCE(p2.unit, '') = COALESCE(p1.unit, '')
        AND p2.deleted_at IS NULL
        AND p2.user_id <> p_user_id
    );

  DELETE FROM public.meal_plan mp1
  WHERE mp1.user_id = p_user_id
    AND mp1.household_id = v_household_id
    AND EXISTS (
      SELECT 1 FROM public.meal_plan mp2
      WHERE mp2.household_id = v_household_id
        AND mp2.meal_date = mp1.meal_date
        AND mp2.meal_type = mp1.meal_type
        AND mp2.user_id <> p_user_id
    );

  UPDATE public.pantry_items
  SET user_id = v_successor_id
  WHERE user_id = p_user_id AND household_id = v_household_id;

  UPDATE public.receipts
  SET user_id = v_successor_id
  WHERE user_id = p_user_id AND household_id = v_household_id;

  UPDATE public.receipt_items ri
  SET user_id = v_successor_id
  FROM public.receipts r
  WHERE ri.receipt_id = r.id
    AND r.household_id = v_household_id
    AND ri.user_id = p_user_id;

  UPDATE public.cooking_log
  SET user_id = v_successor_id
  WHERE user_id = p_user_id AND household_id = v_household_id;

  UPDATE public.meal_plan
  SET user_id = v_successor_id
  WHERE user_id = p_user_id AND household_id = v_household_id;

  UPDATE public.meal_plan_wizard_session
  SET user_id = v_successor_id
  WHERE user_id = p_user_id AND household_id = v_household_id;

  UPDATE public.pool_generation
  SET user_id = v_successor_id
  WHERE user_id = p_user_id AND household_id = v_household_id;

  UPDATE public.suggestion_pool
  SET user_id = v_successor_id
  WHERE user_id = p_user_id AND household_id = v_household_id;

  DELETE FROM public.household_members
  WHERE household_id = v_household_id AND user_id = p_user_id;

  IF v_promoted THEN
    RETURN 'promoted';
  END IF;
  RETURN 'left';
END;
$$;

REVOKE ALL ON FUNCTION public.detach_user_for_account_deletion(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.detach_user_for_account_deletion(uuid)
  TO service_role;

COMMENT ON FUNCTION public.detach_user_for_account_deletion(uuid) IS
  'Reassign or delete household data before auth user deletion. service_role only.';
