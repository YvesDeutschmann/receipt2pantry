"""Phase 4 pantry API: cook, graveyard, put-back, health card, corrections, enriched GET /pantry."""

import json
from datetime import date
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

TEST_DATE = date(2026, 4, 10)


@pytest.fixture
def mock_pantry_service():
    service = MagicMock()
    service.get_pantry_summary = AsyncMock()
    service.user_can_access_pantry_item = MagicMock(return_value=True)
    return service


@pytest.fixture
def mock_supabase_service():
    return MagicMock()


@pytest.fixture
def client_phase4(app, mock_pantry_service, mock_supabase_service):
    app.config["PANTRY_SERVICE"] = mock_pantry_service
    app.config["SUPABASE_SERVICE"] = mock_supabase_service
    return app.test_client()


class TestPantryCook:
    @patch("backend.routes.pantry.process_cook_event")
    @patch("backend.routes.pantry.date")
    def test_COOK_ENDPOINT_HAPPY_PATH(
        self, mock_date, mock_cook, client_phase4, mock_supabase_service
    ):
        mock_date.today.return_value = TEST_DATE
        mock_supabase_service.admin_client = MagicMock()
        mock_cook.return_value = [
            {
                "pantry_item_id": "p1",
                "base_ingredient": "chicken breast",
                "depletion_class": "PERISHABLE",
            }
        ]
        resp = client_phase4.post(
            "/api/pantry/cook",
            data=json.dumps(
                {
                    "recipe_id": "12345",
                    "recipe_name": "Spinach Frittata",
                    "servings": 4,
                    "ingredients": [
                        {"name": "chicken breast", "amount": 1, "unit": "lb"},
                        {"name": "spinach", "amount": 2, "unit": "cups"},
                    ],
                }
            ),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert data["ok"] is True
        assert len(data["touched"]) == 1
        assert data["touched"][0]["base_ingredient"] == "chicken breast"
        mock_cook.assert_called_once()
        call_kw = mock_cook.call_args
        assert call_kw[0][1] == "user-1"
        assert call_kw[0][2] == "12345"
        assert call_kw[0][3] == 4
        assert call_kw[1]["today"] == TEST_DATE
        assert call_kw[1]["recipe_name"] == "Spinach Frittata"

    def test_COOK_ENDPOINT_MISSING_RECIPE_ID(self, client_phase4, mock_supabase_service):
        mock_supabase_service.admin_client = MagicMock()
        resp = client_phase4.post(
            "/api/pantry/cook",
            data=json.dumps({"servings": 4, "ingredients": [{"name": "x"}]}),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 400

    def test_COOK_ENDPOINT_MISSING_SERVINGS(self, client_phase4, mock_supabase_service):
        mock_supabase_service.admin_client = MagicMock()
        resp = client_phase4.post(
            "/api/pantry/cook",
            data=json.dumps(
                {"recipe_id": "1", "ingredients": [{"name": "x"}]}
            ),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 400

    def test_COOK_ENDPOINT_EMPTY_INGREDIENTS(self, client_phase4, mock_supabase_service):
        mock_supabase_service.admin_client = MagicMock()
        resp = client_phase4.post(
            "/api/pantry/cook",
            data=json.dumps({"recipe_id": "1", "servings": 2, "ingredients": []}),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 400

    def test_COOK_ENDPOINT_EMPTY_INGREDIENTS_UNKNOWN_STAPLE(
        self, client_phase4, mock_supabase_service
    ):
        mock_supabase_service.admin_client = MagicMock()
        resp = client_phase4.post(
            "/api/pantry/cook",
            data=json.dumps(
                {
                    "recipe_id": "staple_not_real",
                    "servings": 2,
                    "ingredients": [],
                }
            ),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 400

    @patch("backend.routes.pantry.process_cook_event")
    @patch("backend.routes.pantry.date")
    def test_COOK_ENDPOINT_EMPTY_INGREDIENTS_ALLOWLISTED_STAPLE(
        self, mock_date, mock_cook, client_phase4, mock_supabase_service
    ):
        mock_date.today.return_value = TEST_DATE
        mock_supabase_service.admin_client = MagicMock()
        mock_cook.return_value = []
        resp = client_phase4.post(
            "/api/pantry/cook",
            data=json.dumps(
                {
                    "recipe_id": "staple_omelette",
                    "recipe_name": "Omelette",
                    "servings": 2,
                    "ingredients": [],
                }
            ),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 200
        assert json.loads(resp.data) == {"ok": True, "touched": []}
        mock_cook.assert_called_once()
        assert mock_cook.call_args[0][2] == "staple_omelette"
        assert mock_cook.call_args[0][4] == []


    @patch("backend.routes.pantry.process_cook_event")
    @patch("backend.routes.pantry.date")
    def test_COOK_ENDPOINT_POOL_SWIPE(
        self, mock_date, mock_cook, client_phase4, mock_supabase_service, app
    ):
        mock_date.today.return_value = TEST_DATE
        mock_supabase_service.admin_client = MagicMock()
        mock_supabase_service.get_user_household.return_value = {"id": "hh-1"}
        mock_cook.return_value = []
        pool_store = MagicMock()
        app.config["POOL_STORE_SERVICE"] = pool_store
        resp = client_phase4.post(
            "/api/pantry/cook",
            data=json.dumps(
                {
                    "recipe_id": "12345",
                    "recipe_name": "Soup",
                    "servings": 2,
                    "ingredients": [{"name": "carrot", "amount": 1}],
                    "household_id": "hh-1",
                    "pool_suggestion_id": "sug-1",
                }
            ),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 200
        pool_store.update_status.assert_called_once_with("sug-1", "hh-1", "swiped")

    @patch("backend.routes.pantry.process_cook_event")
    @patch("backend.routes.pantry.date")
    def test_COOK_SWIPE_FAILURE_STILL_RETURNS_OK(
        self, mock_date, mock_cook, client_phase4, mock_supabase_service, app
    ):
        mock_date.today.return_value = TEST_DATE
        mock_supabase_service.admin_client = MagicMock()
        mock_supabase_service.get_user_household.return_value = {"id": "hh-1"}
        mock_cook.return_value = []
        pool_store = MagicMock()
        pool_store.update_status.side_effect = RuntimeError("network")
        app.config["POOL_STORE_SERVICE"] = pool_store
        resp = client_phase4.post(
            "/api/pantry/cook",
            data=json.dumps(
                {
                    "recipe_id": "12345",
                    "recipe_name": "Soup",
                    "servings": 2,
                    "ingredients": [{"name": "carrot", "amount": 1}],
                    "household_id": "hh-1",
                    "pool_suggestion_id": "sug-1",
                }
            ),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 200
        assert json.loads(resp.data)["ok"] is True

    @patch("backend.routes.pantry.process_cook_event")
    @patch("backend.routes.pantry.date")
    def test_COOK_RESOLVES_HOUSEHOLD_WHEN_BODY_OMITS_IT(
        self, mock_date, mock_cook, client_phase4, mock_supabase_service
    ):
        mock_date.today.return_value = TEST_DATE
        mock_supabase_service.admin_client = MagicMock()
        mock_supabase_service.get_user_household.return_value = {"id": "hh-1"}
        mock_cook.return_value = []
        resp = client_phase4.post(
            "/api/pantry/cook",
            data=json.dumps(
                {
                    "recipe_id": "12345",
                    "recipe_name": "Soup",
                    "servings": 2,
                    "ingredients": [{"name": "carrot", "amount": 1}],
                }
            ),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 200
        assert mock_cook.call_args.kwargs["household_id"] == "hh-1"

    @patch("backend.routes.pantry.process_cook_event")
    @patch("backend.routes.pantry.date")
    def test_COOK_INVALIDATES_SUGGESTION_CACHE(
        self, mock_date, mock_cook, client_phase4, mock_supabase_service, app
    ):
        mock_date.today.return_value = TEST_DATE
        mock_supabase_service.admin_client = MagicMock()
        mock_supabase_service.get_user_household.return_value = {"id": "hh-1"}
        mock_cook.return_value = []
        suggestion_svc = MagicMock()
        app.config["SUGGESTION_SERVICE"] = suggestion_svc
        resp = client_phase4.post(
            "/api/pantry/cook",
            data=json.dumps(
                {
                    "recipe_id": "12345",
                    "recipe_name": "Soup",
                    "servings": 2,
                    "ingredients": [{"name": "carrot", "amount": 1}],
                    "household_id": "hh-1",
                }
            ),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 200
        suggestion_svc.invalidate_suggestion_cache.assert_called_once_with(
            "user-1", "hh-1"
        )


class TestGraveyard:
    def test_GRAVEYARD_RETURNS_RECENT_ITEMS(
        self, client_phase4, mock_supabase_service
    ):
        admin = MagicMock()
        mock_supabase_service.admin_client = admin
        mock_supabase_service.get_item_classifications_by_names.return_value = {}
        mock_supabase_service.get_canonical_ingredient_by_base.return_value = None

        m = Mock()
        # Simulates DB rows after gte(deleted_at, cutoff): excludes 8+ day old
        m.data = [
            {
                "id": "h1",
                "pantry_item_id": "p1",
                "item_name": "today",
                "deleted_at": "2026-04-10T00:00:00+00:00",
                "reason": "USER_REMOVED",
                "put_back_count": 0,
            },
            {
                "id": "h2",
                "pantry_item_id": "p2",
                "item_name": "3d",
                "deleted_at": "2026-04-07T00:00:00+00:00",
                "reason": "AUTO_EXPIRED",
                "put_back_count": 0,
            },
        ]
        (
            admin.table.return_value.select.return_value.eq.return_value.gte.return_value.in_.return_value.order.return_value.execute.return_value
        ) = m

        with patch("backend.routes.pantry.date") as mock_date:
            mock_date.today.return_value = TEST_DATE
            resp = client_phase4.get(
                "/api/pantry/graveyard", headers={"X-User-Id": "user-1"}
            )

        assert resp.status_code == 200
        data = json.loads(resp.data)
        ids = {x["depletion_history_id"] for x in data["items"]}
        assert ids == {"h1", "h2"}

    def test_GRAVEYARD_INCLUDES_SUB_CLASS(
        self, client_phase4, mock_supabase_service
    ):
        admin = MagicMock()
        mock_supabase_service.admin_client = admin
        mock_supabase_service.get_item_classifications_by_names.return_value = {
            "chicken breast": {"sub_class": "raw_meat"}
        }
        mock_supabase_service.get_canonical_ingredient_by_base.return_value = {
            "base_ingredient": "chicken breast",
            "display_name": "Chicken Breast",
        }

        m = Mock()
        m.data = [
            {
                "id": "h1",
                "pantry_item_id": "p1",
                "item_name": "chicken breast",
                "deleted_at": "2026-04-10T00:00:00+00:00",
                "reason": "USER_REMOVED",
                "put_back_count": 0,
            }
        ]
        (
            admin.table.return_value.select.return_value.eq.return_value.gte.return_value.in_.return_value.order.return_value.execute.return_value
        ) = m

        with patch("backend.routes.pantry.date") as mock_date:
            mock_date.today.return_value = TEST_DATE
            resp = client_phase4.get(
                "/api/pantry/graveyard", headers={"X-User-Id": "user-1"}
            )

        assert resp.status_code == 200
        row = json.loads(resp.data)["items"][0]
        assert row["sub_class"] == "raw_meat"
        assert row["normalized_name"] == "Chicken Breast"

    def test_GRAVEYARD_EMPTY_RETURNS_EMPTY_LIST(
        self, client_phase4, mock_supabase_service
    ):
        admin = MagicMock()
        mock_supabase_service.admin_client = admin
        mock_supabase_service.get_item_classifications_by_names.return_value = {}
        mock_supabase_service.get_canonical_ingredient_by_base.return_value = None
        m = Mock()
        m.data = []
        (
            admin.table.return_value.select.return_value.eq.return_value.gte.return_value.in_.return_value.order.return_value.execute.return_value
        ) = m

        with patch("backend.routes.pantry.date") as mock_date:
            mock_date.today.return_value = TEST_DATE
            resp = client_phase4.get(
                "/api/pantry/graveyard", headers={"X-User-Id": "user-1"}
            )

        assert json.loads(resp.data) == {"items": []}


class TestPutBack:
    @patch("backend.routes.pantry.process_put_back")
    @patch("backend.routes.pantry.date")
    def test_PUT_BACK_HAPPY_PATH(
        self, mock_date, mock_pb, client_phase4, mock_supabase_service
    ):
        mock_date.today.return_value = TEST_DATE
        mock_supabase_service.admin_client = MagicMock()
        pantry_row = {"id": "pi1", "base_ingredient": "spinach"}
        mock_pb.return_value = (pantry_row, None)
        resp = client_phase4.post(
            "/api/pantry/put-back",
            data=json.dumps({"depletion_history_id": "dh-1"}),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert data["ok"] is True
        assert data["item"] == pantry_row

    @patch("backend.routes.pantry.process_put_back")
    @patch("backend.routes.pantry.date")
    def test_PUT_BACK_RAW_MEAT_BLOCKED(
        self, mock_date, mock_pb, client_phase4, mock_supabase_service
    ):
        mock_date.today.return_value = TEST_DATE
        mock_supabase_service.admin_client = MagicMock()
        mock_pb.return_value = (None, "MAX_PUT_BACK_REACHED")
        resp = client_phase4.post(
            "/api/pantry/put-back",
            data=json.dumps({"depletion_history_id": "dh-1"}),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 409
        assert json.loads(resp.data) == {"error": "MAX_PUT_BACK_REACHED"}

    @patch("backend.routes.pantry.process_put_back")
    @patch("backend.routes.pantry.date")
    def test_PUT_BACK_NOT_FOUND(
        self, mock_date, mock_pb, client_phase4, mock_supabase_service
    ):
        mock_date.today.return_value = TEST_DATE
        mock_supabase_service.admin_client = MagicMock()
        mock_pb.return_value = (None, "NOT_FOUND")
        resp = client_phase4.post(
            "/api/pantry/put-back",
            data=json.dumps({"depletion_history_id": "bad"}),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 400
        assert json.loads(resp.data) == {"error": "NOT_FOUND"}


class TestHealthCard:
    @patch("backend.routes.pantry.compute_confidence")
    @patch("backend.routes.pantry.get_calibrated_days_supply", return_value=45)
    @patch("backend.routes.pantry.get_engagement_multiplier", return_value=1.0)
    @patch("backend.routes.pantry.date")
    def test_HEALTH_CARD_SHOWS_LOW_CONFIDENCE_ITEMS(
        self,
        mock_date,
        mock_eng,
        mock_cal,
        mock_conf,
        client_phase4,
        mock_pantry_service,
        mock_supabase_service,
    ):
        mock_date.today.return_value = TEST_DATE
        mock_supabase_service.admin_client = MagicMock()
        mock_supabase_service.get_user_preferences.return_value = {
            "last_health_card_shown": "2026-04-02",
            "depletion_multiplier": 1.5,
        }

        def conf_side(item, *a, **k):
            return {"a": 0.25, "b": 0.40, "c": 0.55, "d": 0.80}[item["id"]]

        mock_conf.side_effect = conf_side
        mock_pantry_service.get_pantry_summary.return_value = {
            "items": [
                {
                    "id": "a",
                    "base_ingredient": "a",
                    "normalized_name": "A",
                    "depletion_class": "CONSUMABLE",
                },
                {
                    "id": "b",
                    "base_ingredient": "b",
                    "normalized_name": "B",
                    "depletion_class": "CONSUMABLE",
                },
                {
                    "id": "c",
                    "base_ingredient": "c",
                    "normalized_name": "C",
                    "depletion_class": "CONSUMABLE",
                },
                {
                    "id": "d",
                    "base_ingredient": "d",
                    "normalized_name": "D",
                    "depletion_class": "CONSUMABLE",
                },
            ],
            "grouped": [],
        }
        mock_supabase_service.get_item_classifications_by_names.return_value = {}

        resp = client_phase4.get(
            "/api/pantry/health-card", headers={"X-User-Id": "user-1"}
        )
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert data["show"] is True
        confs = [x["confidence"] for x in data["items"]]
        assert confs == [0.25, 0.40, 0.55]

    @patch("backend.routes.pantry.compute_confidence", return_value=0.5)
    @patch("backend.routes.pantry.get_calibrated_days_supply", return_value=45)
    @patch("backend.routes.pantry.get_engagement_multiplier", return_value=1.0)
    @patch("backend.routes.pantry.date")
    def test_HEALTH_CARD_RESPECTS_COOLDOWN(
        self,
        mock_date,
        mock_eng,
        mock_cal,
        mock_conf,
        client_phase4,
        mock_pantry_service,
        mock_supabase_service,
    ):
        mock_date.today.return_value = TEST_DATE
        mock_supabase_service.admin_client = MagicMock()
        mock_supabase_service.get_user_preferences.return_value = {
            "last_health_card_shown": "2026-04-07"
        }
        mock_pantry_service.get_pantry_summary.return_value = {"items": [], "grouped": []}

        resp = client_phase4.get(
            "/api/pantry/health-card", headers={"X-User-Id": "user-1"}
        )
        assert resp.status_code == 200
        assert json.loads(resp.data) == {"show": False, "items": []}

    @patch("backend.routes.pantry.compute_confidence", return_value=0.85)
    @patch("backend.routes.pantry.get_calibrated_days_supply", return_value=45)
    @patch("backend.routes.pantry.get_engagement_multiplier", return_value=1.0)
    @patch("backend.routes.pantry.date")
    def test_HEALTH_CARD_SHOW_FALSE_WHEN_NO_ITEMS_IN_RANGE(
        self,
        mock_date,
        mock_eng,
        mock_cal,
        mock_conf,
        client_phase4,
        mock_pantry_service,
        mock_supabase_service,
    ):
        """No pantry items in 0.20–0.60 confidence band → show false."""
        mock_date.today.return_value = TEST_DATE
        mock_supabase_service.admin_client = MagicMock()
        mock_supabase_service.get_user_preferences.return_value = {
            "last_health_card_shown": "2026-04-02",
        }
        mock_pantry_service.get_pantry_summary.return_value = {
            "items": [
                {
                    "id": "a",
                    "base_ingredient": "a",
                    "normalized_name": "A",
                    "depletion_class": "CONSUMABLE",
                },
            ],
            "grouped": [],
        }
        mock_supabase_service.get_item_classifications_by_names.return_value = {}

        resp = client_phase4.get(
            "/api/pantry/health-card", headers={"X-User-Id": "user-1"}
        )
        assert resp.status_code == 200
        assert json.loads(resp.data) == {"show": False, "items": []}

    @patch("backend.routes.pantry.compute_confidence", return_value=0.35)
    @patch("backend.routes.pantry.get_calibrated_days_supply", return_value=45)
    @patch("backend.routes.pantry.get_engagement_multiplier", return_value=1.0)
    @patch("backend.routes.pantry.date")
    def test_HEALTH_CARD_MAX_FIVE_ITEMS(
        self,
        mock_date,
        mock_eng,
        mock_cal,
        mock_conf,
        client_phase4,
        mock_pantry_service,
        mock_supabase_service,
    ):
        mock_date.today.return_value = TEST_DATE
        mock_supabase_service.admin_client = MagicMock()
        mock_supabase_service.get_user_preferences.return_value = {
            "last_health_card_shown": "2026-04-02"
        }
        items = [
            {
                "id": str(i),
                "base_ingredient": f"b{i}",
                "normalized_name": f"N{i}",
                "depletion_class": "CONSUMABLE",
            }
            for i in range(10)
        ]
        mock_pantry_service.get_pantry_summary.return_value = {"items": items, "grouped": []}
        mock_supabase_service.get_item_classifications_by_names.return_value = {}

        resp = client_phase4.get(
            "/api/pantry/health-card", headers={"X-User-Id": "user-1"}
        )
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert len(data["items"]) <= 5


class TestCorrections:
    @patch("backend.routes.pantry.date")
    def test_CORRECTION_STILL_HAVE_IT(
        self, mock_date, client_phase4, mock_pantry_service, mock_supabase_service
    ):
        mock_date.today.return_value = TEST_DATE
        admin = MagicMock()
        mock_supabase_service.admin_client = admin
        mock_supabase_service.get_pantry_item_by_id.return_value = {
            "id": "item-1",
            "user_id": "user-1",
            "base_ingredient": "salt",
            "normalized_name": "Salt",
            "deleted_at": None,
        }
        resp = client_phase4.post(
            "/api/pantry/items/item-1/correction",
            data=json.dumps({"action": "still_have_it"}),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 200
        assert json.loads(resp.data) == {"ok": True}
        admin.table.return_value.update.return_value.eq.return_value.execute.assert_called_once()
        upd = admin.table.return_value.update.call_args[0][0]
        assert upd["confidence_override"] == 0.80
        assert upd["confidence_override_expires"] == "2026-04-24"

    @patch("backend.routes.pantry._rpc_soft_delete_pantry_item")
    @patch("backend.routes.pantry.date")
    def test_CORRECTION_USED_IT_UP(
        self, mock_date, mock_rpc, client_phase4, mock_pantry_service, mock_supabase_service
    ):
        mock_date.today.return_value = TEST_DATE
        admin = MagicMock()
        mock_supabase_service.admin_client = admin
        mock_supabase_service.get_pantry_item_by_id.return_value = {
            "id": "item-1",
            "user_id": "user-1",
            "base_ingredient": "salt",
            "normalized_name": "Salt",
            "depletion_class": "CONSUMABLE",
            "purchase_date": "2026-04-01",
            "put_back_count": 0,
            "deleted_at": None,
        }
        resp = client_phase4.post(
            "/api/pantry/items/item-1/correction",
            data=json.dumps({"action": "used_it_up"}),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 200
        mock_rpc.assert_called_once()
        kwargs = mock_rpc.call_args[1]
        assert kwargs["reason"] == "USER_REMOVED"

    @patch("backend.routes.pantry._rpc_soft_delete_pantry_item")
    @patch("backend.routes.pantry.date")
    def test_CORRECTION_USED_IT_UP_HOUSEMATE_ROW(
        self, mock_date, mock_rpc, client_phase4, mock_pantry_service, mock_supabase_service
    ):
        mock_date.today.return_value = TEST_DATE
        mock_supabase_service.admin_client = MagicMock()
        mock_supabase_service.get_pantry_item_by_id.return_value = {
            "id": "item-1",
            "user_id": "housemate",
            "base_ingredient": "salt",
            "normalized_name": "Salt",
            "depletion_class": "CONSUMABLE",
            "purchase_date": "2026-04-01",
            "put_back_count": 0,
            "deleted_at": None,
        }
        resp = client_phase4.post(
            "/api/pantry/items/item-1/correction",
            data=json.dumps({"action": "used_it_up"}),
            content_type="application/json",
            headers={"X-User-Id": "partner"},
        )
        assert resp.status_code == 200
        mock_rpc.assert_called_once()
        assert mock_rpc.call_args[1]["user_id"] == "housemate"

    @patch("backend.routes.pantry._rpc_soft_delete_pantry_item")
    @patch("backend.routes.pantry.date")
    def test_CORRECTION_NEVER_HAD_IT(
        self, mock_date, mock_rpc, client_phase4, mock_pantry_service, mock_supabase_service
    ):
        mock_date.today.return_value = TEST_DATE
        mock_supabase_service.admin_client = MagicMock()
        mock_supabase_service.get_pantry_item_by_id.return_value = {
            "id": "item-1",
            "user_id": "user-1",
            "base_ingredient": "salt",
            "normalized_name": "Salt",
            "depletion_class": "CONSUMABLE",
            "purchase_date": None,
            "put_back_count": 0,
            "deleted_at": None,
        }
        resp = client_phase4.post(
            "/api/pantry/items/item-1/correction",
            data=json.dumps({"action": "never_had_it"}),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 200
        kwargs = mock_rpc.call_args[1]
        assert kwargs["reason"] == "NEVER_HAD"

    @patch("backend.routes.pantry.date")
    def test_CORRECTION_INVALIDATES_SUGGESTION_CACHE(
        self, mock_date, client_phase4, mock_supabase_service, app
    ):
        mock_date.today.return_value = TEST_DATE
        mock_supabase_service.admin_client = MagicMock()
        mock_supabase_service.get_pantry_item_by_id.return_value = {
            "id": "item-1",
            "user_id": "user-1",
            "household_id": "hh-1",
            "base_ingredient": "salt",
            "normalized_name": "Salt",
            "deleted_at": None,
        }
        suggestion_svc = MagicMock()
        app.config["SUGGESTION_SERVICE"] = suggestion_svc
        resp = client_phase4.post(
            "/api/pantry/items/item-1/correction",
            data=json.dumps({"action": "still_have_it"}),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 200
        suggestion_svc.invalidate_suggestion_cache.assert_called_once_with(
            "user-1", "hh-1"
        )

    def test_CORRECTION_INVALID_ACTION(
        self, client_phase4, mock_supabase_service
    ):
        mock_supabase_service.admin_client = MagicMock()
        mock_supabase_service.get_pantry_item_by_id.return_value = {
            "id": "item-1",
            "user_id": "user-1",
            "deleted_at": None,
        }
        resp = client_phase4.post(
            "/api/pantry/items/item-1/correction",
            data=json.dumps({"action": "foo"}),
            content_type="application/json",
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status_code == 400


class TestHealthCardDismiss:
    def test_HEALTH_CARD_DISMISS(self, client_phase4, mock_supabase_service):
        admin = MagicMock()
        mock_supabase_service.admin_client = admin
        mock_supabase_service.get_user_preferences.return_value = None

        with patch("backend.routes.pantry.date") as mock_date:
            mock_date.today.return_value = TEST_DATE
            resp = client_phase4.post(
                "/api/pantry/health-card/dismiss",
                headers={"X-User-Id": "user-1"},
            )

        assert resp.status_code == 200
        assert json.loads(resp.data) == {"ok": True}
        admin.table.return_value.upsert.assert_called_once()
        row = admin.table.return_value.upsert.call_args[0][0]
        assert row["last_health_card_shown"] == "2026-04-10"
        assert row["user_id"] == "user-1"


class TestPantryConfidence:
    @patch("backend.routes.pantry.get_calibrated_days_supply", return_value=45)
    @patch("backend.routes.pantry.get_engagement_multiplier", return_value=1.0)
    def test_PANTRY_RESPONSE_INCLUDES_CONFIDENCE(
        self,
        mock_eng,
        mock_cal,
        client_phase4,
        mock_pantry_service,
        mock_supabase_service,
    ):
        mock_supabase_service.get_user_preferences.return_value = None
        mock_supabase_service.get_item_classifications_by_names.return_value = {
            "butter": {"depletion_class": "STAPLE", "default_days_supply": 45},
            "milk": {"depletion_class": "CONSUMABLE", "default_days_supply": 30},
        }
        butter = {
            "id": "1",
            "base_ingredient": "butter",
            "normalized_name": "butter (unsalted)",
            "quantity": 2,
            "unit": "count",
        }
        milk = {
            "id": "2",
            "base_ingredient": "milk",
            "normalized_name": "milk (whole)",
            "quantity": 1,
            "unit": "gallon",
        }
        mock_pantry_service.get_pantry_summary.return_value = {
            "total_items": 2,
            "unique_ingredients": 2,
            "items": [butter, milk],
            "grouped": [
                {"base_ingredient": "butter", "variants": [butter]},
                {"base_ingredient": "milk", "variants": [milk]},
            ],
            "household_id": "household-123",
        }

        resp = client_phase4.get(
            "/api/pantry",
            headers={"X-User-Id": "user-456"},
        )
        assert resp.status_code == 200
        data = json.loads(resp.data)
        for it in data["items"]:
            assert "confidence" in it
            assert isinstance(it["confidence"], (int, float))
            assert "depletion_class" in it
            assert isinstance(it["depletion_class"], str)
