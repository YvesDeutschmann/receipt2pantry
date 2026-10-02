# Mealime catalog scan — what Meald should adopt

**Date:** 2026-09-29  
**Method:** Public sitemap (3,291 recipe URLs) + schema.org JSON-LD **metadata only** (title, `recipeCategory`, `recipeCuisine`, `keywords`, times, yield, ingredient **count** and lines for clustering). Instruction text was not stored and is not a source for Meald recipes.  
**Result:** 3,291 / 3,291 pages had JSON-LD; 0 failures.  
**How to use this:** families and constraints for **original** Meald recipes (same process as staples: our title, our steps, our image). Not a clone list.

---

## What the catalog actually is

Mealime is a **weeknight complete-plate library for 4 people**, not a single-dish cookbook.

| Signal | Number |
|---|---|
| Public recipes | 3,291 |
| Unique slugs | 2,999 |
| After collapsing `-gf` variants | **~2,319** dishes |
| Duplicate slugs (same dish, two IDs) | 271 |
| GF-tagged slugs | 748 |
| Servings | **4 on every recipe** |
| Median time / ingredients / steps | **35 min / 13 ings / 12 steps** |
| Time ≤ 35 min | 73% |
| Time ≥ 46 min | **7 recipes** |
| Title is `Main with Side` | **94%** |
| “Salad” in the title | 33% |

Their own `recipeCategory` field:

| Category | Count | Share | Median time | Median ings | Median steps |
|---|---|---|---|---|---|
| Dinner | 2,569 | 78% | 35 | 14 | 13 |
| Simple | 469 | 14% | **30** | **11** | **9** |
| Breakfast | 137 | 4% | 20 | 9 | 8 |
| Snack | 116 | 4% | 15 | 9 | 6 |

Dinner ≤ 30 min is only **412 / 2,569 (16%)**. The “easy weeknight” product they advertise lives in **Simple**, not in Dinner.

---

## Their taxonomy (keywords)

Tags overlap. **Soups** and **Stews & Chilis** are the same 269 recipes (always dual-tagged). 255 recipes (8%) have no keyword.

| Keyword | Count | Notes |
|---|---|---|
| Main-Course Salads | 441 | #1 tag. Mealime’s signature “salad is dinner.” |
| Baked | 342 | Sheet-pan / oven protein + veg |
| Pasta & Pizza | 335 | Largest *cookable* family after salads |
| Soups / Stews & Chilis | 269 | One family, not two |
| Burgers & Sandwiches | 225 | Lunch + emergency dinner |
| Pan-Fried | 201 | |
| BBQ & Grilling | 182 | Seasonal |
| Stir-Fries | 180 | |
| Bowls | 179 | |
| Skillets & Sautés | 162 | |
| Fried Rice & Noodles | 116 | Pair with stir-fry |
| Tacos & Quesadillas | 106 | |
| Wraps | 92 | |
| Chops | 79 | Skip first wave |
| Low-Carb “Pastas” | 63 | Skip |
| Stuffed Vegetables | 61 | Fiddly; skip first wave |
| Curries | 49 | Later |
| Fritters & Cakes | 44 | Technique; skip |
| Frittatas | 40 | Breakfast + dinner |
| Wings & Tenders | 25 | Skip |

Cuisine field is empty on **2,082 (63%)**. When set: Asian 222, American 126, Italian-American 113, Italian 103, Tex-Mex 88, Thai 87, Indian 59. Treat as three weeknight languages — **Italian/pasta, Asian stir-fry/noodles, Tex-Mex tacos** — not 20 cuisine silos.

Protein mentions (a recipe can hit more than one): chicken 1,057, beef/pork/sausage 872, beans/lentils 574, fish/shrimp 465, egg 390, tofu 289, turkey 105.

---

## What transfers to Meald (and what must not)

Meald’s job is *5pm, pantry, busy parent* (`docs/PRODUCT_BRIEF.md`). Mealime’s job is *shop a 4-person complete meal, cook it tonight*.

**Take as constraints**

- Family of 4, done in **≤ 35 minutes**, almost never over 45.
- **Simple** is the complexity ceiling: ~11 ingredients, ~9 steps, ~30 min.
- Proteins people already buy at Safeway/Costco: chicken, ground meat, eggs, beans, pasta, rice, tortillas, canned tomatoes.

**Do not take as a recipe shape**

- The **main + composed side** bundle (94% of titles). That is why Dinner sits at 14 ingredients. Meald depletion and pantry matching want **one dish**. A side salad can be a separate optional card later.
- **748 GF clones** as extra catalog rows.
- Instruction prose, photos, or 1:1 titles.

A Meald-shaped *filter* on their metadata (Dinner or Simple, ≤35 min, ≤12 ingredients, not `-gf`) is **775 recipes**. That is an inspiration-pool size, not a ship list. In that pool the keywords are pasta, baked, main-course salads, soup/stew, grilling, steaks, pan-fried, skillets, burgers, tacos, stir-fries.

---

## Adopt — original Meald recipes in these families

Existing staples already cover: omelette, scrambled eggs, cereal, PB&J, grilled cheese, toast, aglio e olio, tomato pasta, rice and beans. Everything below is **gap fill**.

### Wave 1 — dinners (~48), before more breakfast

These eight families are where Mealime put volume **and** where a receipt-backed pantry can hit.

| Family | Why (catalog + Meald) | Suggested original count | Notes |
|---|---|---|---|
| Pasta | 335 tagged; 92 of Simple | 8 | Beyond the two staples: sausage-tomato, chickpea-garlic, pesto-broccoli, lemon, one-pot, baked pasta |
| Sheet-pan / baked | 342 tagged; 59 of Simple | 8 | Highest “low attention” overlap with 5pm. Chicken+potato+broccoli, sausage+peppers, salmon+veg, tofu+broccoli, meatballs |
| Skillet / pan-fried | 201 + 162 | 6 | Chicken lemon, taco skillet, shrimp garlic, pork-apple, leftover fried rice |
| Stir-fry + fried rice/noodles | 180 + 116 | 6 | Chicken-broccoli, tofu-veg, pepper-steak, sesame noodles, shrimp, egg fried rice |
| Tacos / quesadillas | 106; 18 of Simple | 6 | Chicken, ground beef, black bean, fish, cheese quesadilla, egg-for-dinner |
| Soup / chili | 269 (one family) | 6 | Chili, lentil, chicken noodle, tomato, white bean, tortilla soup |
| Bowls | 179 | 4 | Burrito bowl, teriyaki rice, Mediterranean, salmon rice |
| Sandwiches as dinner | 225 | 4 | Tuna melt, chicken sandwich, veggie burger, breakfast-for-dinner egg sandwich |

**~48 dinners.** That is enough to sit in front of Spoonacular for the common pantry (pasta, rice, chicken, beans, eggs, tortillas) and cut quota on the hottest path. It is not a 2,300-dish clone.

Write to the **Simple** bar: one plate, ≤12 ingredients, ≤10 steps, ≤30–35 min, no bundled salad.

### Wave 1b — breakfast (~12), not 137

Breakfast is only 4% of their catalog. Tokens in titles: egg 44, toast 28, oat 27, avocado 20, scramble 20, smoothie 14, yogurt 8. We already have three egg/cereal staples.

**Add:** avocado toast, oatmeal, overnight oats, yogurt bowl, frittata, breakfast burrito, egg-and-cheese sandwich, potato hash and eggs.  
**Skip:** smoothies as “recipes,” pancake/waffle (2 titles — not their thing), duplicating omelette/scramble/cereal.

### Wave 2 — only after Wave 1 cooks

- Small **dinner salad** set (3–5), not 441. Taco salad, chicken Caesar-style, grain salad. Kids/parents will not accept salad-as-dinner as the center of the catalog.
- **Curries** (~49) once coconut milk / curry paste show up on receipts.
- **BBQ/grill** (~182) as a summer slice, not a default pool.
- **Frittatas** also as a dinner slot (they tag 40).

---

## Do not adopt (first catalog)

| Skip | Why |
|---|---|
| Snacks (116) | MVP is What’s for Dinner |
| Steaks / chops / wings | Buy-for-tonight, weak leftover-pantry story |
| Stuffed vegetables, fritters | Technique and time |
| Low-carb “pastas” | Niche |
| GF as parallel SKUs | One recipe + a gluten note later |
| Main+side bundles | Breaks matching/depletion; inflate ingredient lists |
| Long-tail cuisines (2–7 recipes each) | Irish, Russian, Cuban, German, etc. |

---

## Suggested build order

1. **Schema:** first-party `recipes` table; stop assuming `int(recipe_id)` is Spoonacular.  
2. **48 dinners** in the eight families, staple-shaped JSON + generated 4:3 images (same prompt family as `docs/features/0005_staple_image_prompts.md`).  
3. Rank local recipes **ahead of** Spoonacular in pool / suggestions / meal plan.  
4. **12 breakfasts.**  
5. Measure share of suggestions served locally (`vendor_usage_daily`) before growing the catalog.

Do not aim at 2,319. Aim at **covering the pantry states staples onboarding already creates** (oil, salt, pasta, rice, canned tomatoes, beans, eggs). That is the Mealime lesson that is legal and on-strategy.
