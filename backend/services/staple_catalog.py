"""First-party staple recipe catalog (data-only; no Flask / meal-plan imports)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, FrozenSet, List, Optional, Set

_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "staple_recipes.json"
_STAPLE_ID_RE = re.compile(r"^staple_[a-z0-9_]+$")
_MAX_STEP_LEN = 500
_MAX_STEPS = 8

# Pantry keys writers may use in extendedIngredients.name (template + legacy staples).
_ALLOWED_INGREDIENT_NAMES: FrozenSet[str] = frozenset(
    {
        "egg",
        "bread",
        "peanut butter",
        "milk",
        "cereal",
        "cheese",
        "pasta",
        "olive oil",
        "garlic powder",
        "salt",
        "black pepper",
        "chili flakes",
        "canned tomatoes",
        "white rice",
        "canned black beans",
        "cumin",
        "onion powder",
        "butter",
        "sugar",
    }
)

_CATALOG_BY_ID: Dict[str, Dict[str, Any]] = {}


def _assert_plain_text(value: str, field: str) -> None:
    if "<" in value or ">" in value:
        raise ValueError(f"staple catalog {field} must be plain text (no HTML)")


def _validate_recipe(raw: Dict[str, Any]) -> Dict[str, Any]:
    rid = raw.get("id")
    if not isinstance(rid, str) or not _STAPLE_ID_RE.match(rid):
        raise ValueError(f"invalid staple id: {rid!r}")
    meal_type = raw.get("meal_type")
    if meal_type not in ("breakfast", "lunch", "dinner"):
        raise ValueError(f"{rid}: meal_type must be breakfast|lunch|dinner")
    required = raw.get("required_bases")
    if not isinstance(required, list) or not required:
        raise ValueError(f"{rid}: required_bases must be a non-empty list")
    for b in required:
        if not isinstance(b, str) or not b.strip():
            raise ValueError(f"{rid}: invalid required_bases entry")
    title = raw.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ValueError(f"{rid}: title required")
    summary = raw.get("summary") or ""
    if not isinstance(summary, str):
        raise ValueError(f"{rid}: summary must be string")
    _assert_plain_text(summary, f"{rid}.summary")
    instructions = raw.get("instructions") or ""
    if not isinstance(instructions, str):
        raise ValueError(f"{rid}: instructions must be string")
    _assert_plain_text(instructions, f"{rid}.instructions")
    image = raw.get("image")
    expected_image = f"/staples/{rid}.webp"
    if image != expected_image:
        raise ValueError(f"{rid}: image must be {expected_image}")
    ready = raw.get("readyInMinutes")
    servings = raw.get("servings")
    if not isinstance(ready, int) or ready < 1:
        raise ValueError(f"{rid}: readyInMinutes must be positive int")
    if not isinstance(servings, int) or servings < 1:
        raise ValueError(f"{rid}: servings must be positive int")
    extended = raw.get("extendedIngredients")
    if not isinstance(extended, list) or not extended:
        raise ValueError(f"{rid}: extendedIngredients required")
    for ing in extended:
        if not isinstance(ing, dict):
            raise ValueError(f"{rid}: invalid ingredient")
        name = (ing.get("name") or "").strip().lower()
        original = ing.get("original") or ""
        if name not in _ALLOWED_INGREDIENT_NAMES:
            raise ValueError(f"{rid}: disallowed ingredient name {name!r}")
        if not isinstance(original, str):
            raise ValueError(f"{rid}: ingredient original must be string")
        _assert_plain_text(original, f"{rid}.ingredient.original")
    analyzed = raw.get("analyzedInstructions")
    if not isinstance(analyzed, list) or not analyzed:
        raise ValueError(f"{rid}: analyzedInstructions required")
    step_count = 0
    for group in analyzed:
        if not isinstance(group, dict):
            raise ValueError(f"{rid}: invalid instruction group")
        steps = group.get("steps") or []
        if not isinstance(steps, list):
            raise ValueError(f"{rid}: steps must be list")
        for step in steps:
            if not isinstance(step, dict):
                raise ValueError(f"{rid}: invalid step")
            text = step.get("step") or ""
            if not isinstance(text, str):
                raise ValueError(f"{rid}: step text must be string")
            _assert_plain_text(text, f"{rid}.step")
            if len(text) > _MAX_STEP_LEN:
                raise ValueError(f"{rid}: step too long")
            step_count += 1
    if step_count < 1 or step_count > _MAX_STEPS:
        raise ValueError(f"{rid}: need 1-{_MAX_STEPS} steps, got {step_count}")
    return raw


def _load_catalog() -> Dict[str, Dict[str, Any]]:
    if not _DATA_PATH.is_file():
        raise FileNotFoundError(f"staple catalog missing: {_DATA_PATH}")
    data = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("staple_recipes.json must be a JSON array")
    by_id: Dict[str, Dict[str, Any]] = {}
    for item in data:
        if not isinstance(item, dict):
            raise ValueError("each catalog entry must be an object")
        validated = _validate_recipe(item)
        rid = validated["id"]
        if rid in by_id:
            raise ValueError(f"duplicate staple id {rid}")
        by_id[rid] = validated
    if len(by_id) != 9:
        raise ValueError(f"expected 9 staple recipes, got {len(by_id)}")
    return by_id


def _pantry_bases_set(session_pantry: Dict[str, Dict]) -> Set[str]:
    bases: Set[str] = set()
    for item_data in session_pantry.values():
        qty = float(item_data.get("quantity", 0) or 0)
        if qty <= 0:
            continue
        base = (item_data.get("base_ingredient") or "").strip().lower()
        if base:
            bases.add(base)
    return bases


def get_staple_recipe(recipe_id: str) -> Optional[Dict[str, Any]]:
    """Full recipe details for GET /api/recipes/staple_*."""
    return _CATALOG_BY_ID.get(recipe_id)


def staple_recipe_ids() -> FrozenSet[str]:
    return frozenset(_CATALOG_BY_ID.keys())


def is_known_staple_id(recipe_id: str) -> bool:
    return bool(recipe_id and _STAPLE_ID_RE.match(recipe_id) and recipe_id in _CATALOG_BY_ID)


def thin_card_from_catalog(entry: Dict[str, Any]) -> Dict[str, Any]:
    """Pool / suggestion card fields only (lock 4)."""
    required = entry.get("required_bases") or []
    used = len(required)
    return {
        "id": entry["id"],
        "title": entry["title"],
        "image": entry["image"],
        "readyInMinutes": entry.get("readyInMinutes"),
        "servings": entry.get("servings"),
        "match_percentage": 1.0,
        "usedIngredientCount": used,
        "missedIngredientCount": 0,
        "is_staple": True,
    }


def list_staples_for_pantry(
    session_pantry: Dict[str, Dict], meal_type: str
) -> List[Dict[str, Any]]:
    """Staples whose required_bases are all present (exact match, qty > 0)."""
    if meal_type not in ("breakfast", "lunch", "dinner"):
        return []
    bases = _pantry_bases_set(session_pantry)
    out: List[Dict[str, Any]] = []
    for entry in _CATALOG_BY_ID.values():
        if entry.get("meal_type") != meal_type:
            continue
        required = [str(b).strip().lower() for b in entry.get("required_bases") or []]
        if all(r in bases for r in required):
            out.append(thin_card_from_catalog(entry))
    out.sort(key=lambda x: x.get("title") or "")
    return out


# Load at import — invalid catalog fails process start (lock 1).
_CATALOG_BY_ID.update(_load_catalog())
