-- Atomic union-merge for household dietary_restrictions (join onboarding path).

CREATE OR REPLACE FUNCTION public.merge_household_dietary_restrictions(
  p_household_id uuid,
  p_additions text[]
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing text[];
  v_result text[];
  v_add text;
BEGIN
  SELECT COALESCE(h.dietary_restrictions, ARRAY[]::text[])
  INTO v_existing
  FROM public.households h
  WHERE h.id = p_household_id;

  IF NOT FOUND THEN
    RETURN ARRAY[]::text[];
  END IF;

  v_result := v_existing;

  IF p_additions IS NULL OR array_length(p_additions, 1) IS NULL THEN
    RETURN v_result;
  END IF;

  FOREACH v_add IN ARRAY p_additions
  LOOP
    IF v_add IS NULL OR btrim(v_add) = '' THEN
      CONTINUE;
    END IF;
    IF NOT (v_add = ANY (v_result)) THEN
      v_result := array_append(v_result, v_add);
    END IF;
  END LOOP;

  UPDATE public.households
  SET dietary_restrictions = v_result,
      updated_at = NOW()
  WHERE id = p_household_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_household_dietary_restrictions(uuid, text[])
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.merge_household_dietary_restrictions(uuid, text[])
  TO service_role;
