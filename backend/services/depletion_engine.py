"""Simulated pantry depletion for suggestion pool generation (read-only vs real pantry)."""

from copy import deepcopy
from typing import Dict, List, Any

from backend.services.pantry_service import PantryService
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class DepletionEngine:
    """Snapshot real pantry and apply hypothetical consumption like meal wizard."""

    def __init__(self, pantry_service: PantryService):
        self.pantry_service = pantry_service

    def snapshot_pantry(self, user_id: str, household_id: str) -> Dict[str, Dict]:
        """Clone household pantry into session-shaped dict keyed by item id."""
        pantry_items = self.pantry_service._get_pantry_items(user_id, household_id)
        session_pantry: Dict[str, Dict] = {}
        for item in pantry_items:
            item_id = item.get("id")
            quantity = float(item.get("quantity", 0))
            if quantity > 0 and item_id:
                session_pantry[str(item_id)] = {
                    "id": item_id,
                    "name": item.get("normalized_name", ""),
                    "base_ingredient": item.get("base_ingredient", ""),
                    "quantity": quantity,
                    "unit": item.get("unit", ""),
                    "variant": item.get("variant"),
                }
        return session_pantry

    def available_ingredient_names(self, simulated_pantry: Dict[str, Dict]) -> List[str]:
        names = []
        for item_data in simulated_pantry.values():
            if float(item_data.get("quantity", 0)) > 0:
                base = (item_data.get("base_ingredient") or "").lower().strip()
                if base:
                    names.append(base)
        return sorted(list(set(names)))

    def deplete_from_extended_ingredients(
        self, simulated_pantry: Dict[str, Dict], extended_ingredients: List[Dict]
    ) -> Dict[str, Dict]:
        """
        Deduct recipe extendedIngredients from a copy of simulated_pantry (mutates copy).
        Same matching rules as meal_plan accept_recipe.
        """
        pantry = deepcopy(simulated_pantry)
        for ing in extended_ingredients:
            ing_name = (ing.get("name") or "").lower().strip()
            ing_amount = float(ing.get("amount") or 0)
            ing_unit = ing.get("unit") or ""

            for item_id, item_data in list(pantry.items()):
                base_ingredient = (item_data.get("base_ingredient") or "").lower().strip()
                unit = item_data.get("unit") or ""
                quantity = float(item_data.get("quantity", 0))

                if base_ingredient in ing_name or ing_name in base_ingredient:
                    if unit == ing_unit or (not unit and not ing_unit):
                        new_quantity = max(0.0, quantity - ing_amount)
                        pantry[item_id]["quantity"] = new_quantity
                        if new_quantity == 0:
                            del pantry[item_id]
                        break
        return pantry


def create_depletion_engine(pantry_service: PantryService) -> DepletionEngine:
    return DepletionEngine(pantry_service)
