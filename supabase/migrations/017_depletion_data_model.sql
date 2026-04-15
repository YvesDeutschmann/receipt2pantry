-- Depletion Phase 1: data model (item_classification, depletion_history, purchase_history, user_preferences)
-- Extends pantry_items and receipts. No stored confidence column (confidence_override is allowed).

-- ============================================================================
-- RECEIPTS: import audit fields (maps to receipt_imports from design doc)
-- ============================================================================

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS parse_errors JSONB,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PROCESSED'
    CHECK (status IN ('PENDING', 'PROCESSED', 'FAILED'));

COMMENT ON COLUMN receipts.parse_errors IS 'Receipt line items that failed normalization during import';
COMMENT ON COLUMN receipts.status IS 'Import processing status for depletion pipeline';

CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts (user_id, status);

-- ============================================================================
-- PANTRY_ITEMS: expand source check + depletion columns
-- ============================================================================

ALTER TABLE pantry_items DROP CONSTRAINT IF EXISTS pantry_items_source_check;

ALTER TABLE pantry_items
  ADD CONSTRAINT pantry_items_source_check
  CHECK (
    source IS NULL
    OR source IN ('receipt_import', 'template', 'search', 'voice', 'manual_add')
  );

COMMENT ON COLUMN pantry_items.source IS 'How the item was added: receipt_import, template, search, voice, manual_add';

ALTER TABLE pantry_items
  ADD COLUMN IF NOT EXISTS depletion_class TEXT
    CHECK (depletion_class IS NULL OR depletion_class IN ('PERISHABLE', 'CONSUMABLE', 'STAPLE', 'UNIT_ITEM')),
  ADD COLUMN IF NOT EXISTS quantity_purchased DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS quantity_remaining DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER,
  ADD COLUMN IF NOT EXISTS available_until DATE,
  ADD COLUMN IF NOT EXISTS estimated_depletion_date DATE,
  ADD COLUMN IF NOT EXISTS hard_expire_date DATE,
  ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS frozen_expire_date DATE,
  ADD COLUMN IF NOT EXISTS use_soon BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS use_soon_expires DATE,
  ADD COLUMN IF NOT EXISTS put_back_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_known BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS confidence_override DECIMAL(3, 2),
  ADD COLUMN IF NOT EXISTS confidence_override_expires DATE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN pantry_items.quantity_remaining IS 'NULL until cook event decrements; NULL means full purchase quantity (untracked)';
COMMENT ON COLUMN pantry_items.confidence_override IS 'User-initiated override (Health Card / put-back); not stored computed confidence';
COMMENT ON COLUMN pantry_items.deleted_at IS 'Soft delete only; never hard-delete pantry rows';

CREATE INDEX IF NOT EXISTS idx_pantry_items_depletion_class ON pantry_items (depletion_class);
CREATE INDEX IF NOT EXISTS idx_pantry_items_hard_expire_date ON pantry_items (hard_expire_date);
CREATE INDEX IF NOT EXISTS idx_pantry_items_use_soon ON pantry_items (use_soon);
CREATE INDEX IF NOT EXISTS idx_pantry_items_deleted_at ON pantry_items (deleted_at);

DROP TRIGGER IF EXISTS update_pantry_items_updated_at ON pantry_items;
CREATE TRIGGER update_pantry_items_updated_at
  BEFORE UPDATE ON pantry_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ITEM_CLASSIFICATION: static lookup (~200+ rows from canonical vocabulary)
-- ============================================================================

CREATE TABLE IF NOT EXISTS item_classification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name TEXT NOT NULL,
  depletion_class TEXT NOT NULL
    CHECK (depletion_class IN ('PERISHABLE', 'CONSUMABLE', 'STAPLE', 'UNIT_ITEM')),
  sub_class TEXT,
  shelf_life_days INTEGER,
  grace_buffer_days INTEGER,
  default_days_supply INTEGER,
  spoonacular_id TEXT,
  aisle TEXT,
  is_soft_required BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT item_classification_item_name_unique UNIQUE (item_name)
);

CREATE INDEX IF NOT EXISTS idx_item_classification_depletion_class ON item_classification (depletion_class);
CREATE INDEX IF NOT EXISTS idx_item_classification_sub_class ON item_classification (sub_class);

COMMENT ON TABLE item_classification IS 'Static depletion metadata per normalized item name; not user-specific';

ALTER TABLE item_classification ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read item_classification"
  ON item_classification FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role manages item_classification"
  ON item_classification FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Seed from canonical_ingredients: one row per base_ingredient (>=200 rows)
-- Spices & Seasonings -> CONSUMABLE, soft-required
INSERT INTO item_classification (
  item_name, depletion_class, sub_class, shelf_life_days, grace_buffer_days, default_days_supply, is_soft_required
)
SELECT
  c.base_ingredient,
  'CONSUMABLE',
  'spice',
  NULL,
  NULL,
  180,
  TRUE
FROM canonical_ingredients c
WHERE c.active = TRUE AND c.category = 'Spices & Seasonings'
ON CONFLICT (item_name) DO NOTHING;

-- Oils & Vinegars
INSERT INTO item_classification (
  item_name, depletion_class, sub_class, shelf_life_days, grace_buffer_days, default_days_supply, is_soft_required
)
SELECT
  c.base_ingredient,
  'CONSUMABLE',
  'oil_vinegar',
  NULL,
  NULL,
  CASE
    WHEN c.base_ingredient LIKE '%vinegar%' THEN 90
    ELSE 45
  END,
  FALSE
FROM canonical_ingredients c
WHERE c.active = TRUE AND c.category = 'Oils & Vinegars'
ON CONFLICT (item_name) DO NOTHING;

-- Baking Basics (not spices)
INSERT INTO item_classification (
  item_name, depletion_class, sub_class, shelf_life_days, grace_buffer_days, default_days_supply, is_soft_required
)
SELECT
  c.base_ingredient,
  'CONSUMABLE',
  'baking',
  NULL,
  NULL,
  60,
  FALSE
FROM canonical_ingredients c
WHERE c.active = TRUE AND c.category = 'Baking Basics'
ON CONFLICT (item_name) DO NOTHING;

-- Grains & Pasta -> UNIT_ITEM
INSERT INTO item_classification (
  item_name, depletion_class, sub_class, shelf_life_days, grace_buffer_days, default_days_supply, is_soft_required
)
SELECT
  c.base_ingredient,
  'UNIT_ITEM',
  'grain_pasta',
  NULL,
  NULL,
  NULL,
  FALSE
FROM canonical_ingredients c
WHERE c.active = TRUE AND c.category = 'Grains & Pasta'
ON CONFLICT (item_name) DO NOTHING;

-- Produce -> PERISHABLE (leafy vs root vs default)
INSERT INTO item_classification (
  item_name, depletion_class, sub_class, shelf_life_days, grace_buffer_days, default_days_supply, is_soft_required
)
SELECT
  c.base_ingredient,
  'PERISHABLE',
  CASE
    WHEN c.base_ingredient IN (
      'spinach', 'kale', 'lettuce', 'arugula', 'mixed greens', 'spring mix'
    ) THEN 'leafy_green'
    WHEN c.base_ingredient IN (
      'potatoes', 'sweet potatoes', 'carrots', 'beets', 'turnips', 'parsnips', 'radishes'
    ) THEN 'root_vegetable'
    ELSE 'produce'
  END,
  CASE
    WHEN c.base_ingredient IN (
      'potatoes', 'sweet potatoes', 'carrots', 'beets', 'turnips', 'parsnips', 'radishes'
    ) THEN 14
    ELSE 5
  END,
  CASE
    WHEN c.base_ingredient IN (
      'potatoes', 'sweet potatoes', 'carrots', 'beets', 'turnips', 'parsnips', 'radishes'
    ) THEN 4
    ELSE 3
  END,
  NULL,
  FALSE
FROM canonical_ingredients c
WHERE c.active = TRUE AND c.category = 'Produce'
ON CONFLICT (item_name) DO NOTHING;

-- Dairy -> PERISHABLE (eggs, cheese, milk patterns)
INSERT INTO item_classification (
  item_name, depletion_class, sub_class, shelf_life_days, grace_buffer_days, default_days_supply, is_soft_required
)
SELECT
  c.base_ingredient,
  'PERISHABLE',
  CASE
    WHEN c.base_ingredient = 'eggs' THEN 'eggs'
    WHEN c.base_ingredient IN (
      'cheddar cheese', 'mozzarella', 'parmesan', 'feta cheese', 'goat cheese', 'ricotta',
      'cottage cheese', 'cream cheese', 'ricotta salata'
    ) THEN 'hard_cheese'
    ELSE 'dairy'
  END,
  CASE
    WHEN c.base_ingredient = 'eggs' THEN 21
    WHEN c.base_ingredient IN (
      'cheddar cheese', 'mozzarella', 'parmesan', 'feta cheese', 'goat cheese', 'ricotta',
      'cottage cheese', 'cream cheese', 'ricotta salata'
    ) THEN 21
    ELSE 7
  END,
  CASE
    WHEN c.base_ingredient = 'eggs' THEN 5
    WHEN c.base_ingredient IN (
      'cheddar cheese', 'mozzarella', 'parmesan', 'feta cheese', 'goat cheese', 'ricotta',
      'cottage cheese', 'cream cheese', 'ricotta salata'
    ) THEN 7
    ELSE 2
  END,
  NULL,
  FALSE
FROM canonical_ingredients c
WHERE c.active = TRUE AND c.category = 'Dairy'
ON CONFLICT (item_name) DO NOTHING;

-- Meat & Seafood -> PERISHABLE (tofu/tempeh: produce-like shelf, not raw meat)
INSERT INTO item_classification (
  item_name, depletion_class, sub_class, shelf_life_days, grace_buffer_days, default_days_supply, is_soft_required
)
SELECT
  c.base_ingredient,
  'PERISHABLE',
  CASE
    WHEN c.base_ingredient IN ('tofu', 'tempeh') THEN 'plant_protein'
    WHEN c.base_ingredient IN (
      'salmon', 'tuna', 'cod', 'tilapia', 'shrimp', 'clams', 'mussels', 'scallops', 'squid', 'anchovies'
    ) THEN 'raw_fish'
    WHEN c.base_ingredient IN ('ground beef', 'ground turkey', 'ground pork', 'ground lamb') THEN 'ground_meat'
    ELSE 'raw_meat'
  END,
  CASE
    WHEN c.base_ingredient IN ('tofu', 'tempeh') THEN 5
    WHEN c.base_ingredient IN ('ground beef', 'ground turkey', 'ground pork', 'ground lamb') THEN 2
    ELSE 3
  END,
  CASE
    WHEN c.base_ingredient IN ('tofu', 'tempeh') THEN 3
    WHEN c.base_ingredient IN ('ground beef', 'ground turkey', 'ground pork', 'ground lamb') THEN 1
    ELSE 1
  END,
  NULL,
  FALSE
FROM canonical_ingredients c
WHERE c.active = TRUE AND c.category = 'Meat & Seafood'
  AND c.base_ingredient != 'tuna'
ON CONFLICT (item_name) DO NOTHING;

-- tuna: canned_goods UNIT_ITEM (canonical_ingredients aliases it as 'canned tuna' / 'tuna canned')
INSERT INTO item_classification (
  item_name, depletion_class, sub_class, shelf_life_days, grace_buffer_days,
  default_days_supply, is_soft_required
) VALUES
  ('tuna', 'UNIT_ITEM', 'canned_goods', NULL, NULL, NULL, FALSE)
ON CONFLICT (item_name) DO NOTHING;

-- Canned & Jarred: canned goods UNIT_ITEM; sauces/condiments CONSUMABLE
INSERT INTO item_classification (
  item_name, depletion_class, sub_class, shelf_life_days, grace_buffer_days, default_days_supply, is_soft_required
)
SELECT
  c.base_ingredient,
  CASE
    WHEN c.base_ingredient IN (
      'canned tomatoes', 'canned chickpeas', 'canned black beans', 'canned kidney beans',
      'canned white beans', 'coconut milk', 'coconut cream', 'corn', 'pumpkin puree', 'applesauce',
      'pickles', 'capers', 'olives', 'sun-dried tomatoes', 'roasted red peppers', 'artichoke hearts',
      'green chiles', 'enchilada sauce', 'tomato paste', 'tomato sauce'
    ) THEN 'UNIT_ITEM'
    ELSE 'CONSUMABLE'
  END,
  CASE
    WHEN c.base_ingredient IN (
      'canned tomatoes', 'canned chickpeas', 'canned black beans', 'canned kidney beans',
      'canned white beans', 'coconut milk', 'coconut cream', 'corn', 'pumpkin puree', 'applesauce',
      'pickles', 'capers', 'olives', 'sun-dried tomatoes', 'roasted red peppers', 'artichoke hearts',
      'green chiles', 'enchilada sauce', 'tomato paste', 'tomato sauce'
    ) THEN 'canned_goods'
    WHEN c.base_ingredient IN ('soy sauce', 'fish sauce', 'oyster sauce', 'hoisin sauce', 'worcestershire sauce') THEN 'sauce_long'
    WHEN c.base_ingredient IN ('ketchup', 'bbq sauce', 'mayonnaise', 'yellow mustard', 'dijon mustard') THEN 'condiment'
    WHEN c.base_ingredient IN ('miso paste', 'gochujang', 'tahini', 'peanut butter', 'almond butter', 'jam') THEN 'spread'
    ELSE 'pantry_condiment'
  END,
  NULL,
  NULL,
  CASE
    WHEN c.base_ingredient IN (
      'canned tomatoes', 'canned chickpeas', 'canned black beans', 'canned kidney beans',
      'canned white beans', 'coconut milk', 'coconut cream', 'corn', 'pumpkin puree', 'applesauce',
      'pickles', 'capers', 'olives', 'sun-dried tomatoes', 'roasted red peppers', 'artichoke hearts',
      'green chiles', 'enchilada sauce', 'tomato paste', 'tomato sauce'
    ) THEN NULL
    WHEN c.base_ingredient = 'soy sauce' THEN 90
    WHEN c.base_ingredient = 'ketchup' THEN 60
    WHEN c.base_ingredient IN ('hot sauce', 'sriracha', 'fish sauce', 'oyster sauce', 'hoisin sauce') THEN 90
    ELSE 60
  END,
  FALSE
FROM canonical_ingredients c
WHERE c.active = TRUE AND c.category = 'Canned & Jarred'
ON CONFLICT (item_name) DO NOTHING;

-- International -> mostly CONSUMABLE; wrappers/noodles UNIT_ITEM
INSERT INTO item_classification (
  item_name, depletion_class, sub_class, shelf_life_days, grace_buffer_days, default_days_supply, is_soft_required
)
SELECT
  c.base_ingredient,
  CASE
    WHEN c.base_ingredient IN (
      'wonton wrappers', 'rice paper', 'udon noodles', 'ramen noodles', 'soba noodles',
      'naan', 'pita bread', 'phyllo dough', 'puff pastry', 'pie crust', 'vermicelli'
    ) THEN 'UNIT_ITEM'
    ELSE 'CONSUMABLE'
  END,
  'international',
  NULL,
  NULL,
  CASE
    WHEN c.base_ingredient IN (
      'wonton wrappers', 'rice paper', 'udon noodles', 'ramen noodles', 'soba noodles',
      'naan', 'pita bread', 'phyllo dough', 'puff pastry', 'pie crust', 'vermicelli'
    ) THEN NULL
    ELSE 60
  END,
  FALSE
FROM canonical_ingredients c
WHERE c.active = TRUE AND c.category = 'International'
ON CONFLICT (item_name) DO NOTHING;

-- Snacks -> CONSUMABLE (long shelf)
INSERT INTO item_classification (
  item_name, depletion_class, sub_class, shelf_life_days, grace_buffer_days, default_days_supply, is_soft_required
)
SELECT
  c.base_ingredient,
  'CONSUMABLE',
  'snack',
  NULL,
  NULL,
  120,
  FALSE
FROM canonical_ingredients c
WHERE c.active = TRUE AND c.category = 'Snacks'
ON CONFLICT (item_name) DO NOTHING;

-- Pantry (misc dry goods)
INSERT INTO item_classification (
  item_name, depletion_class, sub_class, shelf_life_days, grace_buffer_days, default_days_supply, is_soft_required
)
SELECT
  c.base_ingredient,
  'CONSUMABLE',
  'pantry',
  NULL,
  NULL,
  CASE
    WHEN c.base_ingredient IN ('coffee beans', 'instant coffee') THEN 21
    WHEN c.base_ingredient = 'tea' THEN 180
    ELSE 90
  END,
  FALSE
FROM canonical_ingredients c
WHERE c.active = TRUE AND c.category = 'Pantry'
ON CONFLICT (item_name) DO NOTHING;

-- STAPLE rows for generic / unknown import fallback (explicit)
INSERT INTO item_classification (
  item_name, depletion_class, sub_class, shelf_life_days, grace_buffer_days, default_days_supply, is_soft_required
) VALUES
  ('unclassified pantry item', 'STAPLE', 'unknown', NULL, NULL, NULL, FALSE),
  ('miscellaneous ingredient', 'STAPLE', 'unknown', NULL, NULL, NULL, FALSE)
ON CONFLICT (item_name) DO NOTHING;

-- ============================================================================
-- DEPLETION_HISTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS depletion_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  pantry_item_id UUID NOT NULL REFERENCES pantry_items (id) ON DELETE RESTRICT,
  item_name TEXT NOT NULL,
  depletion_class TEXT NOT NULL
    CHECK (depletion_class IN ('PERISHABLE', 'CONSUMABLE', 'STAPLE', 'UNIT_ITEM')),
  purchase_date DATE,
  deleted_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL
    CHECK (reason IN ('AUTO_EXPIRED', 'COOKED', 'USER_REMOVED', 'OVERRIDE')),
  days_in_pantry INTEGER,
  was_cooked BOOLEAN NOT NULL DEFAULT FALSE,
  put_back_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_depletion_history_user_id ON depletion_history (user_id);
CREATE INDEX IF NOT EXISTS idx_depletion_history_item_name ON depletion_history (item_name);
CREATE INDEX IF NOT EXISTS idx_depletion_history_deleted_at ON depletion_history (deleted_at);
CREATE INDEX IF NOT EXISTS idx_depletion_history_reason ON depletion_history (reason);

COMMENT ON TABLE depletion_history IS 'Append-only log of removed pantry items; never delete rows';

ALTER TABLE depletion_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own depletion_history"
  ON depletion_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own depletion_history"
  ON depletion_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- PURCHASE_HISTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  purchase_date DATE NOT NULL,
  quantity_purchased DECIMAL(10, 2),
  quantity_unit TEXT,
  source_retailer TEXT,
  days_since_last_purchase INTEGER,
  receipt_import_id UUID REFERENCES receipts (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_purchase_history_user_id ON purchase_history (user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_history_item_name ON purchase_history (item_name);
CREATE INDEX IF NOT EXISTS idx_purchase_history_purchase_date ON purchase_history (purchase_date DESC);

COMMENT ON TABLE purchase_history IS 'One row per import event per item for re-purchase calibration';

ALTER TABLE purchase_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own purchase_history"
  ON purchase_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own purchase_history"
  ON purchase_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- USER_PREFERENCES (depletion tuning)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  household_size TEXT NOT NULL DEFAULT 'TWO'
    CHECK (household_size IN ('ONE', 'TWO', 'THREE_PLUS')),
  depletion_multiplier DECIMAL(3, 1) NOT NULL DEFAULT 1.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE user_preferences IS 'Per-user depletion tuning; household_size maps to depletion_multiplier at onboarding';

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own user_preferences"
  ON user_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own user_preferences"
  ON user_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own user_preferences"
  ON user_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PHASE 1 TEST FIXTURES (A–J) — test user + household from 010_create_test_user.sql
-- ============================================================================

-- A: chicken breast, 5d ago, put_back=0
-- NOTE: hard_expire_date is intentionally in the past (purchase_date-5 + shelf_life_days-3 + grace-1 = yesterday).
-- This represents a pre-cleanup state. Phase 2 run_expiry_cleanup will soft-delete this row.
-- Put-back tests must run cleanup first or insert their own depletion_history entries.
INSERT INTO pantry_items (
  id, user_id, household_id, base_ingredient, normalized_name, variant, unit,
  quantity, source, purchase_date,
  depletion_class, quantity_purchased, quantity_remaining, shelf_life_days,
  available_until, hard_expire_date, is_frozen, put_back_count, quantity_known
) VALUES (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'chicken breast',
  'chicken breast',
  'fixture_a',
  'lb',
  1,
  'receipt_import',
  (CURRENT_DATE - 5)::timestamptz,
  'PERISHABLE',
  1,
  NULL,
  3,
  CURRENT_DATE - 2,
  CURRENT_DATE - 1,
  FALSE,
  0,
  TRUE
) ON CONFLICT (id) DO NOTHING;

-- B: chicken breast, 5d ago, put_back=1
-- NOTE: hard_expire_date is intentionally in the past (same as Fixture A).
-- put_back_count=1 means this item has already been resurrected once; a second put-back must be blocked.
-- Phase 2 put-back tests must run cleanup first or insert their own depletion_history entries.
INSERT INTO pantry_items (
  id, user_id, household_id, base_ingredient, normalized_name, variant, unit,
  quantity, source, purchase_date,
  depletion_class, quantity_purchased, quantity_remaining, shelf_life_days,
  available_until, hard_expire_date, is_frozen, put_back_count, quantity_known
) VALUES (
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'chicken breast',
  'chicken breast',
  'fixture_b',
  'lb',
  1,
  'receipt_import',
  (CURRENT_DATE - 5)::timestamptz,
  'PERISHABLE',
  1,
  NULL,
  3,
  CURRENT_DATE - 2,
  CURRENT_DATE - 1,
  FALSE,
  1,
  TRUE
) ON CONFLICT (id) DO NOTHING;

-- C: spinach, 3d ago (fresh)
INSERT INTO pantry_items (
  id, user_id, household_id, base_ingredient, normalized_name, variant, unit,
  quantity, source, purchase_date,
  depletion_class, quantity_purchased, quantity_remaining, shelf_life_days,
  available_until, hard_expire_date, is_frozen, put_back_count, quantity_known
) VALUES (
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'spinach',
  'spinach',
  'fixture_c',
  'bag',
  1,
  'receipt_import',
  (CURRENT_DATE - 3)::timestamptz,
  'PERISHABLE',
  1,
  NULL,
  5,
  CURRENT_DATE + 2,
  CURRENT_DATE + 5,
  FALSE,
  0,
  TRUE
) ON CONFLICT (id) DO NOTHING;

-- D: spinach, 10d ago (past hard expiry, not soft-deleted yet)
INSERT INTO pantry_items (
  id, user_id, household_id, base_ingredient, normalized_name, variant, unit,
  quantity, source, purchase_date,
  depletion_class, quantity_purchased, quantity_remaining, shelf_life_days,
  available_until, hard_expire_date, is_frozen, put_back_count, quantity_known
) VALUES (
  '00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'spinach',
  'spinach',
  'fixture_d',
  'bag',
  1,
  'receipt_import',
  (CURRENT_DATE - 10)::timestamptz,
  'PERISHABLE',
  1,
  NULL,
  5,
  CURRENT_DATE - 5,
  CURRENT_DATE - 2,
  FALSE,
  0,
  TRUE
) ON CONFLICT (id) DO NOTHING;

-- E: olive oil, 20d ago, first purchase
INSERT INTO pantry_items (
  id, user_id, household_id, base_ingredient, normalized_name, variant, unit,
  quantity, source, purchase_date,
  depletion_class, quantity_purchased, quantity_remaining,
  estimated_depletion_date, hard_expire_date, put_back_count, quantity_known
) VALUES (
  '00000000-0000-0000-0000-0000000000e1',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'olive oil',
  'olive oil',
  'fixture_e',
  'bottle',
  1,
  'receipt_import',
  (CURRENT_DATE - 20)::timestamptz,
  'CONSUMABLE',
  1,
  NULL,
  CURRENT_DATE + 25,
  NULL,
  0,
  TRUE
) ON CONFLICT (id) DO NOTHING;

-- F: olive oil + purchase history (2 prior purchases + current, each 45 days apart)
INSERT INTO pantry_items (
  id, user_id, household_id, base_ingredient, normalized_name, variant, unit,
  quantity, source, purchase_date,
  depletion_class, quantity_purchased, quantity_remaining,
  estimated_depletion_date, hard_expire_date, put_back_count, quantity_known
) VALUES (
  '00000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'olive oil',
  'olive oil',
  'fixture_f',
  'bottle',
  1,
  'receipt_import',
  (CURRENT_DATE - 20)::timestamptz,
  'CONSUMABLE',
  1,
  NULL,
  CURRENT_DATE + 25,
  NULL,
  0,
  TRUE
) ON CONFLICT (id) DO NOTHING;

INSERT INTO purchase_history (
  id, user_id, item_name, purchase_date, quantity_purchased, quantity_unit,
  source_retailer, days_since_last_purchase
) VALUES
  (
    '00000000-0000-0000-0000-000000000f01',
    '00000000-0000-0000-0000-000000000001',
    'olive oil',
    CURRENT_DATE - 110,
    1,
    'bottle',
    'costco',
    NULL
  ),
  (
    '00000000-0000-0000-0000-000000000f02',
    '00000000-0000-0000-0000-000000000001',
    'olive oil',
    CURRENT_DATE - 65,
    1,
    'bottle',
    'costco',
    45
  ),
  (
    '00000000-0000-0000-0000-000000000f03',
    '00000000-0000-0000-0000-000000000001',
    'olive oil',
    CURRENT_DATE - 20,
    1,
    'bottle',
    'safeway',
    45
  )
ON CONFLICT (id) DO NOTHING;

-- G: paprika manual, unknown quantity
INSERT INTO pantry_items (
  id, user_id, household_id, base_ingredient, normalized_name, variant, unit,
  quantity, source, purchase_date,
  depletion_class, quantity_purchased, quantity_remaining, hard_expire_date,
  put_back_count, quantity_known
) VALUES (
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'paprika',
  'paprika',
  'fixture_g',
  'jar',
  1,
  'manual_add',
  NULL,
  'STAPLE',
  NULL,
  NULL,
  NULL,
  0,
  FALSE
) ON CONFLICT (id) DO NOTHING;

-- H: canned chickpeas full
INSERT INTO pantry_items (
  id, user_id, household_id, base_ingredient, normalized_name, variant, unit,
  quantity, source, purchase_date,
  depletion_class, quantity_purchased, quantity_remaining, hard_expire_date,
  put_back_count, quantity_known
) VALUES (
  '00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'canned chickpeas',
  'canned chickpeas',
  'fixture_h',
  'can',
  2,
  'receipt_import',
  (CURRENT_DATE - 7)::timestamptz,
  'UNIT_ITEM',
  2,
  NULL,
  NULL,
  0,
  TRUE
) ON CONFLICT (id) DO NOTHING;

-- I: canned chickpeas partial
INSERT INTO pantry_items (
  id, user_id, household_id, base_ingredient, normalized_name, variant, unit,
  quantity, source, purchase_date,
  depletion_class, quantity_purchased, quantity_remaining, hard_expire_date,
  put_back_count, quantity_known
) VALUES (
  '00000000-0000-0000-0000-000000000013',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'canned chickpeas',
  'canned chickpeas',
  'fixture_i',
  'can',
  2,
  'receipt_import',
  (CURRENT_DATE - 7)::timestamptz,
  'UNIT_ITEM',
  2,
  0.5,
  NULL,
  0,
  TRUE
) ON CONFLICT (id) DO NOTHING;

-- J: spinach soft-deleted + depletion_history (graveyard)
INSERT INTO pantry_items (
  id, user_id, household_id, base_ingredient, normalized_name, variant, unit,
  quantity, source, purchase_date,
  depletion_class, quantity_purchased, shelf_life_days,
  available_until, hard_expire_date, deleted_at, put_back_count, quantity_known
) VALUES (
  '00000000-0000-0000-0000-00000000010a',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'spinach',
  'spinach',
  'fixture_j',
  'bag',
  1,
  'receipt_import',
  (CURRENT_DATE - 12)::timestamptz,
  'PERISHABLE',
  1,
  5,
  CURRENT_DATE - 7,
  CURRENT_DATE - 4,
  CURRENT_DATE - 1,
  0,
  TRUE
) ON CONFLICT (id) DO NOTHING;

INSERT INTO depletion_history (
  id, user_id, pantry_item_id, item_name, depletion_class, purchase_date,
  deleted_at, reason, days_in_pantry, was_cooked, put_back_count
) VALUES (
  '00000000-0000-0000-0000-00000000010b',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-00000000010a',
  'spinach',
  'PERISHABLE',
  CURRENT_DATE - 12,
  CURRENT_DATE - 1,
  'AUTO_EXPIRED',
  11,
  FALSE,
  0
) ON CONFLICT (id) DO NOTHING;
