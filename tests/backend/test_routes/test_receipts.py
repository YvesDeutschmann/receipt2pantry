"""Receipts route tests — auth, IDOR, and summary contract."""

TEST_USER_ID = "11111111-1111-1111-1111-111111111111"
OTHER_USER_ID = "22222222-2222-2222-2222-222222222222"

EMPTY_SUMMARY = {
    "total_receipts": 0,
    "month_spend": 0,
    "total_items": 0,
    "recent": [],
}


def _auth_headers(user_id: str = TEST_USER_ID) -> dict:
    return {"X-User-Id": user_id}


def test_get_receipt_summary_requires_auth(client, mock_supabase_service):
    """Unauthenticated GET /api/receipts/summary → 401."""
    client.application.config["SUPABASE_SERVICE"] = mock_supabase_service
    response = client.get("/api/receipts/summary")
    assert response.status_code == 401
    mock_supabase_service.get_user_receipt_summary.assert_not_called()


def test_get_receipt_summary_ignores_forged_query_user_id(
    client, mock_supabase_service
):
    """Forged query user_id must not override authenticated identity."""
    mock_supabase_service.get_user_receipt_summary.return_value = EMPTY_SUMMARY
    client.application.config["SUPABASE_SERVICE"] = mock_supabase_service
    response = client.get(
        f"/api/receipts/summary?user_id={OTHER_USER_ID}",
        headers=_auth_headers(TEST_USER_ID),
    )
    assert response.status_code == 200
    mock_supabase_service.get_user_receipt_summary.assert_called_once_with(
        TEST_USER_ID
    )
    body = response.get_json()
    assert body["total_receipts"] == 0
    assert body["month_spend"] == 0
    assert body["total_items"] == 0
    assert body["recent"] == []
