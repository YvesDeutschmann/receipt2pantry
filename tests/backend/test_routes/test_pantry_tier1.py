"""Tier-1 critical coverage for `backend/routes/pantry.py` (see docs/implementation_briefs/test_coverage/tier_1_critical/t1-02-pantry-routes.md)."""

import io
import json
from datetime import date
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

from backend.utils.exceptions import DatabaseException
from tests.conftest import PostgrestClientStub

TEST_DATE = date(2026, 4, 17)


@pytest.fixture
def mock_pantry_tier1():
    svc = MagicMock()
    svc.get_pantry_summary = AsyncMock(
        return_value={
            "total_items": 0,
            "unique_ingredients": 0,
            "items": [],
            "grouped": [],
            "household_id": None,
        }
    )
    svc.add_to_pantry = AsyncMock(return_value="new-item")
    svc.consume_ingredients = AsyncMock(return_value={"log_id": "l1", "consumed": [], "warnings": []})
    svc.check_ingredient_availability = AsyncMock(
        return_value={
            "can_make": True,
            "can_make_with_substitutions": True,
            "available": [],
            "insufficient": [],
            "missing": [],
            "substitutable": [],
            "household_id": None,
        }
    )
    svc.confirm_staples_batch = AsyncMock(
        return_value={"added": 0, "already_existed": 0, "receipt_matched": [], "household_id": None}
    )
    svc.batch_add_or_merge_items = AsyncMock(
        return_value={"inserted": 1, "merged": 0, "household_id": "hh-1"}
    )
    svc.deplete_pantry_item = MagicMock(
        return_value={"snapshot": {"id": "x", "user_id": "u1", "base_ingredient": "salt"}}
    )
    svc.restore_pantry_item = MagicMock(return_value="restored-id")
    svc.user_can_access_pantry_item = MagicMock(return_value=True)
    svc.quick_add_from_search = AsyncMock(return_value={"item": {}, "item_id": "x", "was_new": True, "already_in_pantry": False, "household_id": None})
    return svc


@pytest.fixture
def mock_supabase_tier1():
    return MagicMock()


@pytest.fixture
def client_tier1(app, mock_pantry_tier1, mock_supabase_tier1):
    app.config["PANTRY_SERVICE"] = mock_pantry_tier1
    app.config["SUPABASE_SERVICE"] = mock_supabase_tier1
    return app.test_client()


class TestGroupAAuth:
    @pytest.mark.parametrize(
        "method, path, kwargs",
        [
            ("post", "/api/pantry/items", {"json": {"base_ingredient": "b", "quantity": 1, "unit": "ct"}}),
            ("put", "/api/pantry/items/i1", {"json": {"quantity": 2}}),
            ("delete", "/api/pantry/items/i1", {}),
            ("post", "/api/pantry/quick-add", {"json": {"base_ingredient": "egg"}}),
            ("post", "/api/pantry/items/i1/correction", {"json": {"action": "still_have_it"}}),
            (
                "post",
                "/api/pantry/cook",
                {
                    "json": {
                        "recipe_id": "r1",
                        "servings": 2,
                        "ingredients": [{"name": "x", "amount": 1, "unit": "ct"}],
                    }
                },
            ),
            ("post", "/api/pantry/items/i1/deplete", {}),
            ("post", "/api/pantry/put-back", {"json": {"depletion_history_id": "h1"}}),
            (
                "post",
                "/api/pantry/restore-item",
                {"json": {"snapshot": {"id": "p1", "user_id": "u1", "base_ingredient": "salt"}}},
            ),
            ("post", "/api/pantry/confirm-staples", {"json": {"selected_items": []}}),
            (
                "post",
                "/api/pantry/consume",
                {
                    "json": {
                        "recipe_id": "r",
                        "recipe_name": "n",
                        "servings": 1,
                        "ingredients": [{"name": "a", "amount": 1, "unit": "u"}],
                    }
                },
            ),
            ("post", "/api/pantry/check-recipe", {"json": {"ingredients": [{"name": "a", "amount": 1, "unit": "u"}]}}),
            (
                "post",
                "/api/pantry/voice-transcribe",
                {"data": {"audio": (io.BytesIO(b"0000"), "a.webm")}, "content_type": "multipart/form-data"},
            ),
            ("post", "/api/pantry/voice-confirm", {"json": {"items": ["milk"]}}),
            ("post", "/api/pantry/health-card/dismiss", {"json": {}}),
            ("delete", "/api/pantry/reset", {}),
        ],
    )
    def test_all_write_routes_return_401_without_user_header(
        self, client_tier1, mock_supabase_tier1, method, path, kwargs
    ):
        """POST/PUT/DELETE pantry routes require X-User-Id (staples-template is the only public read)."""
        mock_supabase_tier1.get_user_household.return_value = {"id": "hh-1"}
        fn = getattr(client_tier1, method)
        resp = fn(path, **kwargs)
        assert resp.status_code == 401

    @patch("backend.routes.pantry.get_calibrated_days_supply", return_value=45)
    @patch("backend.routes.pantry.get_engagement_multiplier", return_value=1.0)
    def test_household_scoped_read_rejects_non_member_with_403(
        self, _eng, _cal, client_tier1, mock_pantry_tier1, mock_supabase_tier1
    ):
        mock_supabase_tier1.get_user_household.return_value = {"id": "hh-real"}
        mock_pantry_tier1.get_pantry_summary.return_value = {
            "total_items": 0,
            "unique_ingredients": 0,
            "items": [],
            "grouped": [],
            "household_id": "hh-real",
        }
        resp = client_tier1.get(
            "/api/pantry?household_id=hh-other",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 403

    @pytest.mark.parametrize(
        "path",
        [
            "/api/pantry",
            "/api/pantry/graveyard",
            "/api/pantry/health-card",
            "/api/pantry/search-ingredients?q=ab",
            "/api/pantry/staples-receipt-matches",
        ],
    )
    def test_read_routes_require_user_except_staples_template(
        self, client_tier1, mock_supabase_tier1, path
    ):
        mock_supabase_tier1.search_canonical_ingredients.return_value = []
        resp = client_tier1.get(path)
        assert resp.status_code == 401


class TestGroupBAtomicMultiTable:
    @patch("backend.routes.pantry.process_cook_event")
    @patch("backend.routes.pantry.date")
    def test_cook_calls_process_cook_event_with_deterministic_today(
        self, mock_date, mock_cook, client_tier1, mock_supabase_tier1
    ):
        mock_date.today.return_value = TEST_DATE
        mock_supabase_tier1.admin_client = MagicMock()
        mock_cook.return_value = []
        resp = client_tier1.post(
            "/api/pantry/cook",
            data=json.dumps(
                {
                    "recipe_id": "rid",
                    "recipe_name": "Soup",
                    "servings": 2,
                    "ingredients": [{"name": "carrot", "amount": 1, "unit": "ct"}],
                }
            ),
            content_type="application/json",
            headers={"X-User-Id": "user-a"},
        )
        assert resp.status_code == 200
        mock_cook.assert_called_once()
        assert mock_cook.call_args[1]["today"] == TEST_DATE

    def test_cook_rolls_back_on_depletion_rpc_failure_does_not_log_cook(
        self, client_tier1, mock_supabase_tier1
    ):
        """
        If atomic soft-delete RPC fails mid-event, the route must not append cooking_log.
        (Mirrors migration `soft_delete_pantry_item` + `process_cook_event` ordering.)
        """
        admin = MagicMock()
        # `_client()` in confidence_engine prefers `.admin_client` / `.client`; default MagicMock
        # children are truthy and would replace this instance — clear them so `process_cook_event`
        # uses the same client we configure for `.table(...)`.
        admin.admin_client = None
        admin.client = None
        mock_supabase_tier1.admin_client = admin
        pantry_row = [
            {
                "id": "p1",
                "user_id": "user-a",
                "base_ingredient": "chicken",
                "depletion_class": "UNIT_ITEM",
                "quantity_remaining": 1.0,
                "quantity_purchased": 1.0,
                "put_back_count": 0,
            }
        ]
        sel_chain = Mock()
        sel_chain.is_.return_value = sel_chain
        sel_chain.eq.return_value = sel_chain
        sel_chain.execute.return_value = Mock(data=pantry_row)
        admin.table.return_value.select.return_value = sel_chain
        with patch(
            "backend.services.confidence_engine._rpc_soft_delete_pantry_item",
            side_effect=RuntimeError("simulated rpc failure"),
        ):
            resp = client_tier1.post(
                "/api/pantry/cook",
                data=json.dumps(
                    {
                        "recipe_id": "r1",
                        "servings": 1,
                        "ingredients": [{"name": "chicken", "amount": 1, "unit": "lb"}],
                    }
                ),
                content_type="application/json",
                headers={"X-User-Id": "user-a"},
            )
        assert resp.status_code == 500
        table_names = [c[0][0] for c in admin.table.call_args_list]
        assert "cooking_log" not in table_names

    @patch("backend.routes.pantry.process_put_back")
    def test_put_back_rejects_meat_beyond_max_subclass_limit(
        self, mock_pb, client_tier1, mock_supabase_tier1
    ):
        from backend.services.confidence_engine import MAX_PUT_BACK_SUBCLASSES

        assert "raw_meat" in MAX_PUT_BACK_SUBCLASSES
        mock_supabase_tier1.admin_client = MagicMock()
        mock_pb.return_value = (None, "MAX_PUT_BACK_REACHED")
        resp = client_tier1.post(
            "/api/pantry/put-back",
            data=json.dumps({"depletion_history_id": "h1"}),
            content_type="application/json",
            headers={"X-User-Id": "user-a"},
        )
        assert resp.status_code == 409

    def test_restore_item_reinserts_soft_deleted_row_with_original_id(
        self, client_tier1, mock_pantry_tier1, mock_supabase_tier1
    ):
        mock_supabase_tier1.get_user_household.return_value = {"id": "hh-1"}
        oid = "11111111-1111-1111-1111-111111111111"
        mock_pantry_tier1.restore_pantry_item.return_value = oid
        snap = {
            "id": oid,
            "user_id": "user-a",
            "household_id": "hh-1",
            "base_ingredient": "flour",
            "variant": None,
            "normalized_name": "flour",
            "quantity": 1,
            "unit": "lb",
        }
        resp = client_tier1.post(
            "/api/pantry/restore-item",
            data=json.dumps({"snapshot": snap}),
            content_type="application/json",
            headers={"X-User-Id": "user-a"},
        )
        assert resp.status_code == 200
        body = json.loads(resp.data)
        assert body["item_id"] == oid

    def test_deplete_failure_surfaces_without_success_payload(self, client_tier1, mock_pantry_tier1, mock_supabase_tier1):
        mock_supabase_tier1.get_user_household.return_value = {"id": "hh-1"}
        mock_pantry_tier1.deplete_pantry_item.side_effect = DatabaseException("db")
        resp = client_tier1.post(
            "/api/pantry/items/item-xyz/deplete",
            headers={"X-User-Id": "user-a"},
        )
        assert resp.status_code == 500

    def test_confirm_staples_failure_returns_500(self, client_tier1, mock_pantry_tier1, mock_supabase_tier1):
        mock_supabase_tier1.get_user_household.return_value = {"id": "hh-1"}
        mock_pantry_tier1.confirm_staples_batch.side_effect = DatabaseException("atomic batch failed")
        resp = client_tier1.post(
            "/api/pantry/confirm-staples",
            data=json.dumps({"selected_items": ["milk"]}),
            content_type="application/json",
            headers={"X-User-Id": "user-a"},
        )
        assert resp.status_code == 500

    def test_consume_failure_returns_500(self, client_tier1, mock_pantry_tier1, mock_supabase_tier1):
        mock_supabase_tier1.get_user_household.return_value = {"id": "hh-1"}
        mock_pantry_tier1.consume_ingredients.side_effect = DatabaseException("multi-table failure")
        resp = client_tier1.post(
            "/api/pantry/consume",
            data=json.dumps(
                {
                    "recipe_id": "r",
                    "recipe_name": "n",
                    "servings": 1,
                    "ingredients": [{"name": "a", "amount": 1, "unit": "u"}],
                }
            ),
            content_type="application/json",
            headers={"X-User-Id": "user-a"},
        )
        assert resp.status_code == 500


class TestGroupCValidation:
    def test_cook_returns_400_when_servings_is_zero_or_missing(self, client_tier1, mock_supabase_tier1):
        mock_supabase_tier1.admin_client = MagicMock()
        r1 = client_tier1.post(
            "/api/pantry/cook",
            data=json.dumps(
                {
                    "recipe_id": "r",
                    "servings": 0,
                    "ingredients": [{"name": "a", "amount": 1, "unit": "u"}],
                }
            ),
            content_type="application/json",
            headers={"X-User-Id": "u"},
        )
        assert r1.status_code == 400
        r2 = client_tier1.post(
            "/api/pantry/cook",
            data=json.dumps({"recipe_id": "r", "ingredients": [{"name": "a", "amount": 1, "unit": "u"}]}),
            content_type="application/json",
            headers={"X-User-Id": "u"},
        )
        assert r2.status_code == 400

    def test_update_quantity_accepts_zero(self, client_tier1, mock_supabase_tier1):
        mock_supabase_tier1.get_user_household.return_value = {"id": "hh-1"}
        resp = client_tier1.put(
            "/api/pantry/items/q1",
            data=json.dumps({"quantity": 0}),
            content_type="application/json",
            headers={"X-User-Id": "user-a"},
        )
        assert resp.status_code == 200
        mock_supabase_tier1.update_pantry_quantity.assert_called_with("q1", 0.0)

    def test_quick_add_rejects_blank_base_ingredient(self, client_tier1, mock_supabase_tier1):
        mock_supabase_tier1.get_user_household.return_value = {"id": "hh-1"}
        resp = client_tier1.post(
            "/api/pantry/quick-add",
            data=json.dumps({"base_ingredient": "   "}),
            content_type="application/json",
            headers={"X-User-Id": "user-a"},
        )
        assert resp.status_code == 400


class TestGroupDSearch:
    def test_search_ingredients_excludes_existing_pantry_by_exact_base_ingredient(
        self, client_tier1, mock_supabase_tier1
    ):
        mock_supabase_tier1.search_canonical_ingredients.return_value = []
        client_tier1.get(
            "/api/pantry/search-ingredients?q=sugar&exclude=butter%2Ccinnamon",
            headers={"X-User-Id": "u1"},
        )
        mock_supabase_tier1.search_canonical_ingredients.assert_called()
        _, kwargs = mock_supabase_tier1.search_canonical_ingredients.call_args
        assert kwargs.get("exclude_bases") == ["butter", "cinnamon"]

    def test_search_ingredients_does_not_match_on_substring(self, client_tier1, mock_supabase_tier1):
        """
        Contract mirrored from `search_canonical_ingredients` RPC: querying `rice` must not
        surface unrelated bases such as `rice vinegar` unless explicitly desired.
        """

        def _stub_search(query: str, limit: int, exclude_bases=None):
            ex = {x.lower() for x in (exclude_bases or [])}
            rows = [
                {"base_ingredient": "rice", "display_name": "Rice", "category": "Grains"},
                {
                    "base_ingredient": "rice vinegar",
                    "display_name": "Rice vinegar",
                    "category": "Oils & Vinegars",
                },
            ]
            return [r for r in rows if r["base_ingredient"] not in ex and "vinegar" not in r["base_ingredient"]]

        mock_supabase_tier1.search_canonical_ingredients.side_effect = _stub_search
        resp = client_tier1.get(
            "/api/pantry/search-ingredients?q=rice",
            headers={"X-User-Id": "u1"},
        )
        assert resp.status_code == 200
        bases = {x["base_ingredient"] for x in json.loads(resp.data)["results"]}
        assert "rice vinegar" not in bases


class TestGroupEVoice:
    def test_voice_transcribe_accepts_webm_and_mp4_content_types(self, app, mock_supabase_tier1):
        from werkzeug.datastructures import FileStorage

        ai = MagicMock()
        ai.client = object()
        ai.transcribe_audio = MagicMock(return_value="bought milk")
        ai.extract_ingredients_from_transcript = MagicMock(return_value={"items": [], "uncertain": []})
        app.config["SUPABASE_SERVICE"] = mock_supabase_tier1
        app.config["AI_SERVICE"] = ai
        mock_supabase_tier1.list_active_canonical_ingredients_compact.return_value = []
        client = app.test_client()

        for ct in ("audio/webm", "audio/mp4"):
            buf = io.BytesIO(b"0000")
            fs = FileStorage(stream=buf, filename="clip.bin", content_type=ct)
            resp = client.post(
                "/api/pantry/voice-transcribe",
                data={"audio": fs},
                content_type="multipart/form-data",
                headers={"X-User-Id": "u1"},
            )
            assert resp.status_code == 200
        mimes = {c[0][1] for c in ai.transcribe_audio.call_args_list}
        assert mimes == {"audio/webm", "audio/mp4"}

    def test_voice_confirm_persists_only_confirmed_items(
        self, app, mock_pantry_tier1, mock_supabase_tier1
    ):
        app.config["PANTRY_SERVICE"] = mock_pantry_tier1
        app.config["SUPABASE_SERVICE"] = mock_supabase_tier1
        mock_supabase_tier1.get_user_household.return_value = {"id": "hh-1"}

        def _canon(base: str):
            if base.strip().lower() == "milk":
                return {"base_ingredient": "milk", "display_name": "Milk", "category": "Dairy"}
            return None

        mock_supabase_tier1.get_canonical_ingredient_by_base.side_effect = _canon
        client = app.test_client()
        resp = client.post(
            "/api/pantry/voice-confirm",
            data=json.dumps({"items": ["milk", "", " ", "not-a-canonical"]}),
            content_type="application/json",
            headers={"X-User-Id": "user-a"},
        )
        assert resp.status_code == 200
        mock_pantry_tier1.batch_add_or_merge_items.assert_awaited()
        args, _ = mock_pantry_tier1.batch_add_or_merge_items.call_args
        batch = args[2]
        assert len(batch) == 1
        assert batch[0]["base_ingredient"] == "milk"


class TestPostgrestStubUsedForRouteAssertion:
    def test_stub_records_rpc_and_table_shapes(self):
        stub = PostgrestClientStub()
        stub.queue_response([{"id": "1"}])
        stub.table("canonical_ingredients").select("*").eq("base_ingredient", "rice").execute()
        stub.rpc(
            "search_canonical_ingredients",
            {"p_query": "rice", "p_limit": 6, "p_exclude": []},
        ).execute()
        assert any("table" in str(c[0]) for c in stub.chains)
        assert len(stub.chains) >= 2


class TestHappyPathSmoke:
    """One lightweight happy-path per route not already exercised elsewhere."""

    def test_staples_template_public_ok(self, app, mock_supabase_tier1):
        mock_supabase_tier1.get_staples_template_rows.return_value = []
        app.config["SUPABASE_SERVICE"] = mock_supabase_tier1
        cl = app.test_client()
        r = cl.get("/api/pantry/staples-template")
        assert r.status_code == 200

    @patch("backend.routes.pantry.get_calibrated_days_supply", return_value=45)
    @patch("backend.routes.pantry.get_engagement_multiplier", return_value=1.0)
    def test_search_ingredients_happy(
        self, _a, _b, client_tier1, mock_supabase_tier1
    ):
        mock_supabase_tier1.search_canonical_ingredients.return_value = [
            {"base_ingredient": "salt", "display_name": "Salt", "category": "Spices"}
        ]
        r = client_tier1.get(
            "/api/pantry/search-ingredients?q=sa",
            headers={"X-User-Id": "u1"},
        )
        assert r.status_code == 200

    def test_reset_happy(self, client_tier1, mock_supabase_tier1):
        mock_supabase_tier1.get_user_household.return_value = {"id": "hh-1"}
        r = client_tier1.delete("/api/pantry/reset", headers={"X-User-Id": "u1"})
        assert r.status_code == 200
        mock_supabase_tier1.reset_pantry.assert_called_once()
