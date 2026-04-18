"""Persistence layer for pre-generated suggestion pool."""

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Set

from backend.services.supabase_service import SupabaseService
from backend.utils.exceptions import DatabaseException
from backend.utils.logger import get_logger

logger = get_logger(__name__)

STALE_GENERATION_MINUTES = 10


class PoolStoreService:
    """CRUD and mutex for suggestion_pool / pool_generation."""

    def __init__(self, supabase: SupabaseService):
        self.supabase = supabase

    def _client(self):
        return self.supabase.admin_client if self.supabase.admin_client else self.supabase.client

    def _fail_stale_in_progress(
        self, household_id: str, now: Optional[datetime] = None
    ) -> None:
        """Mark abandoned in_progress runs as failed."""
        if now is None:
            now = datetime.now(timezone.utc)
        client = self._client()
        cutoff = (now - timedelta(minutes=STALE_GENERATION_MINUTES)).isoformat()
        try:
            client.table("pool_generation").update(
                {
                    "status": "failed",
                    "error_message": "Stale generation abandoned",
                    "completed_at": now.isoformat(),
                }
            ).eq("household_id", household_id).eq("status", "in_progress").lt("started_at", cutoff).execute()
        except Exception as e:
            logger.warning(f"Could not fail stale generations: {e}")

    def start_generation(
        self,
        household_id: str,
        user_id: str,
        trigger_reason: str,
        meal_types: List[str],
    ) -> Dict[str, Any]:
        """
        Begin a generation run. Returns existing in_progress if already running (after stale cleanup).
        Raises DatabaseException if another run is active.
        """
        if not meal_types:
            raise DatabaseException("meal_types must include at least one meal type")
        self._fail_stale_in_progress(household_id)
        client = self._client()

        active = (
            client.table("pool_generation")
            .select("id, started_at")
            .eq("household_id", household_id)
            .eq("status", "in_progress")
            .execute()
        )
        if active.data:
            row = active.data[0]
            return {"generation_id": row["id"], "already_running": True}

        row = {
            "household_id": household_id,
            "user_id": user_id,
            "trigger_reason": trigger_reason,
            "status": "in_progress",
            "meal_types_requested": meal_types,
            "suggestions_generated": 0,
        }
        ins = client.table("pool_generation").insert(row).execute()
        if not ins.data:
            raise DatabaseException("Failed to start pool generation")
        return {"generation_id": ins.data[0]["id"], "already_running": False}

    def complete_generation(
        self,
        generation_id: str,
        status: str,
        suggestions_count: int,
        error_message: Optional[str] = None,
    ) -> None:
        client = self._client()
        client.table("pool_generation").update(
            {
                "status": status,
                "suggestions_generated": suggestions_count,
                "error_message": error_message,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", generation_id).execute()

    def clear_unused(self, household_id: str, meal_type: Optional[str] = None) -> None:
        client = self._client()
        q = client.table("suggestion_pool").delete().eq("household_id", household_id).eq("status", "unused")
        if meal_type:
            q = q.eq("meal_type", meal_type)
        q.execute()

    def get_swiped_recipe_ids(self, household_id: str) -> Set[str]:
        client = self._client()
        res = (
            client.table("suggestion_pool")
            .select("recipe_id")
            .eq("household_id", household_id)
            .eq("status", "swiped")
            .execute()
        )
        return {str(r["recipe_id"]) for r in (res.data or [])}

    def get_pool(
        self,
        household_id: str,
        meal_type: Optional[str] = None,
        status: str = "unused",
    ) -> List[Dict]:
        client = self._client()
        q = client.table("suggestion_pool").select("*").eq("household_id", household_id).eq("status", status)
        if meal_type:
            q = q.eq("meal_type", meal_type)
        res = q.order("created_at", desc=True).execute()
        return res.data or []

    def get_pool_grouped_by_meal(self, household_id: str, status: str = "unused") -> Dict[str, List[Dict]]:
        rows = self.get_pool(household_id, meal_type=None, status=status)
        grouped: Dict[str, List[Dict]] = {"breakfast": [], "lunch": [], "dinner": []}
        for r in rows:
            mt = r.get("meal_type")
            if mt in grouped:
                grouped[mt].append(r)
        return grouped

    def get_pool_depth(self, household_id: str) -> Dict[str, int]:
        client = self._client()
        res = (
            client.table("suggestion_pool")
            .select("meal_type")
            .eq("household_id", household_id)
            .eq("status", "unused")
            .execute()
        )
        depth = {"breakfast": 0, "lunch": 0, "dinner": 0}
        for r in res.data or []:
            mt = r.get("meal_type")
            if mt in depth:
                depth[mt] += 1
        return depth

    def add_suggestions(
        self,
        household_id: str,
        user_id: str,
        generation_id: str,
        suggestions: List[Dict[str, Any]],
    ) -> int:
        """
        Bulk insert suggestions. Skips recipe_ids that are swiped or already present.
        Each suggestion dict: meal_type, recipe_id, recipe_name, recipe_image, recipe_data, match_score
        """
        swiped = self.get_swiped_recipe_ids(household_id)
        client = self._client()
        inserted = 0
        for s in suggestions:
            rid = str(s.get("recipe_id", ""))
            if not rid or rid in swiped:
                continue
            existing = (
                client.table("suggestion_pool")
                .select("id, status")
                .eq("household_id", household_id)
                .eq("recipe_id", rid)
                .execute()
            )
            if existing.data:
                continue
            row = {
                "household_id": household_id,
                "user_id": user_id,
                "meal_type": s["meal_type"],
                "recipe_id": rid,
                "recipe_name": s.get("recipe_name") or s.get("title") or "",
                "recipe_image": s.get("recipe_image") or s.get("image"),
                "recipe_data": s.get("recipe_data") or {},
                "match_score": s.get("match_score"),
                "status": "unused",
                "generation_id": generation_id,
            }
            try:
                client.table("suggestion_pool").insert(row).execute()
                inserted += 1
            except Exception as e:
                logger.debug(f"Skip insert recipe {rid}: {e}")
        return inserted

    def update_status(self, suggestion_id: str, household_id: str, new_status: str) -> bool:
        client = self._client()
        res = (
            client.table("suggestion_pool")
            .update({"status": new_status})
            .eq("id", suggestion_id)
            .eq("household_id", household_id)
            .execute()
        )
        return bool(res.data)

    def get_suggestion(self, suggestion_id: str, household_id: str) -> Optional[Dict]:
        client = self._client()
        res = (
            client.table("suggestion_pool")
            .select("*")
            .eq("id", suggestion_id)
            .eq("household_id", household_id)
            .execute()
        )
        if res.data:
            return res.data[0]
        return None


def create_pool_store_service(supabase: SupabaseService) -> PoolStoreService:
    return PoolStoreService(supabase)
