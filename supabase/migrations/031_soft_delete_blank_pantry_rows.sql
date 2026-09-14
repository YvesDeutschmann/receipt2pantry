-- One-shot cleanup: soft-delete live pantry rows with no display name.
-- No depletion_history write (graveyard stays clean); ingest reject prevents resurrect.

UPDATE pantry_items
SET deleted_at = now()
WHERE deleted_at IS NULL
  AND btrim(coalesce(base_ingredient, '')) = ''
  AND btrim(coalesce(normalized_name, '')) = '';
