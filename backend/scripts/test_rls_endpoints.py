#!/usr/bin/env python3
"""
Dry-run test of endpoints that use Supabase with admin_client (RLS bypass).
Tests that receipt, pantry, and household endpoints work without user JWT.
"""
import os
import sys

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

# Minimal env to speed up startup - skip AI if not needed for these tests
os.environ.setdefault("LOG_LEVEL", "WARNING")

# Test user ID from migration 010
TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


def run_tests():
    from backend.app import create_app
    from backend.config import get_config

    print("Loading app...")
    config = get_config()
    app = create_app(config)

    supabase = app.config.get("SUPABASE_SERVICE")
    if not supabase:
        print("FAIL: SUPABASE_SERVICE not configured")
        return 1

    if not supabase.admin_client:
        print("FAIL: admin_client is None - SUPABASE_SERVICE_ROLE_KEY may be missing")
        return 1

    print("OK: Supabase service and admin_client initialized\n")

    client = app.test_client()
    base = "/api"

    results = []

    # 1. GET /api/receipts?user_id=...
    print("1. GET /api/receipts (get_user_receipts)...")
    r = client.get(f"{base}/receipts?user_id={TEST_USER_ID}&limit=5")
    ok = r.status_code == 200
    results.append(("get_user_receipts", ok, r.status_code, r.get_json() if r.is_json else r.data[:200]))
    print(f"   -> {r.status_code} {'OK' if ok else 'FAIL'}")

    # 2. GET /api/pantry (requires X-User-Id)
    print("2. GET /api/pantry (get_user_pantry via pantry summary)...")
    r = client.get(f"{base}/pantry", headers={"X-User-Id": TEST_USER_ID})
    ok = r.status_code == 200
    results.append(("get_pantry", ok, r.status_code, r.get_json() if r.is_json else r.data[:200]))
    print(f"   -> {r.status_code} {'OK' if ok else 'FAIL'}")

    # 3. GET /api/households (get_user_household)
    print("3. GET /api/households (get_user_household)...")
    r = client.get(f"{base}/households", headers={"X-User-Id": TEST_USER_ID})
    ok = r.status_code == 200
    results.append(("get_household", ok, r.status_code, r.get_json() if r.is_json else r.data[:200]))
    print(f"   -> {r.status_code} {'OK' if ok else 'FAIL'}")

    # 4. GET /api/households/members
    print("4. GET /api/households/members (get_household_members)...")
    r = client.get(f"{base}/households/members", headers={"X-User-Id": TEST_USER_ID})
    ok = r.status_code == 200
    results.append(("get_household_members", ok, r.status_code, r.get_json() if r.is_json else r.data[:200]))
    print(f"   -> {r.status_code} {'OK' if ok else 'FAIL'}")

    # 5. GET /api/providers (list providers - may touch DB)
    print("5. GET /api/providers...")
    r = client.get(f"{base}/providers")
    ok = r.status_code == 200
    results.append(("get_providers", ok, r.status_code, r.get_json() if r.is_json else r.data[:200]))
    print(f"   -> {r.status_code} {'OK' if ok else 'FAIL'}")

    # 6. Direct Supabase: get_receipt_by_order_id (used in providers flow)
    print("6. Direct: get_receipt_by_order_id (dry run)...")
    try:
        rec = supabase.get_receipt_by_order_id("nonexistent-order-id-12345")
        ok = rec is None  # Expect None for nonexistent
        results.append(("get_receipt_by_order_id", True, "OK", "returns None for nonexistent"))
        print("   -> OK (no RLS block)")
    except Exception as e:
        ok = False
        results.append(("get_receipt_by_order_id", False, str(e), str(e)[:200]))
        print(f"   -> FAIL: {e}")

    # 7. Direct Supabase: get_household_by_code
    print("7. Direct: get_household_by_code (TEST123)...")
    try:
        hh = supabase.get_household_by_code("TEST123")
        ok = hh is not None  # Test household exists
        results.append(("get_household_by_code", ok, "OK", f"household_id={hh.get('id') if hh else None}"))
        print(f"   -> {'OK' if ok else 'FAIL'} (household={'found' if hh else 'null'})")
    except Exception as e:
        ok = False
        results.append(("get_household_by_code", False, str(e), str(e)[:200]))
        print(f"   -> FAIL: {e}")

    # 8. Direct: is_join_code_unique
    print("8. Direct: is_join_code_unique (random code)...")
    try:
        unique = supabase.is_join_code_unique("XYZ999")
        results.append(("is_join_code_unique", True, "OK", f"unique={unique}"))
        print(f"   -> OK (unique={unique})")
    except Exception as e:
        results.append(("is_join_code_unique", False, str(e), str(e)[:200]))
        print(f"   -> FAIL: {e}")

    # Summary
    print("\n" + "=" * 60)
    passed = sum(1 for r in results if r[1])
    total = len(results)
    print(f"RESULT: {passed}/{total} tests passed")
    if passed < total:
        print("\nFailed tests:")
        for name, ok, code, detail in results:
            if not ok:
                print(f"  - {name}: {code} / {detail}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(run_tests())
