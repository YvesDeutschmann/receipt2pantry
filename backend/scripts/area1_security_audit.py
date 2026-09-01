#!/usr/bin/env python3
"""
Area 1 launch-readiness security audit (audit + report only).

DB checks via `npx supabase db query` (--linked, or --db-url from DATABASE_URL /
SUPABASE_DB_URL). Local checks probe ProductionConfig JWT, CORS, and removed
Safeway routes.

Exit 0 only if every runnable check is PASS or N/A; FAIL/BLOCKED/PARTIAL → 1.
Never prints secrets, JWTs, or connection strings.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

# Load root .env without importing app (avoids side effects before env overlay).
try:
    from dotenv import load_dotenv

    load_dotenv(REPO_ROOT / ".env")
except ImportError:
    pass

VICTIM_USER = "00000000-0000-0000-0000-000000000001"
ATTACKER_USER = "11111111-1111-1111-1111-111111111111"

REQUIRED_022_TABLES = frozenset(
    {
        "grocery_accounts",
        "receipts",
        "receipt_items",
        "automation_logs",
        "login_sessions",
        "product_mappings",
        "pantry_items",
        "cooking_log",
        "ingredient_substitutions",
        "ai_processing_log",
        "households",
        "household_members",
        "meal_plan",
        "shopping_list",
        "meal_plan_wizard_session",
        "recipe_bans",
        "staples_template",
        "canonical_ingredients",
        "pool_generation",
        "suggestion_pool",
        "item_classification",
        "depletion_history",
        "purchase_history",
        "user_preferences",
        "ingredient_signals",
    }
)

DEPRECATED_SAFEWAY_PATHS = [
    "/api/providers/safeway/test",
    "/api/providers/safeway/fetch-receipts",
    "/api/providers/safeway/login/start",
    "/api/providers/safeway/login/abc123/mfa",
]


@dataclass
class CheckResult:
    id: str
    name: str
    status: str  # PASS | FAIL | PARTIAL | BLOCKED | N/A
    detail: str


def _redact(text: str) -> str:
    text = re.sub(r"postgresql://[^\s\"']+", "postgresql://***", text, flags=re.I)
    text = re.sub(r"postgres://[^\s\"']+", "postgres://***", text, flags=re.I)
    text = re.sub(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "***JWT***", text)
    text = re.sub(r"(sb_publishable_|sb_secret_|service_role)[A-Za-z0-9_-]+", r"\1***", text)
    return text


def _db_url() -> Optional[str]:
    return os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL") or None


def _run_supabase_sql(sql: str) -> tuple[bool, str]:
    """Run SQL via npx supabase db query. Prefer --linked, else --db-url."""
    base = ["npx", "--yes", "supabase", "db", "query"]
    db_url = _db_url()
    attempts: list[list[str]] = [
        base + ["--linked", sql],
    ]
    if db_url:
        attempts.append(base + ["--db-url", db_url, sql])

    last_err = ""
    for cmd in attempts:
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(REPO_ROOT),
                capture_output=True,
                text=True,
                timeout=120,
            )
        except FileNotFoundError as e:
            return False, f"npx/supabase not found: {e}"
        except subprocess.TimeoutExpired:
            return False, "supabase db query timed out"
        out = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
        if proc.returncode == 0:
            return True, out
        last_err = _redact(out.strip() or f"exit {proc.returncode}")
        # Old CLI without `db query` — try once more with @latest if base failed oddly
        if "unknown command" in last_err.lower() or "invalid command" in last_err.lower():
            continue
    return False, last_err or "supabase db query failed"


def _parse_jsonish_rows(output: str) -> list[dict[str, Any]]:
    """Best-effort parse of CLI JSON / table output into list of dicts."""
    text = output.strip()
    if not text:
        return []
    # Prefer JSON blob
    for candidate in (text, text[text.find("[") :] if "[" in text else ""):
        if not candidate:
            continue
        try:
            data = json.loads(candidate)
            if isinstance(data, list):
                return [r for r in data if isinstance(r, dict)]
            if isinstance(data, dict):
                for key in ("rows", "data", "result"):
                    if isinstance(data.get(key), list):
                        return [r for r in data[key] if isinstance(r, dict)]
                return [data]
        except json.JSONDecodeError:
            continue
    return []


def check_1a() -> list[CheckResult]:
    results: list[CheckResult] = []
    ok, out = _run_supabase_sql(
        """
        SELECT relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
        """
    )
    if not ok:
        results.append(
            CheckResult(
                "1a",
                "RLS enabled on every public table",
                "BLOCKED",
                f"supabase db query failed: {out[:500]}",
            )
        )
        return results

    disabled = _parse_jsonish_rows(out)
    # Also handle plain-line relname dumps
    if not disabled and out.strip() and "relname" not in out.lower():
        lines = [ln.strip() for ln in out.splitlines() if ln.strip() and not ln.startswith("-")]
        disabled = [{"relname": ln} for ln in lines if ln not in ("relname", "(0 rows)")]

    if disabled:
        names = ", ".join(str(r.get("relname", r)) for r in disabled)
        results.append(
            CheckResult("1a", "RLS enabled on every public table", "FAIL", f"RLS off: {names}")
        )
    else:
        results.append(
            CheckResult(
                "1a",
                "RLS enabled on every public table",
                "PASS",
                "Zero public tables with rls_enabled=false",
            )
        )

    ok2, out2 = _run_supabase_sql(
        """
        SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname;
        """
    )
    if ok2:
        rows = _parse_jsonish_rows(out2)
        present = {str(r.get("table_name") or r.get("relname")) for r in rows}
        missing = sorted(REQUIRED_022_TABLES - present)
        if missing:
            results.append(
                CheckResult(
                    "1a-022",
                    "022 table set present",
                    "FAIL",
                    f"Missing tables: {', '.join(missing)}",
                )
            )
        else:
            results.append(
                CheckResult(
                    "1a-022",
                    "022 table set present",
                    "PASS",
                    f"All {len(REQUIRED_022_TABLES)} expected tables present with RLS inventory",
                )
            )
    return results


def _ephemeral_user_isolation() -> tuple[Optional[int], Optional[int], str]:
    """
    Fallback: create ephemeral auth user B, SELECT as B via PostgREST, delete B.
    Returns (pantry_leak, grocery_leak, note). Counts may be None if query errored.
    """
    import uuid

    try:
        from supabase import create_client
    except ImportError:
        return None, None, "supabase-py not installed"

    url = os.getenv("SUPABASE_URL")
    service = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SECRET_KEY")
    anon = os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_PUBLIC_KEY")
    if not (url and service and anon):
        return None, None, "missing SUPABASE_URL / keys for ephemeral fallback"

    admin = create_client(url, service)
    email = f"area1-audit-{uuid.uuid4().hex[:12]}@example.com"
    password = f"Audit-{uuid.uuid4().hex}!"
    user_id = None
    pantry_leak: Optional[int] = None
    grocery_leak: Optional[int] = None
    notes: list[str] = []
    try:
        created = admin.auth.admin.create_user(
            {"email": email, "password": password, "email_confirm": True}
        )
        user_id = created.user.id
        user_client = create_client(url, anon)
        user_client.auth.sign_in_with_password({"email": email, "password": password})
        try:
            pantry = (
                user_client.table("pantry_items")
                .select("id")
                .eq("user_id", VICTIM_USER)
                .execute()
            )
            pantry_leak = len(pantry.data or [])
        except Exception as e:
            msg = str(e)
            if "infinite recursion" in msg.lower() or "42P17" in msg:
                notes.append("pantry: household_members RLS infinite recursion (42P17)")
            else:
                notes.append(f"pantry error: {type(e).__name__}")
        try:
            grocery = (
                user_client.table("grocery_accounts")
                .select("id")
                .eq("user_id", VICTIM_USER)
                .execute()
            )
            grocery_leak = len(grocery.data or [])
        except Exception as e:
            notes.append(f"grocery error: {type(e).__name__}")
    except Exception as e:
        return None, None, f"ephemeral user setup failed: {type(e).__name__}"
    finally:
        if user_id:
            try:
                admin.auth.admin.delete_user(user_id)
            except Exception:
                notes.append("failed to delete ephemeral user")

    return pantry_leak, grocery_leak, "; ".join(notes) if notes else "ephemeral user path"


def check_1b_isolation() -> list[CheckResult]:
    sql = f"""
    BEGIN;
    SELECT set_config(
      'request.jwt.claims',
      json_build_object('sub', '{ATTACKER_USER}', 'role', 'authenticated')::text,
      true
    );
    SET LOCAL ROLE authenticated;
    SELECT
      (SELECT count(*) FROM pantry_items WHERE user_id = '{VICTIM_USER}') AS pantry_leak,
      (SELECT count(*) FROM grocery_accounts WHERE user_id = '{VICTIM_USER}') AS grocery_leak;
    ROLLBACK;
    """
    pantry_leak = grocery_leak = None
    note = ""
    ok, out = _run_supabase_sql(sql)
    if ok:
        rows = _parse_jsonish_rows(out)
        if rows:
            row = rows[-1]
            pantry_leak = int(row.get("pantry_leak", -1))
            grocery_leak = int(row.get("grocery_leak", -1))
        else:
            m = re.search(
                r"pantry_leak[^\d]*(\d+).*grocery_leak[^\d]*(\d+)", out, re.S | re.I
            )
            if m:
                pantry_leak, grocery_leak = int(m.group(1)), int(m.group(2))
        note = "SQL role simulation"
    elif "infinite recursion" in out.lower() or "42P17" in out:
        note = "SQL hit household_members recursion; trying ephemeral user"
        pantry_leak, grocery_leak, fb_note = _ephemeral_user_isolation()
        note = f"{note}; {fb_note}"
    else:
        # CLI unavailable — try ephemeral path
        pantry_leak, grocery_leak, fb_note = _ephemeral_user_isolation()
        note = f"CLI unavailable ({out[:120]}); {fb_note}"

    # Grocery-only SQL if still missing grocery count
    if grocery_leak is None:
        ok_g, out_g = _run_supabase_sql(
            f"""
            BEGIN;
            SELECT set_config(
              'request.jwt.claims',
              json_build_object('sub', '{ATTACKER_USER}', 'role', 'authenticated')::text,
              true
            );
            SET LOCAL ROLE authenticated;
            SELECT count(*) AS grocery_leak FROM grocery_accounts
            WHERE user_id = '{VICTIM_USER}';
            ROLLBACK;
            """
        )
        if ok_g:
            rows = _parse_jsonish_rows(out_g)
            if rows:
                grocery_leak = int(rows[-1].get("grocery_leak", -1))

    results: list[CheckResult] = []
    if pantry_leak is None:
        results.append(
            CheckResult(
                "1b-pantry",
                "RLS_CROSS_USER_PANTRY_ISOLATION",
                "FAIL",
                f"could not measure leak_count ({note})",
            )
        )
    else:
        results.append(
            CheckResult(
                "1b-pantry",
                "RLS_CROSS_USER_PANTRY_ISOLATION",
                "PASS" if pantry_leak == 0 else "FAIL",
                f"attacker pantry_leak={pantry_leak} (expect 0); {note}",
            )
        )

    if grocery_leak is None:
        results.append(
            CheckResult(
                "1b-accounts",
                "RLS_CROSS_USER_GROCERY_ACCOUNTS_ISOLATION",
                "BLOCKED",
                f"could not measure leak_count ({note})",
            )
        )
    else:
        results.append(
            CheckResult(
                "1b-accounts",
                "RLS_CROSS_USER_GROCERY_ACCOUNTS_ISOLATION",
                "PASS" if grocery_leak == 0 else "FAIL",
                f"attacker grocery_leak={grocery_leak} (expect 0); {note}",
            )
        )
    return results


def check_1b_anon() -> list[CheckResult]:
    results: list[CheckResult] = []
    ok, out = _run_supabase_sql(
        """
        BEGIN;
        SET LOCAL ROLE anon;
        SELECT
          (SELECT count(*) FROM pantry_items) AS pantry,
          (SELECT count(*) FROM receipts) AS receipts,
          (SELECT count(*) FROM grocery_accounts) AS grocery_accounts;
        ROLLBACK;
        """
    )
    if not ok:
        # Permission denied that yields no data can still be PASS-ish; treat hard CLI fail as BLOCKED
        lowered = out.lower()
        if "permission denied" in lowered:
            results.append(
                CheckResult(
                    "1b-anon",
                    "RLS_ANON_ROLE_BLOCKED",
                    "PASS",
                    "anon role permission denied (no data)",
                )
            )
        else:
            results.append(
                CheckResult(
                    "1b-anon",
                    "RLS_ANON_ROLE_BLOCKED",
                    "BLOCKED",
                    f"anon SQL failed: {out[:400]}",
                )
            )
    else:
        rows = _parse_jsonish_rows(out)
        pantry = receipts = grocery = None
        if rows:
            row = rows[-1]
            pantry = int(row.get("pantry", -1))
            receipts = int(row.get("receipts", -1))
            grocery = int(row.get("grocery_accounts", -1))
        if pantry is None:
            results.append(
                CheckResult(
                    "1b-anon",
                    "RLS_ANON_ROLE_BLOCKED",
                    "BLOCKED",
                    f"Could not parse anon counts ({_redact(out)[:200]})",
                )
            )
        else:
            ok_counts = pantry == 0 and receipts == 0 and grocery == 0
            results.append(
                CheckResult(
                    "1b-anon",
                    "RLS_ANON_ROLE_BLOCKED",
                    "PASS" if ok_counts else "FAIL",
                    f"anon counts pantry={pantry} receipts={receipts} grocery_accounts={grocery}",
                )
            )

    ok_g, out_g = _run_supabase_sql(
        """
        SELECT table_name, privilege_type
        FROM information_schema.role_table_grants
        WHERE grantee = 'anon' AND table_schema = 'public'
        ORDER BY table_name;
        """
    )
    if not ok_g:
        results.append(
            CheckResult(
                "1b-anon-grants",
                "anon grants inventory",
                "BLOCKED",
                f"grants query failed: {out_g[:300]}",
            )
        )
        return results

    grants = _parse_jsonish_rows(out_g)
    grant_pairs = [
        f"{r.get('table_name')}:{r.get('privilege_type')}" for r in grants if r.get("table_name")
    ]
    # Also scrape plain output
    if not grant_pairs:
        for ln in out_g.splitlines():
            if "app_config" in ln.lower() or "|" in ln:
                grant_pairs.append(ln.strip())

    tables = sorted(
        {
            str(r.get("table_name"))
            for r in grants
            if r.get("table_name") and str(r.get("privilege_type", "")).upper() == "SELECT"
        }
    )
    # Strip noise from text scrape
    tables = [t for t in tables if t and t != "None"]

    expected_only = tables == ["app_config"]
    zero_grants = len(tables) == 0

    if zero_grants:
        status, detail = "PASS", "anon has zero public table grants"
    elif expected_only:
        status, detail = (
            "PARTIAL",
            "known exception: app_config SELECT only (021_app_config.sql)",
        )
    else:
        status, detail = (
            "FAIL",
            f"anon SELECT on {len(tables)} public relations (expect app_config only): "
            f"{', '.join(tables[:12])}{'…' if len(tables) > 12 else ''}",
        )

    results.append(
        CheckResult("1b-anon-grants", "anon grants inventory", status, detail)
    )
    return results


OWN_ROW_TABLES = (
    "depletion_history",
    "purchase_history",
    "user_preferences",
    "ingredient_signals",
    "login_sessions",
)


def check_1b_own_row() -> list[CheckResult]:
    """Verify own-row tables return zero victim rows for a non-member attacker."""
    counts_sql = ",\n      ".join(
        f"(SELECT count(*) FROM {table} WHERE user_id = '{VICTIM_USER}') AS {table}_leak"
        for table in OWN_ROW_TABLES
    )
    sql = f"""
    BEGIN;
    SELECT set_config(
      'request.jwt.claims',
      json_build_object('sub', '{ATTACKER_USER}', 'role', 'authenticated')::text,
      true
    );
    SET LOCAL ROLE authenticated;
    SELECT
      {counts_sql};
    ROLLBACK;
    """
    ok, out = _run_supabase_sql(sql)
    results: list[CheckResult] = []
    if not ok:
        results.append(
            CheckResult(
                "1b-own-row",
                "RLS_OWN_ROW_TABLES_ISOLATION",
                "BLOCKED",
                f"could not measure own-row leaks: {out[:300]}",
            )
        )
        return results

    rows = _parse_jsonish_rows(out)
    if not rows:
        results.append(
            CheckResult(
                "1b-own-row",
                "RLS_OWN_ROW_TABLES_ISOLATION",
                "BLOCKED",
                "could not parse own-row leak counts",
            )
        )
        return results

    row = rows[-1]
    leaks: list[str] = []
    for table in OWN_ROW_TABLES:
        key = f"{table}_leak"
        count = int(row.get(key, -1))
        if count != 0:
            leaks.append(f"{table}={count}")

    if leaks:
        results.append(
            CheckResult(
                "1b-own-row",
                "RLS_OWN_ROW_TABLES_ISOLATION",
                "FAIL",
                f"non-zero leaks: {', '.join(leaks)}",
            )
        )
    else:
        results.append(
            CheckResult(
                "1b-own-row",
                "RLS_OWN_ROW_TABLES_ISOLATION",
                "PASS",
                f"all {len(OWN_ROW_TABLES)} own-row tables leak_count=0",
            )
        )
    return results


def check_1c_jwt() -> list[CheckResult]:
    results: list[CheckResult] = []
    jwt_present = bool(os.getenv("SUPABASE_JWT_SECRET"))
    results.append(
        CheckResult(
            "1c-env",
            "SUPABASE_JWT_SECRET present in env",
            "PASS" if jwt_present else "FAIL",
            "yes" if jwt_present else "no",
        )
    )

    # Subprocess with clean overlay: production + unset JWT secret
    probe = r"""
import os, sys
# Strip JWT secret; force production
os.environ["FLASK_ENV"] = "production"
os.environ.pop("SUPABASE_JWT_SECRET", None)
os.environ["FLASK_SECRET_KEY"] = "audit-probe-not-dev-default-key"
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "audit-dummy-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "audit-dummy-service-key")
sys.path.insert(0, {repo!r})
from backend.config import ProductionConfig
from backend.utils.exceptions import ConfigurationException
try:
    ProductionConfig.validate()
    print("NO_EXCEPTION")
except ConfigurationException as e:
    print("CONFIG_EXC:" + str(e))
except Exception as e:
    print("OTHER_EXC:" + type(e).__name__ + ":" + str(e))
""".format(repo=str(REPO_ROOT))

    proc = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=60,
        env={**os.environ, "FLASK_ENV": "production"},
    )
    combined = (proc.stdout or "") + (proc.stderr or "")
    if "CONFIG_EXC:" in combined and "SUPABASE_JWT_SECRET" in combined:
        results.append(
            CheckResult(
                "1c",
                "JWT_SECRET_REQUIRED_IN_PRODUCTION",
                "PASS",
                "ProductionConfig.validate() requires SUPABASE_JWT_SECRET",
            )
        )
    elif "NO_EXCEPTION" in combined:
        results.append(
            CheckResult(
                "1c",
                "JWT_SECRET_REQUIRED_IN_PRODUCTION",
                "FAIL",
                "ProductionConfig.validate() did not assert SUPABASE_JWT_SECRET",
            )
        )
    else:
        results.append(
            CheckResult(
                "1c",
                "JWT_SECRET_REQUIRED_IN_PRODUCTION",
                "FAIL",
                f"unexpected probe result: {_redact(combined)[:300]}",
            )
        )
    return results


def check_1d_cors() -> list[CheckResult]:
    from backend.config import is_unsafe_production_cors_origin

    cors = os.getenv("CORS_ORIGINS", "")
    origins = [o.strip() for o in cors.split(",") if o.strip()]
    unsafe_origins = [o for o in origins if is_unsafe_production_cors_origin(o)]

    # Build app with current env CORS (do not mutate product defaults)
    os.environ.setdefault("LOG_LEVEL", "WARNING")
    from backend.app import create_app
    from backend.config import DevelopmentConfig

    class AuditConfig(DevelopmentConfig):
        DEBUG = False

    app = create_app(AuditConfig())
    client = app.test_client()
    resp = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    acao = resp.headers.get("Access-Control-Allow-Origin")
    allows_localhost = acao == "http://localhost:5173"

    results: list[CheckResult] = []

    # ProductionConfig probe: capacitor-only origins must pass; browser localhost must fail
    prod_probe = r"""
import os, sys
os.environ["FLASK_ENV"] = "production"
os.environ["FLASK_SECRET_KEY"] = "audit-probe-not-dev-default-key"
os.environ["SUPABASE_JWT_SECRET"] = "audit-jwt-secret"
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "audit-dummy-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "audit-dummy-service-key")
sys.path.insert(0, {repo!r})
from backend.config import ProductionConfig
from backend.utils.exceptions import ConfigurationException
for label, origins in [
    ("capacitor", "capacitor://localhost"),
    ("localhost", "http://localhost:5173"),
]:
    os.environ["CORS_ORIGINS"] = origins
    try:
        ProductionConfig.validate()
        print(label + ":PASS")
    except ConfigurationException as e:
        print(label + ":FAIL:" + str(e))
""".format(repo=str(REPO_ROOT))
    proc = subprocess.run(
        [sys.executable, "-c", prod_probe],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=60,
    )
    combined = (proc.stdout or "") + (proc.stderr or "")
    capacitor_ok = "capacitor:PASS" in combined
    localhost_blocked = "localhost:FAIL" in combined

    if unsafe_origins:
        results.append(
            CheckResult(
                "1d-env",
                "CORS_ORIGINS unsafe in env",
                "FAIL",
                f"unsafe origins: {', '.join(unsafe_origins)}"
                + (f"; ACAO={acao!r}" if acao else ""),
            )
        )
    elif allows_localhost:
        results.append(
            CheckResult(
                "1d-env",
                "CORS_ORIGINS unsafe in env",
                "FAIL",
                f"GET /api/health echoes localhost ACAO={acao!r}",
            )
        )
    else:
        results.append(
            CheckResult(
                "1d-env",
                "CORS_ORIGINS unsafe in env",
                "PASS",
                "no browser localhost/LAN origins in env",
            )
        )

    if capacitor_ok and localhost_blocked:
        results.append(
            CheckResult(
                "1d",
                "CORS_LOCALHOST_BLOCKED_IN_PRODUCTION",
                "PASS",
                "ProductionConfig allows capacitor://localhost; blocks http://localhost:5173",
            )
        )
    else:
        results.append(
            CheckResult(
                "1d",
                "CORS_LOCALHOST_BLOCKED_IN_PRODUCTION",
                "FAIL",
                f"prod CORS probe: capacitor_ok={capacitor_ok} localhost_blocked={localhost_blocked}",
            )
        )
    return results


def check_1e_safeway() -> CheckResult:
    os.environ.setdefault("LOG_LEVEL", "WARNING")
    from backend.app import create_app
    from backend.config import DevelopmentConfig

    app = create_app(DevelopmentConfig())
    client = app.test_client()
    statuses = {}
    for path in DEPRECATED_SAFEWAY_PATHS:
        r = client.post(path, json={})
        statuses[path] = r.status_code
    bad = {p: s for p, s in statuses.items() if s != 404}
    short = {p.split("/safeway/")[-1]: s for p, s in statuses.items()}
    if bad:
        return CheckResult(
            "1e",
            "DEPRECATED_SAFEWAY (expect 404)",
            "FAIL",
            f"non-404 responses: {short}",
        )
    return CheckResult(
        "1e",
        "DEPRECATED_SAFEWAY (expect 404)",
        "PASS",
        f"all 404: {short}",
    )


def _emit_markdown(results: list[CheckResult]) -> None:
    print("\n## Area 1 audit results")
    print("| Check | Status | Detail |")
    print("|---|---|---|")
    for r in results:
        detail = r.detail.replace("|", "\\|").replace("\n", " ")
        print(f"| {r.name} | {r.status} | {detail} |")


def main() -> int:
    skip_db = "--skip-db" in sys.argv
    results: list[CheckResult] = []

    if skip_db:
        results.append(
            CheckResult(
                "db",
                "DB checks",
                "N/A",
                "skipped (--skip-db); run SQL via MCP/CLI separately",
            )
        )
    else:
        results.extend(check_1a())
        results.extend(check_1b_isolation())
        results.extend(check_1b_own_row())
        results.extend(check_1b_anon())

    results.extend(check_1c_jwt())
    results.extend(check_1d_cors())
    results.append(check_1e_safeway())

    # Machine-readable lines
    for r in results:
        print(json.dumps(asdict(r), ensure_ascii=True))

    _emit_markdown(results)

    failing = [r for r in results if r.status in ("FAIL", "BLOCKED", "PARTIAL")]
    return 1 if failing else 0


if __name__ == "__main__":
    sys.exit(main())
