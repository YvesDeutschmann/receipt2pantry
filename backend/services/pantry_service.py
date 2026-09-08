"""Pantry management service for tracking household ingredient inventory"""

from typing import Any, Dict, List, Optional, Set, Tuple
from datetime import date, datetime, timedelta, timezone
from backend.services.supabase_service import SupabaseService
from backend.services.confidence_engine import (
    _rpc_soft_delete_pantry_item,
    _to_date,
    process_put_back,
)
from backend.utils.exceptions import DatabaseException, ValidationException
from backend.utils.logger import get_logger

logger = get_logger(__name__)

_VALID_DEPLETION_CLASSES = frozenset(
    {"PERISHABLE", "CONSUMABLE", "STAPLE", "UNIT_ITEM"}
)


class PantryService:
    """Service for managing household pantry inventory"""
    
    def __init__(self, supabase: SupabaseService):
        """
        Initialize PantryService
        
        Args:
            supabase: Supabase service instance
        """
        self.supabase = supabase
    
    def _get_household_id_for_user(
        self, user_id: str, *, today: Optional[date] = None
    ) -> Optional[str]:
        """
        Get the household ID for a user
        
        Args:
            user_id: User ID
            today: Optional anchor date (reserved for time-deterministic call sites / tests)
        
        Returns:
            Household ID or None if user has no household
        """
        _ = today
        household = self.supabase.get_user_household(user_id)
        return household["id"] if household else None
    
    def _get_pantry_items(
        self,
        user_id: str,
        household_id: Optional[str] = None,
        *,
        today: Optional[date] = None,
        include_deleted: bool = False,
    ) -> List[Dict]:
        """
        Get pantry items, preferring household scope if available
        
        Args:
            user_id: User ID (for legacy fallback)
            household_id: Household ID (preferred)
            today: Optional anchor date (reserved for time-deterministic call sites / tests)
            include_deleted: When True, include soft-deleted rows (merge/resurrect only)
        
        Returns:
            List of pantry items
        """
        _ = today
        if household_id:
            if include_deleted:
                return self.supabase.get_household_pantry(
                    household_id, include_deleted=True
                )
            return self.supabase.get_household_pantry(household_id)
        if include_deleted:
            return self.supabase.get_user_pantry(user_id, include_deleted=True)
        return self.supabase.get_user_pantry(user_id)

    @staticmethod
    def _normalize_depletion_class(raw: Any) -> str:
        if not isinstance(raw, str):
            return "STAPLE"
        dclass = raw.strip().upper()
        return dclass if dclass in _VALID_DEPLETION_CLASSES else "STAPLE"

    def _classification_for_base(self, base_ingredient: Optional[str]) -> Dict[str, Any]:
        key = (base_ingredient or "").strip().lower()
        if not key:
            return {}
        row = self.supabase.get_item_classifications_by_names([key]).get(key, {})
        return row if isinstance(row, dict) else {}

    def _depletion_fields(
        self,
        base_ingredient: str,
        quantity: float,
        *,
        purchase_date: date,
    ) -> Dict[str, Any]:
        cls = self._classification_for_base(base_ingredient)
        dclass = self._normalize_depletion_class(cls.get("depletion_class"))
        fields: Dict[str, Any] = {
            "depletion_class": dclass,
            "purchase_date": purchase_date.isoformat(),
        }
        if dclass == "PERISHABLE" and cls.get("shelf_life_days"):
            fields["available_until"] = (
                purchase_date + timedelta(days=int(cls["shelf_life_days"]))
            ).isoformat()
        if dclass == "UNIT_ITEM":
            fields["quantity_purchased"] = quantity
        return fields

    def _resurrect_fields(
        self,
        existing: Dict,
        new_quantity: float,
        *,
        purchase_date: date,
    ) -> Dict[str, Any]:
        """Refresh purchase metadata on a soft-deleted row. Does not rewrite depletion_class."""
        fields: Dict[str, Any] = {
            "deleted_at": None,
            "purchase_date": purchase_date.isoformat(),
            "quantity": new_quantity,
            "quantity_remaining": None,
            "hard_expire_date": None,
        }
        dclass = self._normalize_depletion_class(existing.get("depletion_class"))
        cls = self._classification_for_base(existing.get("base_ingredient"))
        if not existing.get("depletion_class"):
            dclass = self._normalize_depletion_class(cls.get("depletion_class"))
        if dclass == "PERISHABLE" and cls.get("shelf_life_days"):
            fields["available_until"] = (
                purchase_date + timedelta(days=int(cls["shelf_life_days"]))
            ).isoformat()
        if dclass == "UNIT_ITEM":
            fields["quantity_purchased"] = new_quantity
        return fields
    
    async def add_to_pantry(
        self,
        user_id: str,
        normalized_item: Dict,
        quantity: float,
        unit: str,
        receipt_id: str,
        household_id: Optional[str] = None,
        *,
        reference_date: Optional[date] = None,
    ) -> str:
        """
        Add or update pantry item with variant awareness
        
        Args:
            user_id: User ID (who added the item)
            normalized_item: Normalized product dictionary with base_ingredient, variant, etc.
            quantity: Quantity to add
            unit: Unit of measurement
            receipt_id: Source receipt ID
            household_id: Household ID (optional, will be looked up if not provided)
        
        Returns:
            Pantry item ID
        """
        try:
            # Get household ID if not provided
            if not household_id:
                household_id = self._get_household_id_for_user(user_id)
            
            # Get existing items (household-scoped if available)
            existing_items = self._get_pantry_items(
                user_id, household_id, include_deleted=True
            )
            
            existing_item = self._find_exact_pantry_match(
                existing_items,
                normalized_item.get("base_ingredient"),
                normalized_item.get("variant"),
                unit,
            )
            
            if existing_item:
                purchase_date = reference_date or date.today()

                if existing_item.get("deleted_at") is not None:
                    existing_qty = existing_item.get("quantity") or 0
                    new_quantity = max(existing_qty, 1) + quantity
                    self.supabase.update_pantry_item_fields(
                        existing_item["id"],
                        self._resurrect_fields(
                            existing_item,
                            new_quantity,
                            purchase_date=purchase_date,
                        ),
                    )
                    logger.info(
                        f"Resurrected pantry: {normalized_item.get('normalized_name')} "
                        f"quantity → {new_quantity}"
                    )
                    return existing_item["id"]

                # Update existing live item (add quantity)
                new_quantity = existing_item['quantity'] + quantity
                
                self.supabase.update_pantry_quantity(existing_item['id'], new_quantity)
                
                # Update last_receipt_id (only if provided)
                if reference_date is not None:
                    added_at = datetime.combine(
                        reference_date, datetime.min.time(), tzinfo=timezone.utc
                    ).isoformat()
                else:
                    added_at = datetime.utcnow().isoformat()
                update_data = {"added_at": added_at}
                if receipt_id:
                    update_data['last_receipt_id'] = receipt_id
                client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
                client.table('pantry_items').update(update_data).eq('id', existing_item['id']).execute()
                
                logger.info(
                    f"Updated pantry: {normalized_item.get('normalized_name')} "
                    f"quantity {existing_item['quantity']} → {new_quantity}"
                )
                return existing_item['id']
            else:
                # Insert new item
                item_data = {
                    'user_id': user_id,
                    'household_id': household_id,
                    'base_ingredient': normalized_item.get('base_ingredient'),
                    'variant': normalized_item.get('variant'),
                    'normalized_name': normalized_item.get('normalized_name'),
                    'quantity': quantity,
                    'unit': unit,
                    'product_type': normalized_item.get('product_type'),
                    'category': normalized_item.get('category'),
                    'tags': normalized_item.get('tags', []),
                    'metadata': {}
                }
                # Only set last_receipt_id if provided (not for manual entries)
                if receipt_id:
                    item_data['last_receipt_id'] = receipt_id

                purchase_date = reference_date or date.today()
                item_data.update(
                    self._depletion_fields(
                        normalized_item.get("base_ingredient"),
                        quantity,
                        purchase_date=purchase_date,
                    )
                )

                item_id = self.supabase.upsert_pantry_item(item_data)

                logger.info(
                    f"Added to pantry: {normalized_item.get('normalized_name')} "
                    f"({quantity} {unit})"
                )
                return item_id
                
        except Exception as e:
            logger.error(f"Failed to add item to pantry: {e}")
            raise DatabaseException(f"Failed to add to pantry: {e}")
    
    async def get_pantry_summary(
        self, user_id: str, household_id: Optional[str] = None
    ) -> Dict:
        """
        Get organized pantry with variants grouped
        
        Args:
            user_id: User ID
            household_id: Household ID (optional, will be looked up if not provided)
        
        Returns:
            Dictionary with grouped pantry items
        """
        try:
            # Get household ID if not provided
            if not household_id:
                household_id = self._get_household_id_for_user(user_id)
            
            items = [
                item
                for item in self._get_pantry_items(user_id, household_id)
                if not item.get("deleted_at")
            ]
            
            # Group by base_ingredient
            grouped = {}
            for item in items:
                base = item['base_ingredient']
                if base not in grouped:
                    grouped[base] = {
                        'base_ingredient': base,
                        'variants': []
                    }
                grouped[base]['variants'].append(item)
            
            return {
                'total_items': len(items),
                'unique_ingredients': len(grouped),
                'items': items,
                'grouped': list(grouped.values()),
                'household_id': household_id
            }
        except Exception as e:
            logger.error(f"Failed to get pantry summary: {e}")
            raise DatabaseException(f"Failed to get pantry summary: {e}")
    
    async def consume_ingredients(
        self,
        user_id: str,
        recipe_id: str,
        recipe_name: str,
        servings: int,
        ingredients: List[Dict],
        household_id: Optional[str] = None
    ) -> Dict:
        """
        Deduct ingredients when recipe is cooked
        
        Args:
            user_id: User ID (who cooked)
            recipe_id: Recipe ID
            recipe_name: Recipe name
            servings: Number of servings cooked
            ingredients: List of ingredient dicts with 'name', 'amount', 'unit'
            household_id: Household ID (optional, will be looked up if not provided)
        
        Returns:
            Dictionary with consumption results
        """
        try:
            # Get household ID if not provided
            if not household_id:
                household_id = self._get_household_id_for_user(user_id)
            
            pantry_items = self._get_pantry_items(user_id, household_id)
            consumed = []
            warnings = []
            
            for ingredient in ingredients:
                ing_name = ingredient['name']
                ing_amount = ingredient['amount']
                ing_unit = ingredient.get('unit', '')
                
                # Find matching pantry item
                matching_item = None
                for item in pantry_items:
                    if (item['normalized_name'].lower() == ing_name.lower() and
                        item.get('unit', '') == ing_unit):
                        matching_item = item
                        break
                
                if matching_item:
                    # Deduct quantity
                    new_quantity = max(0, matching_item['quantity'] - ing_amount)
                    self.supabase.update_pantry_quantity(matching_item['id'], new_quantity)
                    
                    consumed.append({
                        'ingredient': ing_name,
                        'amount_used': ing_amount,
                        'remaining': new_quantity,
                        'unit': ing_unit
                    })
                    
                    if new_quantity == 0:
                        warnings.append(f"{ing_name} is now depleted")
                else:
                    warnings.append(f"{ing_name} was not found in pantry (not deducted)")
            
            # Log cooking event (household-scoped)
            log_data = {
                'user_id': user_id,
                'household_id': household_id,
                'recipe_id': recipe_id,
                'recipe_name': recipe_name,
                'servings': servings,
                'ingredients_used': ingredients,
                'metadata': {
                    'consumed': consumed,
                    'warnings': warnings
                }
            }
            log_id = self.supabase.log_cooking_event(log_data)
            
            logger.info(f"Consumed ingredients for recipe: {recipe_name} (log ID: {log_id})")
            
            return {
                'log_id': log_id,
                'consumed': consumed,
                'warnings': warnings
            }
            
        except Exception as e:
            logger.error(f"Failed to consume ingredients: {e}")
            raise DatabaseException(f"Failed to consume ingredients: {e}")
    
    async def check_ingredient_availability(
        self,
        user_id: str,
        required_ingredients: List[Dict],
        household_id: Optional[str] = None
    ) -> Dict:
        """
        Check what's available, missing, or substitutable
        
        Args:
            user_id: User ID
            required_ingredients: List of required ingredient dicts with 'name', 'amount', 'unit'
            household_id: Household ID (optional, will be looked up if not provided)
        
        Returns:
            Dictionary with availability analysis
        """
        try:
            # Get household ID if not provided
            if not household_id:
                household_id = self._get_household_id_for_user(user_id)
            
            pantry_items = self._get_pantry_items(user_id, household_id)
            
            available = []
            insufficient = []
            missing = []
            substitutable = []
            
            for req_ing in required_ingredients:
                req_name = req_ing['name']
                req_amount = req_ing['amount']
                req_unit = req_ing.get('unit', '')
                
                # Find exact match
                matching_item = None
                for item in pantry_items:
                    if (item['normalized_name'].lower() == req_name.lower() and
                        item.get('unit', '') == req_unit):
                        matching_item = item
                        break
                
                if matching_item:
                    if matching_item['quantity'] >= req_amount:
                        available.append({
                            'ingredient': req_name,
                            'required': req_amount,
                            'available': matching_item['quantity'],
                            'unit': req_unit
                        })
                    else:
                        insufficient.append({
                            'ingredient': req_name,
                            'required': req_amount,
                            'available': matching_item['quantity'],
                            'shortage': req_amount - matching_item['quantity'],
                            'unit': req_unit
                        })
                else:
                    # Check for substitutions
                    substitutions = self.supabase.get_substitutions_for_ingredient(req_name)
                    
                    available_subs = []
                    for sub in substitutions:
                        # Check if substitute is in pantry
                        for item in pantry_items:
                            if item['normalized_name'].lower() == sub['substitute'].lower():
                                available_subs.append({
                                    'substitute': sub['substitute'],
                                    'type': sub['substitution_type'],
                                    'acceptable': sub.get('acceptable', True),
                                    'ratio': sub.get('ratio', 1.0),
                                    'notes': sub.get('notes'),
                                    'available_quantity': item['quantity']
                                })
                                break
                    
                    if available_subs:
                        substitutable.append({
                            'ingredient': req_name,
                            'required': req_amount,
                            'unit': req_unit,
                            'substitutes': available_subs
                        })
                    else:
                        missing.append({
                            'ingredient': req_name,
                            'required': req_amount,
                            'unit': req_unit
                        })
            
            can_make = len(missing) == 0 and len(insufficient) == 0
            can_make_with_subs = len(missing) == 0 and all(
                any(s['acceptable'] for s in item['substitutes'])
                for item in substitutable
            )
            
            return {
                'can_make': can_make,
                'can_make_with_substitutions': can_make_with_subs,
                'available': available,
                'insufficient': insufficient,
                'missing': missing,
                'substitutable': substitutable,
                'household_id': household_id
            }
            
        except Exception as e:
            logger.error(f"Failed to check ingredient availability: {e}")
            raise DatabaseException(f"Failed to check ingredient availability: {e}")

    def get_acceptable_substitutes(
        self, ingredient_name: str
    ) -> List[Dict]:
        """
        Return acceptable substitutes for a canonical ingredient name.

        Exact match only — no substring or LIKE query.
        Returns only rows where acceptable IS TRUE.

        Args:
            ingredient_name: Canonical ingredient name (exact, case-preserved).

        Returns:
            List of dicts with keys: substitute, substitution_type, ratio, notes, confidence.
            Empty list if no acceptable substitutes exist.
        """
        all_subs = self.supabase.get_substitutions_for_ingredient(ingredient_name)
        return [
            {
                "substitute": s["substitute"],
                "substitution_type": s["substitution_type"],
                "ratio": s.get("ratio"),
                "notes": s.get("notes"),
                "confidence": s.get("confidence"),
            }
            for s in all_subs
            if s.get("acceptable") is True
        ]

    @staticmethod
    def _normalize_base_key(base_ingredient: Optional[str]) -> str:
        return (base_ingredient or "").strip().lower()

    @staticmethod
    def _is_live_pantry_row(item: Dict) -> bool:
        return item.get("deleted_at") is None

    def _find_exact_pantry_match(
        self,
        pantry_items: List[Dict],
        base_ingredient: Optional[str],
        variant: Any,
        unit: str,
    ) -> Optional[Dict]:
        """Prefer a live row; resurrect a soft-deleted twin only when none is live."""
        dead = None
        for item in pantry_items:
            if (
                item.get("base_ingredient") != base_ingredient
                or item.get("variant") != variant
                or item.get("unit") != unit
            ):
                continue
            if self._is_live_pantry_row(item):
                return item
            if dead is None:
                dead = item
        return dead

    def _find_pantry_by_base(
        self, pantry_items: List[Dict], base_ingredient: str
    ) -> Optional[Dict]:
        key = self._normalize_base_key(base_ingredient)
        dead = None
        for item in pantry_items:
            if self._normalize_base_key(item.get("base_ingredient")) != key:
                continue
            if self._is_live_pantry_row(item):
                return item
            if dead is None:
                dead = item
        return dead

    async def batch_add_or_merge_items(
        self,
        user_id: str,
        household_id: Optional[str],
        canonical_items: List[Dict],
        source: str,
        *,
        set_template_confirmed: bool = False,
        today: Optional[date] = None,
    ) -> Dict[str, Any]:
        """
        Shared batch path for staples template, future search (L2), and voice (L3).

        Each canonical item: base_ingredient, normalized_name, category (optional).

        Merges on existing household pantry row with same base_ingredient (any variant/unit);
        otherwise inserts quantity=1, unit=''.
        """
        if not household_id:
            household_id = self._get_household_id_for_user(user_id)

        working = list(
            self._get_pantry_items(user_id, household_id, include_deleted=True)
        )
        inserted = 0
        merged = 0

        for ci in canonical_items:
            bi = ci.get("base_ingredient")
            if not bi:
                continue
            nn = ci.get("normalized_name") or bi
            cat = ci.get("category")
            ex = self._find_pantry_by_base(working, bi)
            if ex:
                merged += 1
                if ex.get("deleted_at") is not None:
                    purchase_date = today or date.today()
                    new_quantity = max(ex.get("quantity") or 0, 1)
                    updates = self._resurrect_fields(
                        ex, new_quantity, purchase_date=purchase_date
                    )
                    if set_template_confirmed:
                        updates["template_confirmed"] = True
                    self.supabase.update_pantry_item_fields(ex["id"], updates)
                    ex["deleted_at"] = None
                    ex["quantity"] = new_quantity
                    ex["quantity_remaining"] = None
                    continue

                updates = {}
                if set_template_confirmed:
                    updates["template_confirmed"] = True
                if updates:
                    self.supabase.update_pantry_item_fields(ex["id"], updates)
                continue

            item_data: Dict[str, Any] = {
                "user_id": user_id,
                "household_id": household_id,
                "base_ingredient": bi,
                "variant": None,
                "normalized_name": nn,
                "quantity": 1.0,
                "unit": "",
                "product_type": ci.get("product_type"),
                "category": cat,
                "tags": ci.get("tags") or [],
                "metadata": ci.get("metadata") or {},
                "source": source,
            }
            if set_template_confirmed:
                item_data["template_confirmed"] = True

            purchase_date = today or date.today()
            item_data.update(
                self._depletion_fields(bi, 1.0, purchase_date=purchase_date)
            )

            new_id = self.supabase.upsert_pantry_item(item_data)
            inserted += 1
            working.append(
                {
                    "id": new_id,
                    "base_ingredient": bi,
                    "variant": None,
                    "unit": "",
                }
            )

        return {"inserted": inserted, "merged": merged, "household_id": household_id}

    def _parse_receipt_order_date(self, raw: Any) -> Optional[date]:
        if raw is None:
            return None
        if isinstance(raw, date) and not isinstance(raw, datetime):
            return raw
        if isinstance(raw, datetime):
            return raw.date()
        if isinstance(raw, str):
            try:
                return date.fromisoformat(raw[:10])
            except ValueError:
                return None
        return None

    async def apply_staple_receipt_enrichment(
        self,
        user_id: str,
        household_id: Optional[str],
        staple_bases: Set[str],
        normalizer: Any,
    ) -> int:
        """
        Match normalized receipt lines to canonical staple bases; set purchase_date and
        receipt_import source on pantry rows. Returns count of staples matched.
        """
        if not household_id or not staple_bases or not normalizer:
            return 0

        lines = self.supabase.get_receipt_items_for_household(household_id)
        # base -> (best_date, receipt_id)
        best: Dict[str, Tuple[date, str]] = {}

        for row in lines:
            name = row.get("name") or ""
            cat = row.get("category") or "GROCERY"
            od = self._parse_receipt_order_date(row.get("_receipt_order_date"))
            rid = row.get("_receipt_id")
            if not name or not od:
                continue
            try:
                norm = normalizer.normalize_product(name, cat)
            except Exception as e:
                logger.warning(f"normalize_product failed for {name!r}: {e}")
                continue
            b = self._normalize_base_key(norm.get("base_ingredient"))
            if not b or b not in staple_bases:
                continue
            prev = best.get(b)
            if prev is None or od > prev[0]:
                best[b] = (od, str(rid) if rid else "")

        if not best:
            return 0

        pantry_items = self._get_pantry_items(user_id, household_id)
        matched = 0
        for b, (od, rid) in best.items():
            item = self._find_pantry_by_base(pantry_items, b)
            if not item:
                continue
            pdt = datetime.combine(od, datetime.min.time(), tzinfo=timezone.utc)
            updates: Dict[str, Any] = {
                "purchase_date": pdt.isoformat(),
                "source": "receipt_import",
            }
            if rid:
                updates["last_receipt_id"] = rid
            self.supabase.update_pantry_item_fields(item["id"], updates)
            matched += 1

        return matched

    async def list_staple_receipt_matches(
        self,
        user_id: str,
        household_id: Optional[str],
        candidate_bases: Set[str],
        normalizer: Any,
    ) -> List[str]:
        """Bases (lowercase) among candidate_bases that appear on recent receipts."""
        if not household_id or not candidate_bases or not normalizer:
            return []
        lines = self.supabase.get_receipt_items_for_household(household_id)
        found: Set[str] = set()
        for row in lines:
            name = row.get("name") or ""
            cat = row.get("category") or "GROCERY"
            if not name:
                continue
            try:
                norm = normalizer.normalize_product(name, cat)
            except Exception:
                continue
            b = self._normalize_base_key(norm.get("base_ingredient"))
            if b in candidate_bases:
                found.add(b)
        return sorted(found)

    async def confirm_staples_batch(
        self,
        user_id: str,
        selected_base_ingredients: List[str],
        normalizer: Optional[Any] = None,
        *,
        today: Optional[date] = None,
    ) -> Dict[str, Any]:
        """
        Confirm staples template selection: merge or insert rows, then receipt enrichment.
        """
        household_id = self._get_household_id_for_user(user_id)
        template_rows = self.supabase.get_staples_template_rows(active_only=True)
        by_base = {self._normalize_base_key(r["base_ingredient"]): r for r in template_rows}

        canonical_items: List[Dict] = []
        for raw in selected_base_ingredients:
            row = by_base.get(self._normalize_base_key(raw))
            if not row:
                continue
            canonical_items.append(
                {
                    "base_ingredient": row["base_ingredient"],
                    "normalized_name": row["display_name"],
                    "category": row["category"],
                }
            )

        batch_result = await self.batch_add_or_merge_items(
            user_id,
            household_id,
            canonical_items,
            source="template",
            set_template_confirmed=True,
            today=today,
        )

        staple_bases = {
            self._normalize_base_key(c["base_ingredient"]) for c in canonical_items
        }
        receipt_matched = await self.apply_staple_receipt_enrichment(
            user_id, household_id, staple_bases, normalizer
        )

        return {
            "added": batch_result["inserted"],
            "already_existed": batch_result["merged"],
            "receipt_matched": receipt_matched,
            "household_id": batch_result.get("household_id"),
        }

    _PANTRY_RESTORE_KEYS = frozenset(
        {
            "id",
            "user_id",
            "household_id",
            "base_ingredient",
            "variant",
            "normalized_name",
            "product_type",
            "category",
            "quantity",
            "unit",
            "added_at",
            "last_receipt_id",
            "expires_at",
            "tags",
            "metadata",
            "source",
            "template_confirmed",
            "purchase_date",
        }
    )

    def _user_can_access_pantry_item(self, user_id: str, item: Dict) -> bool:
        hh = self._get_household_id_for_user(user_id)
        if hh and item.get("household_id") and str(item["household_id"]) == str(hh):
            return True
        if str(item.get("user_id") or "") == str(user_id) and not item.get(
            "household_id"
        ):
            return True
        return False

    def user_can_access_pantry_item(self, user_id: str, item: Dict) -> bool:
        """Whether the user may read/update this pantry row (household or legacy user scope)."""
        return self._user_can_access_pantry_item(user_id, item)

    async def quick_add_from_search(
        self, user_id: str, base_ingredient: str
    ) -> Dict[str, Any]:
        """
        Layer 2: add one canonical ingredient from search (validates against canonical_ingredients).
        """
        canon = self.supabase.get_canonical_ingredient_by_base(base_ingredient)
        if not canon:
            raise ValidationException(
                "Ingredient not recognized — pick from suggestions"
            )
        household_id = self._get_household_id_for_user(user_id)
        canonical_items = [
            {
                "base_ingredient": canon["base_ingredient"],
                "normalized_name": canon["display_name"],
                "category": canon.get("category"),
            }
        ]
        batch_result = await self.batch_add_or_merge_items(
            user_id,
            household_id,
            canonical_items,
            source="search",
            set_template_confirmed=False,
        )
        refreshed = self._get_pantry_items(user_id, batch_result.get("household_id"))
        row = self._find_pantry_by_base(refreshed, canon["base_ingredient"])
        return {
            "item": {
                "base_ingredient": canon["base_ingredient"],
                "display_name": canon["display_name"],
            },
            "item_id": row["id"] if row else None,
            "was_new": batch_result["inserted"] > 0,
            "already_in_pantry": batch_result["merged"] > 0,
            "household_id": batch_result.get("household_id"),
        }

    def deplete_pantry_item(self, user_id: str, item_id: str) -> Dict[str, Any]:
        """Remove a pantry row (recipe card correction); returns snapshot for undo."""
        item = self.supabase.get_pantry_item_by_id(item_id)
        if not item:
            raise ValidationException("Item not found")
        if not self._user_can_access_pantry_item(user_id, item):
            raise ValidationException("Forbidden")
        snapshot = dict(item)
        meta = dict(snapshot.get("metadata") or {})
        meta["depleted"] = True
        meta["depleted_at"] = datetime.now(timezone.utc).isoformat()
        snapshot["metadata"] = meta
        self.supabase.delete_pantry_item(item_id)
        return {"snapshot": snapshot}

    def restore_pantry_item(self, user_id: str, snapshot: Dict) -> str:
        """Re-insert a row from deplete snapshot (undo)."""
        if not snapshot or not isinstance(snapshot, dict):
            raise ValidationException("snapshot required")
        if not self._user_can_access_pantry_item(user_id, snapshot):
            raise ValidationException("Forbidden")
        row = {k: snapshot[k] for k in self._PANTRY_RESTORE_KEYS if k in snapshot}
        meta = dict(row.get("metadata") or {})
        meta.pop("depleted", None)
        meta.pop("depleted_at", None)
        row["metadata"] = meta
        return self.supabase.insert_pantry_item_row(row)

    def update_quantity(
        self,
        item_id: str,
        quantity: float,
        *,
        today: Optional[date] = None,
    ) -> None:
        """Set pantry row quantity; `quantity` may be 0. `today` is reserved for tests / future audit fields."""
        _ = today
        if quantity < 0:
            raise ValidationException("Quantity cannot be negative")
        try:
            self.supabase.update_pantry_quantity(item_id, quantity)
        except DatabaseException:
            raise
        except Exception as e:
            raise DatabaseException(f"Failed to update quantity: {e}") from e

    def soft_delete(
        self,
        user_id: str,
        item_id: str,
        *,
        today: Optional[date] = None,
        reason: str = "USER_REMOVED",
        was_cooked: bool = False,
    ) -> None:
        """Soft-delete a live pantry row via RPC; stamps depletion_history with `today`."""
        effective = today if today is not None else date.today()
        item = self.supabase.get_pantry_item_by_id(item_id)
        if not item or item.get("deleted_at"):
            raise ValidationException("Item not found")
        if not self._user_can_access_pantry_item(user_id, item):
            raise ValidationException("Forbidden")
        purchase = _to_date(item.get("purchase_date"))
        client = self.supabase.admin_client or self.supabase.client
        try:
            _rpc_soft_delete_pantry_item(
                client,
                user_id=user_id,
                pantry_item_id=str(item_id),
                item_name=item.get("base_ingredient") or item.get("normalized_name") or "",
                depletion_class=item.get("depletion_class") or "STAPLE",
                purchase_date=purchase,
                today=effective,
                reason=reason,
                was_cooked=was_cooked,
                put_back_count=int(item.get("put_back_count") or 0),
            )
        except DatabaseException:
            raise
        except Exception as e:
            raise DatabaseException(f"Failed to soft-delete pantry item: {e}") from e

    def restore_from_depletion_history(
        self,
        user_id: str,
        depletion_history_id: str,
        *,
        today: Optional[date] = None,
    ) -> Dict[str, Any]:
        """
        Graveyard put-back: clears soft-delete on the existing row (same id).
        Returns the refreshed pantry row.
        """
        effective = today if today is not None else date.today()
        client = self.supabase.admin_client or self.supabase.client
        try:
            item, err = process_put_back(
                client, user_id, depletion_history_id, today=effective
            )
        except Exception as e:
            raise DatabaseException(f"Failed to restore from depletion history: {e}") from e
        if err == "MAX_PUT_BACK_REACHED":
            raise ValidationException("MAX_PUT_BACK_REACHED")
        if err:
            raise ValidationException(err)
        if not item:
            raise ValidationException("NOT_FOUND")
        return item


def create_pantry_service(supabase: SupabaseService) -> PantryService:
    """
    Factory function to create PantryService
    
    Args:
        supabase: Supabase service instance
    
    Returns:
        Initialized PantryService instance
    """
    return PantryService(supabase)
