-- Pre-select pantry items needed for staple dinner recipes (alongside existing 6 defaults).

UPDATE staples_template
SET pre_selected = true
WHERE base_ingredient IN (
  'pasta',
  'white rice',
  'canned tomatoes',
  'canned black beans'
);
