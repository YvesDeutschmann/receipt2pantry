-- Pantry Layer 2: canonical ingredient vocabulary for search-only adds

CREATE TABLE IF NOT EXISTS canonical_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_ingredient TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT,
  aliases TEXT[] DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT canonical_ingredients_base_unique UNIQUE (base_ingredient)
);

CREATE INDEX IF NOT EXISTS idx_canonical_ingredients_active
  ON canonical_ingredients (active) WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_canonical_ingredients_display_lower
  ON canonical_ingredients (lower(display_name));

COMMENT ON TABLE canonical_ingredients IS 'Layer 2+ canonical pantry ingredient list; search adds must resolve here';

ALTER TABLE canonical_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read canonical ingredients"
  ON canonical_ingredients FOR SELECT
  TO authenticated
  USING (true);

-- Search: match display_name, base_ingredient, or any alias (case-insensitive); exclude pantry bases already present
CREATE OR REPLACE FUNCTION search_canonical_ingredients(
  p_query TEXT,
  p_limit INTEGER DEFAULT 6,
  p_exclude TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS TABLE (
  base_ingredient TEXT,
  display_name TEXT,
  category TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.base_ingredient, c.display_name, c.category
  FROM canonical_ingredients c
  WHERE c.active = true
    AND length(trim(p_query)) >= 2
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_exclude) AS ex
      WHERE length(trim(ex)) > 0
        AND lower(trim(ex)) = lower(c.base_ingredient)
    )
    AND (
      c.display_name ILIKE '%' || trim(p_query) || '%'
      OR c.base_ingredient ILIKE '%' || trim(p_query) || '%'
      OR EXISTS (
        SELECT 1
        FROM unnest(c.aliases) AS a
        WHERE a ILIKE '%' || trim(p_query) || '%'
      )
    )
  ORDER BY
    CASE
      WHEN lower(c.base_ingredient) = lower(trim(p_query)) THEN 0
      WHEN lower(c.display_name) = lower(trim(p_query)) THEN 1
      WHEN c.base_ingredient ILIKE trim(p_query) || '%' THEN 2
      WHEN c.display_name ILIKE trim(p_query) || '%' THEN 3
      ELSE 4
    END,
    c.display_name
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 6), 25));
$$;

REVOKE ALL ON FUNCTION search_canonical_ingredients(TEXT, INTEGER, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_canonical_ingredients(TEXT, INTEGER, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION search_canonical_ingredients(TEXT, INTEGER, TEXT[]) TO service_role;

-- Seed: staples (align with staples_template) + extended pantry (~250 rows)
INSERT INTO canonical_ingredients (base_ingredient, display_name, category, aliases) VALUES
  ('olive oil', 'Olive oil', 'Oils & Vinegars', ARRAY['evoo', 'ev olive', 'extra virgin', 'e v o o']),
  ('vegetable oil', 'Vegetable oil', 'Oils & Vinegars', ARRAY['veg oil']),
  ('sesame oil', 'Sesame oil', 'Oils & Vinegars', '{}'),
  ('white wine vinegar', 'White wine vinegar', 'Oils & Vinegars', ARRAY['ww vinegar']),
  ('apple cider vinegar', 'Apple cider vinegar', 'Oils & Vinegars', ARRAY['acv', 'cider vinegar']),
  ('balsamic vinegar', 'Balsamic vinegar', 'Oils & Vinegars', ARRAY['balsamic']),
  ('coconut oil', 'Coconut oil', 'Oils & Vinegars', '{}'),
  ('canola oil', 'Canola oil', 'Oils & Vinegars', '{}'),
  ('grapeseed oil', 'Grapeseed oil', 'Oils & Vinegars', '{}'),
  ('peanut oil', 'Peanut oil', 'Oils & Vinegars', '{}'),
  ('avocado oil', 'Avocado oil', 'Oils & Vinegars', '{}'),
  ('rice vinegar', 'Rice vinegar', 'Oils & Vinegars', ARRAY['rice wine vinegar']),
  ('red wine vinegar', 'Red wine vinegar', 'Oils & Vinegars', '{}'),
  ('sherry vinegar', 'Sherry vinegar', 'Oils & Vinegars', '{}'),

  ('all-purpose flour', 'All-purpose flour', 'Baking Basics', ARRAY['ap flour', 'plain flour']),
  ('sugar', 'Sugar', 'Baking Basics', ARRAY['white sugar', 'granulated sugar']),
  ('brown sugar', 'Brown sugar', 'Baking Basics', '{}'),
  ('baking powder', 'Baking powder', 'Baking Basics', '{}'),
  ('baking soda', 'Baking soda', 'Baking Basics', ARRAY['bicarbonate', 'sodium bicarbonate']),
  ('vanilla extract', 'Vanilla extract', 'Baking Basics', ARRAY['vanilla']),
  ('cornstarch', 'Cornstarch', 'Baking Basics', ARRAY['corn starch']),
  ('cake flour', 'Cake flour', 'Baking Basics', '{}'),
  ('bread flour', 'Bread flour', 'Baking Basics', '{}'),
  ('whole wheat flour', 'Whole wheat flour', 'Baking Basics', ARRAY['ww flour']),
  ('almond flour', 'Almond flour', 'Baking Basics', '{}'),
  ('coconut flour', 'Coconut flour', 'Baking Basics', '{}'),
  ('powdered sugar', 'Powdered sugar', 'Baking Basics', ARRAY['icing sugar', 'confectioners sugar']),
  ('molasses', 'Molasses', 'Baking Basics', '{}'),
  ('honey', 'Honey', 'Baking Basics', '{}'),
  ('maple syrup', 'Maple syrup', 'Baking Basics', ARRAY['maple']),
  ('agave', 'Agave nectar', 'Baking Basics', ARRAY['agave syrup']),
  ('chocolate chips', 'Chocolate chips', 'Baking Basics', ARRAY['choc chips']),
  ('cocoa powder', 'Cocoa powder', 'Baking Basics', ARRAY['cocoa']),
  ('yeast', 'Yeast', 'Baking Basics', ARRAY['active dry yeast']),

  ('salt', 'Salt', 'Spices & Seasonings', ARRAY['table salt', 'kosher salt']),
  ('black pepper', 'Black pepper', 'Spices & Seasonings', ARRAY['pepper']),
  ('garlic powder', 'Garlic powder', 'Spices & Seasonings', ARRAY['garlic']),
  ('onion powder', 'Onion powder', 'Spices & Seasonings', '{}'),
  ('cumin', 'Cumin', 'Spices & Seasonings', ARRAY['ground cumin']),
  ('paprika', 'Paprika', 'Spices & Seasonings', '{}'),
  ('smoked paprika', 'Smoked paprika', 'Spices & Seasonings', ARRAY['pimenton']),
  ('chili flakes', 'Chili flakes', 'Spices & Seasonings', ARRAY['red pepper flakes', 'chile flakes']),
  ('dried oregano', 'Dried oregano', 'Spices & Seasonings', ARRAY['oregano']),
  ('cinnamon', 'Cinnamon', 'Spices & Seasonings', ARRAY['ground cinnamon']),
  ('turmeric', 'Turmeric', 'Spices & Seasonings', ARRAY['ground turmeric']),
  ('ginger', 'Ground ginger', 'Spices & Seasonings', ARRAY['ginger powder']),
  ('nutmeg', 'Nutmeg', 'Spices & Seasonings', '{}'),
  ('cloves', 'Ground cloves', 'Spices & Seasonings', '{}'),
  ('allspice', 'Allspice', 'Spices & Seasonings', '{}'),
  ('bay leaves', 'Bay leaves', 'Spices & Seasonings', ARRAY['bay leaf']),
  ('thyme', 'Dried thyme', 'Spices & Seasonings', '{}'),
  ('rosemary', 'Dried rosemary', 'Spices & Seasonings', '{}'),
  ('basil', 'Dried basil', 'Spices & Seasonings', '{}'),
  ('italian seasoning', 'Italian seasoning', 'Spices & Seasonings', '{}'),
  ('curry powder', 'Curry powder', 'Spices & Seasonings', ARRAY['curry']),
  ('garam masala', 'Garam masala', 'Spices & Seasonings', '{}'),
  ('five spice', 'Chinese five spice', 'Spices & Seasonings', ARRAY['5 spice']),
  ('celery salt', 'Celery salt', 'Spices & Seasonings', '{}'),
  ('old bay', 'Old Bay seasoning', 'Spices & Seasonings', ARRAY['old bay seasoning']),
  ('everything bagel seasoning', 'Everything bagel seasoning', 'Spices & Seasonings', '{}'),

  ('canned tomatoes', 'Canned tomatoes', 'Canned & Jarred', ARRAY['tomatoes canned', 'crushed tomatoes']),
  ('canned chickpeas', 'Canned chickpeas', 'Canned & Jarred', ARRAY['chickpeas', 'garbanzo beans']),
  ('canned black beans', 'Canned black beans', 'Canned & Jarred', ARRAY['black beans']),
  ('canned kidney beans', 'Canned kidney beans', 'Canned & Jarred', ARRAY['kidney beans']),
  ('canned white beans', 'Canned white beans', 'Canned & Jarred', ARRAY['cannellini', 'great northern beans']),
  ('chicken broth', 'Chicken broth', 'Canned & Jarred', ARRAY['chx broth', 'chicken stock']),
  ('vegetable broth', 'Vegetable broth', 'Canned & Jarred', ARRAY['veg broth', 'vegetable stock']),
  ('beef broth', 'Beef broth', 'Canned & Jarred', ARRAY['beef stock']),
  ('soy sauce', 'Soy sauce', 'Canned & Jarred', ARRAY['shoyu']),
  ('dijon mustard', 'Dijon mustard', 'Canned & Jarred', ARRAY['dijon']),
  ('yellow mustard', 'Yellow mustard', 'Canned & Jarred', ARRAY['american mustard']),
  ('mayonnaise', 'Mayonnaise', 'Canned & Jarred', ARRAY['mayo']),
  ('ketchup', 'Ketchup', 'Canned & Jarred', '{}'),
  ('bbq sauce', 'Barbecue sauce', 'Canned & Jarred', ARRAY['bbq', 'barbecue sauce']),
  ('worcestershire sauce', 'Worcestershire sauce', 'Canned & Jarred', ARRAY['worcestershire']),
  ('hot sauce', 'Hot sauce', 'Canned & Jarred', ARRAY['tabasco']),
  ('sriracha', 'Sriracha', 'Canned & Jarred', '{}'),
  ('fish sauce', 'Fish sauce', 'Canned & Jarred', ARRAY['nam pla']),
  ('oyster sauce', 'Oyster sauce', 'Canned & Jarred', '{}'),
  ('hoisin sauce', 'Hoisin sauce', 'Canned & Jarred', ARRAY['hoisin']),
  ('miso paste', 'Miso paste', 'Canned & Jarred', ARRAY['miso']),
  ('gochujang', 'Gochujang', 'Canned & Jarred', ARRAY['korean chili paste']),
  ('tahini', 'Tahini', 'Canned & Jarred', ARRAY['sesame paste']),
  ('peanut butter', 'Peanut butter', 'Canned & Jarred', ARRAY['pb']),
  ('almond butter', 'Almond butter', 'Canned & Jarred', '{}'),
  ('jam', 'Jam', 'Canned & Jarred', ARRAY['jelly', 'preserves']),
  ('coconut milk', 'Coconut milk', 'Canned & Jarred', '{}'),
  ('coconut cream', 'Coconut cream', 'Canned & Jarred', '{}'),
  ('enchilada sauce', 'Enchilada sauce', 'Canned & Jarred', '{}'),
  ('tomato paste', 'Tomato paste', 'Canned & Jarred', '{}'),
  ('tomato sauce', 'Tomato sauce', 'Canned & Jarred', ARRAY['marinara base']),
  ('pickles', 'Pickles', 'Canned & Jarred', ARRAY['dill pickles']),
  ('capers', 'Capers', 'Canned & Jarred', '{}'),
  ('olives', 'Olives', 'Canned & Jarred', '{}'),
  ('sun-dried tomatoes', 'Sun-dried tomatoes', 'Canned & Jarred', ARRAY['sundried tomatoes']),
  ('roasted red peppers', 'Roasted red peppers', 'Canned & Jarred', ARRAY['jarred peppers']),
  ('artichoke hearts', 'Artichoke hearts', 'Canned & Jarred', '{}'),
  ('green chiles', 'Canned green chiles', 'Canned & Jarred', ARRAY['diced green chiles']),
  ('corn', 'Canned corn', 'Canned & Jarred', ARRAY['sweet corn canned']),
  ('pumpkin puree', 'Pumpkin puree', 'Canned & Jarred', ARRAY['canned pumpkin']),
  ('applesauce', 'Applesauce', 'Canned & Jarred', ARRAY['apple sauce']),

  ('white rice', 'White rice', 'Grains & Pasta', ARRAY['rice']),
  ('brown rice', 'Brown rice', 'Grains & Pasta', '{}'),
  ('jasmine rice', 'Jasmine rice', 'Grains & Pasta', '{}'),
  ('basmati rice', 'Basmati rice', 'Grains & Pasta', '{}'),
  ('arborio rice', 'Arborio rice', 'Grains & Pasta', ARRAY['risotto rice']),
  ('quinoa', 'Quinoa', 'Grains & Pasta', '{}'),
  ('couscous', 'Couscous', 'Grains & Pasta', '{}'),
  ('bulgur', 'Bulgur', 'Grains & Pasta', ARRAY['bulgur wheat']),
  ('farro', 'Farro', 'Grains & Pasta', '{}'),
  ('barley', 'Barley', 'Grains & Pasta', '{}'),
  ('pasta', 'Pasta', 'Grains & Pasta', ARRAY['spaghetti', 'noodles', 'linguine']),
  ('lasagna noodles', 'Lasagna noodles', 'Grains & Pasta', ARRAY['lasagna sheets']),
  ('egg noodles', 'Egg noodles', 'Grains & Pasta', '{}'),
  ('rice noodles', 'Rice noodles', 'Grains & Pasta', ARRAY['pad thai noodles']),
  ('dried lentils', 'Dried lentils', 'Grains & Pasta', ARRAY['lentils']),
  ('black lentils', 'Black lentils', 'Grains & Pasta', '{}'),
  ('red lentils', 'Red lentils', 'Grains & Pasta', '{}'),
  ('split peas', 'Split peas', 'Grains & Pasta', '{}'),
  ('panko breadcrumbs', 'Panko breadcrumbs', 'Grains & Pasta', ARRAY['panko']),
  ('breadcrumbs', 'Breadcrumbs', 'Grains & Pasta', ARRAY['bread crumbs']),
  ('oats', 'Oats', 'Grains & Pasta', ARRAY['rolled oats', 'old fashioned oats']),
  ('steel cut oats', 'Steel cut oats', 'Grains & Pasta', '{}'),
  ('polenta', 'Polenta', 'Grains & Pasta', ARRAY['cornmeal coarse']),
  ('cornmeal', 'Cornmeal', 'Grains & Pasta', '{}'),
  ('grits', 'Grits', 'Grains & Pasta', '{}'),
  ('tortillas', 'Tortillas', 'Grains & Pasta', ARRAY['flour tortillas']),
  ('corn tortillas', 'Corn tortillas', 'Grains & Pasta', '{}'),

  ('garlic', 'Garlic', 'Produce', ARRAY['fresh garlic', 'garlic cloves']),
  ('onion', 'Onion', 'Produce', ARRAY['yellow onion', 'white onion']),
  ('red onion', 'Red onion', 'Produce', ARRAY['purple onion']),
  ('shallot', 'Shallots', 'Produce', ARRAY['shallots']),
  ('ginger fresh', 'Fresh ginger', 'Produce', ARRAY['ginger root']),
  ('lemons', 'Lemons', 'Produce', ARRAY['lemon']),
  ('limes', 'Limes', 'Produce', ARRAY['lime']),
  ('potatoes', 'Potatoes', 'Produce', ARRAY['russet potatoes', 'yukon gold']),
  ('sweet potatoes', 'Sweet potatoes', 'Produce', ARRAY['yams']),
  ('carrots', 'Carrots', 'Produce', '{}'),
  ('celery', 'Celery', 'Produce', '{}'),
  ('bell pepper', 'Bell pepper', 'Produce', ARRAY['peppers', 'capsicum']),
  ('jalapeno', 'Jalapeño', 'Produce', ARRAY['jalapenos', 'jalapeño']),
  ('tomatoes', 'Tomatoes', 'Produce', ARRAY['roma tomatoes', 'vine tomatoes']),
  ('cherry tomatoes', 'Cherry tomatoes', 'Produce', ARRAY['grape tomatoes']),
  ('cucumber', 'Cucumber', 'Produce', '{}'),
  ('zucchini', 'Zucchini', 'Produce', ARRAY['courgette']),
  ('spinach', 'Spinach', 'Produce', '{}'),
  ('kale', 'Kale', 'Produce', '{}'),
  ('lettuce', 'Lettuce', 'Produce', ARRAY['romaine', 'iceberg']),
  ('broccoli', 'Broccoli', 'Produce', '{}'),
  ('cauliflower', 'Cauliflower', 'Produce', '{}'),
  ('mushrooms', 'Mushrooms', 'Produce', ARRAY['button mushrooms', 'cremini']),
  ('asparagus', 'Asparagus', 'Produce', '{}'),
  ('green beans', 'Green beans', 'Produce', ARRAY['string beans']),
  ('brussels sprouts', 'Brussels sprouts', 'Produce', '{}'),
  ('cabbage', 'Cabbage', 'Produce', '{}'),
  ('apples', 'Apples', 'Produce', '{}'),
  ('bananas', 'Bananas', 'Produce', '{}'),
  ('berries', 'Berries', 'Produce', ARRAY['strawberries', 'blueberries']),
  ('avocado', 'Avocado', 'Produce', ARRAY['avocados']),
  ('cilantro', 'Cilantro', 'Produce', ARRAY['coriander fresh', 'fresh cilantro']),
  ('parsley', 'Parsley', 'Produce', ARRAY['fresh parsley']),
  ('basil fresh', 'Fresh basil', 'Produce', ARRAY['basil leaves']),
  ('mint', 'Fresh mint', 'Produce', '{}'),
  ('scallions', 'Scallions', 'Produce', ARRAY['green onions', 'spring onions']),
  ('chives', 'Chives', 'Produce', '{}'),
  ('preserved lemons', 'Preserved lemons', 'Produce', ARRAY['preserved lemon']),

  ('butter', 'Butter', 'Dairy', ARRAY['unsalted butter', 'salted butter']),
  ('milk', 'Milk', 'Dairy', ARRAY['whole milk', '2% milk']),
  ('heavy cream', 'Heavy cream', 'Dairy', ARRAY['whipping cream', 'double cream']),
  ('half and half', 'Half and half', 'Dairy', ARRAY['half-and-half']),
  ('sour cream', 'Sour cream', 'Dairy', '{}'),
  ('cream cheese', 'Cream cheese', 'Dairy', '{}'),
  ('greek yogurt', 'Greek yogurt', 'Dairy', ARRAY['yogurt']),
  ('yogurt', 'Yogurt', 'Dairy', '{}'),
  ('cheddar cheese', 'Cheddar cheese', 'Dairy', ARRAY['cheddar']),
  ('mozzarella', 'Mozzarella', 'Dairy', ARRAY['mozzarella cheese']),
  ('parmesan', 'Parmesan', 'Dairy', ARRAY['parm', 'parmigiano', 'parmesan cheese']),
  ('feta cheese', 'Feta cheese', 'Dairy', ARRAY['feta']),
  ('goat cheese', 'Goat cheese', 'Dairy', ARRAY['chevre']),
  ('ricotta', 'Ricotta', 'Dairy', ARRAY['ricotta cheese']),
  ('cottage cheese', 'Cottage cheese', 'Dairy', '{}'),
  ('eggs', 'Eggs', 'Dairy', ARRAY['egg']),

  ('chicken breast', 'Chicken breast', 'Meat & Seafood', ARRAY['chicken breasts']),
  ('chicken thighs', 'Chicken thighs', 'Meat & Seafood', ARRAY['chx thighs', 'chicken thigh']),
  ('chicken wings', 'Chicken wings', 'Meat & Seafood', '{}'),
  ('whole chicken', 'Whole chicken', 'Meat & Seafood', ARRAY['roasting chicken']),
  ('ground beef', 'Ground beef', 'Meat & Seafood', ARRAY['minced beef', 'beef mince']),
  ('beef steak', 'Beef steak', 'Meat & Seafood', ARRAY['steak', 'ribeye', 'sirloin']),
  ('beef roast', 'Beef roast', 'Meat & Seafood', ARRAY['pot roast', 'chuck roast']),
  ('pork chops', 'Pork chops', 'Meat & Seafood', ARRAY['pork chop']),
  ('pork tenderloin', 'Pork tenderloin', 'Meat & Seafood', '{}'),
  ('bacon', 'Bacon', 'Meat & Seafood', '{}'),
  ('sausage', 'Sausage', 'Meat & Seafood', ARRAY['italian sausage', 'breakfast sausage']),
  ('ground turkey', 'Ground turkey', 'Meat & Seafood', '{}'),
  ('turkey breast', 'Turkey breast', 'Meat & Seafood', '{}'),
  ('lamb', 'Lamb', 'Meat & Seafood', ARRAY['lamb chops', 'ground lamb']),
  ('salmon', 'Salmon', 'Meat & Seafood', ARRAY['salmon fillet']),
  ('tuna', 'Tuna', 'Meat & Seafood', ARRAY['tuna canned', 'canned tuna']),
  ('shrimp', 'Shrimp', 'Meat & Seafood', ARRAY['prawns']),
  ('cod', 'Cod', 'Meat & Seafood', '{}'),
  ('tilapia', 'Tilapia', 'Meat & Seafood', '{}'),
  ('tofu', 'Tofu', 'Meat & Seafood', ARRAY['firm tofu']),
  ('tempeh', 'Tempeh', 'Meat & Seafood', '{}'),

  ('rice wine', 'Rice wine', 'International', ARRAY['mirin substitute', 'cooking sake']),
  ('mirin', 'Mirin', 'International', '{}'),
  ('sake', 'Sake', 'International', ARRAY['cooking sake']),
  ('nori', 'Nori', 'International', ARRAY['seaweed sheets', 'sushi nori']),
  ('wonton wrappers', 'Wonton wrappers', 'International', ARRAY['dumpling wrappers']),
  ('rice paper', 'Rice paper', 'International', ARRAY['spring roll wrappers']),
  ('curry paste', 'Curry paste', 'International', ARRAY['thai curry paste', 'red curry paste']),
  ('harissa', 'Harissa', 'International', '{}'),
  ('zaatar', 'Za''atar', 'International', ARRAY['za atar', 'middle eastern spice mix']),
  ('sumac', 'Sumac', 'International', '{}'),
  ('chipotle in adobo', 'Chipotle in adobo', 'International', ARRAY['chipotles']),
  ('enchilada seasoning', 'Taco seasoning', 'International', ARRAY['taco seasoning mix']),
  ('kimchi', 'Kimchi', 'International', '{}'),
  ('sambal oelek', 'Sambal oelek', 'International', ARRAY['sambal']),
  ('chili crisp', 'Chili crisp', 'International', ARRAY['chili oil crisp']),
  ('vermicelli', 'Vermicelli', 'International', ARRAY['thin noodles']),
  ('udon noodles', 'Udon noodles', 'International', ARRAY['udon']),
  ('ramen noodles', 'Ramen noodles', 'International', ARRAY['instant ramen']),
  ('soba noodles', 'Soba noodles', 'International', ARRAY['soba']),
  ('naan', 'Naan bread', 'International', ARRAY['naan bread']),
  ('pita bread', 'Pita bread', 'International', ARRAY['pita']),
  ('phyllo dough', 'Phyllo dough', 'International', ARRAY['filo dough']),
  ('puff pastry', 'Puff pastry', 'International', '{}'),
  ('pie crust', 'Pie crust', 'International', ARRAY['premade pie crust']),
  ('crackers', 'Crackers', 'Snacks', '{}'),
  ('nuts', 'Mixed nuts', 'Snacks', ARRAY['almonds', 'walnuts', 'pecans']),
  ('walnuts', 'Walnuts', 'Snacks', '{}'),
  ('almonds', 'Almonds', 'Snacks', '{}'),
  ('pecans', 'Pecans', 'Snacks', '{}'),
  ('cashews', 'Cashews', 'Snacks', '{}'),
  ('pine nuts', 'Pine nuts', 'Snacks', ARRAY['pignoli']),
  ('sunflower seeds', 'Sunflower seeds', 'Snacks', '{}'),
  ('chia seeds', 'Chia seeds', 'Snacks', '{}'),
  ('flax seeds', 'Flax seeds', 'Snacks', ARRAY['flaxseed']),
  ('sesame seeds', 'Sesame seeds', 'Snacks', '{}'),
  ('poppy seeds', 'Poppy seeds', 'Snacks', '{}'),
  ('raisins', 'Raisins', 'Snacks', '{}'),
  ('dried cranberries', 'Dried cranberries', 'Snacks', ARRAY['craisins']),
  ('chicken bouillon', 'Chicken bouillon', 'Pantry', ARRAY['bouillon cubes', 'chicken cube']),
  ('vegetable bouillon', 'Vegetable bouillon', 'Pantry', ARRAY['veg bouillon']),
  ('gelatin', 'Gelatin', 'Pantry', ARRAY['unflavored gelatin']),
  ('food coloring', 'Food coloring', 'Pantry', '{}'),
  ('evaporated milk', 'Evaporated milk', 'Pantry', '{}'),
  ('sweetened condensed milk', 'Sweetened condensed milk', 'Pantry', ARRAY['condensed milk']),
  ('buttermilk', 'Buttermilk', 'Dairy', '{}'),
  ('ricotta salata', 'Ricotta salata', 'Dairy', '{}'),
  ('prosciutto', 'Prosciutto', 'Meat & Seafood', '{}'),
  ('pancetta', 'Pancetta', 'Meat & Seafood', '{}'),
  ('chorizo', 'Chorizo', 'Meat & Seafood', '{}'),
  ('ground pork', 'Ground pork', 'Meat & Seafood', ARRAY['pork mince']),
  ('ham', 'Ham', 'Meat & Seafood', '{}'),
  ('anchovies', 'Anchovies', 'Meat & Seafood', ARRAY['anchovy']),
  ('clams', 'Clams', 'Meat & Seafood', '{}'),
  ('mussels', 'Mussels', 'Meat & Seafood', '{}'),
  ('scallops', 'Scallops', 'Meat & Seafood', '{}'),
  ('squid', 'Squid', 'Meat & Seafood', ARRAY['calamari']),
  ('wine red', 'Red wine', 'Pantry', ARRAY['red wine cooking']),
  ('wine white', 'White wine', 'Pantry', ARRAY['white wine cooking']),
  ('beer', 'Beer', 'Pantry', ARRAY['lager', 'ale']),
  ('stock concentrate', 'Stock concentrate', 'Pantry', ARRAY['better than bouillon']),
  ('nutritional yeast', 'Nutritional yeast', 'Pantry', ARRAY['nooch']),
  ('liquid smoke', 'Liquid smoke', 'Pantry', '{}'),
  ('xanthan gum', 'Xanthan gum', 'Pantry', '{}'),
  ('corn husks', 'Corn husks', 'Pantry', ARRAY['tamale husks']),
  ('baking spray', 'Cooking spray', 'Pantry', ARRAY['pam', 'nonstick spray']),
  ('shortening', 'Shortening', 'Baking Basics', ARRAY['vegetable shortening']),
  ('marshmallows', 'Marshmallows', 'Snacks', '{}'),
  ('granola', 'Granola', 'Snacks', '{}'),
  ('cereal', 'Breakfast cereal', 'Snacks', ARRAY['cereal']),
  ('instant coffee', 'Instant coffee', 'Pantry', '{}'),
  ('coffee beans', 'Coffee beans', 'Pantry', ARRAY['coffee', 'ground coffee']),
  ('tea', 'Tea', 'Pantry', ARRAY['black tea', 'green tea']),
  ('sparkling water', 'Sparkling water', 'Pantry', ARRAY['seltzer', 'club soda']),
  ('water', 'Water', 'Pantry', '{}')
ON CONFLICT (base_ingredient) DO NOTHING;
