-- Pantry Layer 1: staples template + pantry provenance columns

-- ============================================================================
-- PANTRY_ITEMS: source, template confirmation, purchase date (receipt enrichment)
-- ============================================================================

ALTER TABLE pantry_items
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS template_confirmed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS purchase_date TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pantry_items_source_check'
  ) THEN
    ALTER TABLE pantry_items
      ADD CONSTRAINT pantry_items_source_check
      CHECK (
        source IS NULL
        OR source IN ('receipt_import', 'template', 'search', 'voice')
      );
  END IF;
END $$;

COMMENT ON COLUMN pantry_items.source IS 'How the item was added: receipt_import, template, search, voice';
COMMENT ON COLUMN pantry_items.template_confirmed IS 'User confirmed via staples template (may merge with receipt import)';
COMMENT ON COLUMN pantry_items.purchase_date IS 'Best-known purchase time from receipt data when matched';

CREATE INDEX IF NOT EXISTS idx_pantry_items_household_base
  ON pantry_items (household_id, base_ingredient)
  WHERE household_id IS NOT NULL;

-- ============================================================================
-- STAPLES TEMPLATE (CMS-style list; editable without app release)
-- ============================================================================

CREATE TABLE IF NOT EXISTS staples_template (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_ingredient TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  pre_selected BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT staples_template_base_ingredient_unique UNIQUE (base_ingredient)
);

CREATE INDEX IF NOT EXISTS idx_staples_template_category_sort
  ON staples_template (category, sort_order);

ALTER TABLE staples_template ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read staples template"
  ON staples_template FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE staples_template IS 'Cold-start pantry staples template rows (Layer 1)';

-- Seed 34 items (6 pre-selected per product brief; "Garlic" slot = garlic powder in list)
INSERT INTO staples_template (base_ingredient, display_name, category, sort_order, pre_selected) VALUES
  ('olive oil', 'Olive oil', 'Oils & Vinegars', 10, true),
  ('vegetable oil', 'Vegetable oil', 'Oils & Vinegars', 20, false),
  ('sesame oil', 'Sesame oil', 'Oils & Vinegars', 30, false),
  ('white wine vinegar', 'White wine vinegar', 'Oils & Vinegars', 40, false),
  ('apple cider vinegar', 'Apple cider vinegar', 'Oils & Vinegars', 50, false),
  ('balsamic vinegar', 'Balsamic vinegar', 'Oils & Vinegars', 60, false),

  ('all-purpose flour', 'All-purpose flour', 'Baking Basics', 10, true),
  ('sugar', 'Sugar', 'Baking Basics', 20, true),
  ('brown sugar', 'Brown sugar', 'Baking Basics', 30, false),
  ('baking powder', 'Baking powder', 'Baking Basics', 40, false),
  ('baking soda', 'Baking soda', 'Baking Basics', 50, false),
  ('vanilla extract', 'Vanilla extract', 'Baking Basics', 60, false),
  ('cornstarch', 'Cornstarch', 'Baking Basics', 70, false),

  ('salt', 'Salt', 'Spices & Seasonings', 10, true),
  ('black pepper', 'Black pepper', 'Spices & Seasonings', 20, true),
  ('garlic powder', 'Garlic powder', 'Spices & Seasonings', 30, true),
  ('onion powder', 'Onion powder', 'Spices & Seasonings', 40, false),
  ('cumin', 'Cumin', 'Spices & Seasonings', 50, false),
  ('paprika', 'Paprika', 'Spices & Seasonings', 60, false),
  ('chili flakes', 'Chili flakes', 'Spices & Seasonings', 70, false),
  ('dried oregano', 'Dried oregano', 'Spices & Seasonings', 80, false),
  ('cinnamon', 'Cinnamon', 'Spices & Seasonings', 90, false),

  ('canned tomatoes', 'Canned tomatoes', 'Canned & Jarred', 10, false),
  ('canned chickpeas', 'Canned chickpeas', 'Canned & Jarred', 20, false),
  ('canned black beans', 'Canned black beans', 'Canned & Jarred', 30, false),
  ('chicken broth', 'Chicken broth', 'Canned & Jarred', 40, false),
  ('vegetable broth', 'Vegetable broth', 'Canned & Jarred', 50, false),
  ('soy sauce', 'Soy sauce', 'Canned & Jarred', 60, false),
  ('dijon mustard', 'Dijon mustard', 'Canned & Jarred', 70, false),

  ('white rice', 'White rice', 'Grains & Pasta', 10, false),
  ('pasta', 'Pasta', 'Grains & Pasta', 20, false),
  ('dried lentils', 'Dried lentils', 'Grains & Pasta', 30, false),
  ('panko breadcrumbs', 'Panko breadcrumbs', 'Grains & Pasta', 40, false),
  ('oats', 'Oats', 'Grains & Pasta', 50, false)
ON CONFLICT (base_ingredient) DO NOTHING;
