"""Meal-type and dish-type helpers for Spoonacular recipe filtering."""

from __future__ import annotations

from typing import List, Optional, Set

# Spoonacular `type` param for complexSearch (comma-separated OR within param)
MEAL_TYPE_TO_SPOONACULAR = {
    "breakfast": "breakfast",
    "lunch": "main course,salad,soup,sandwich",
    "dinner": "main course",
}

TREAT_DISH_TYPES: Set[str] = {
    "dessert",
    "snack",
    "beverage",
    "drink",
    "sweet",
    "baked goods",
}

BREAKFAST_ONLY: Set[str] = {"breakfast", "brunch", "morning meal"}

DINNER_LUNCH_OK: Set[str] = {
    "dinner",
    "lunch",
    "main course",
    "main dish",
    "side dish",
}

LUNCH_OK: Set[str] = {
    "lunch",
    "main course",
    "main dish",
    "salad",
    "soup",
    "sandwich",
    "side dish",
}


def _normalize_dish_types(dish_types: Optional[List[str]]) -> Set[str]:
    return {(d or "").lower().strip() for d in (dish_types or []) if (d or "").strip()}


def spoonacular_type_for_meal(meal_type: Optional[str]) -> str:
    """Map app meal slot to Spoonacular complexSearch `type` value."""
    if not meal_type:
        return "main course"
    return MEAL_TYPE_TO_SPOONACULAR.get(meal_type.lower().strip(), "main course")


def is_treat(dish_types: Optional[List[str]]) -> bool:
    """True for desserts, snacks, and similar non-meal recipes."""
    normalized = _normalize_dish_types(dish_types)
    if not normalized:
        return False
    return bool(normalized & TREAT_DISH_TYPES)


def is_appropriate_for_meal(
    dish_types: Optional[List[str]], meal_type: Optional[str]
) -> bool:
    """
    Whether recipe dishTypes fit the requested meal slot.
    Empty dishTypes -> allow (unknown tagging).
    """
    if not meal_type:
        return True
    normalized = _normalize_dish_types(dish_types)
    if not normalized:
        return True

    meal = meal_type.lower().strip()
    if is_treat(dish_types):
        return False

    if meal == "breakfast":
        return bool(normalized & BREAKFAST_ONLY)

    if meal == "lunch":
        if normalized & BREAKFAST_ONLY:
            return False
        return bool(normalized & LUNCH_OK)

    if meal == "dinner":
        if normalized & BREAKFAST_ONLY:
            return False
        if normalized & {"dessert"}:
            return False
        return bool(normalized & DINNER_LUNCH_OK)

    return True
