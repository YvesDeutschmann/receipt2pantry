"""Tests for M0 scope-lock cleanup: no debug artifacts in production paths."""

import shutil
import subprocess
from pathlib import Path
from unittest.mock import MagicMock

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
DEBUG_EF2920 = REPO_ROOT / "debug-ef2920.log"
DEBUG_392E90 = REPO_ROOT / "debug-392e90.log"


def _mtime_or_none(path: Path):
    return path.stat().st_mtime if path.exists() else None


def _rg_search(pattern: str, paths: list[str], *, exclude_dirs: tuple[str, ...] = ()) -> str:
    """Run ripgrep when available; otherwise scan with pathlib."""
    rg = shutil.which("rg")
    if rg:
        cmd = [rg, pattern]
        for d in exclude_dirs:
            cmd.extend(["--glob", f"!{d}/**"])
        cmd.extend(paths)
        result = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True)
        return result.stdout

    matches: list[str] = []
    for rel in paths:
        path = REPO_ROOT / rel
        if path.is_file():
            files = [path]
        else:
            files = path.rglob("*")
        for file_path in files:
            if not file_path.is_file():
                continue
            rel_parts = file_path.relative_to(REPO_ROOT).parts
            if any(part in exclude_dirs for part in rel_parts):
                continue
            if any(part.startswith(".") for part in rel_parts):
                continue
            try:
                text = file_path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            if pattern in text:
                matches.append(str(file_path.relative_to(REPO_ROOT)))
    return "\n".join(matches)


@pytest.fixture
def pool_store():
    return MagicMock()


@pytest.fixture
def pool_generator():
    return MagicMock()


@pytest.fixture
def household_service():
    hs = MagicMock()
    hs.get_household_id.return_value = "hh-1"
    hs.get_household.return_value = {
        "suggestion_meal_slots": {"breakfast": True, "lunch": False, "dinner": True}
    }
    return hs


@pytest.fixture
def app_with_pool(app, pool_store, pool_generator, household_service):
    app.config["POOL_STORE_SERVICE"] = pool_store
    app.config["POOL_GENERATOR"] = pool_generator
    app.config["HOUSEHOLD_SERVICE"] = household_service
    return app


@pytest.fixture
def client_pool(app_with_pool):
    return app_with_pool.test_client()


def test_get_pool_returns_200_no_debug_side_effects(client_pool, pool_store):
    pool_store.get_pool_grouped_by_meal.return_value = {
        "breakfast": [],
        "lunch": [],
        "dinner": [],
    }
    before = _mtime_or_none(DEBUG_EF2920)
    res = client_pool.get("/api/suggestions/pool", headers={"X-User-Id": "user-1"})
    after = _mtime_or_none(DEBUG_EF2920)
    assert res.status_code == 200
    assert before == after


def test_get_depth_returns_200_no_debug_side_effects(client_pool, pool_store):
    pool_store.get_pool_depth.return_value = {
        "breakfast": 2,
        "lunch": 1,
        "dinner": 0,
    }
    before = _mtime_or_none(DEBUG_EF2920)
    res = client_pool.get(
        "/api/suggestions/pool/depth", headers={"X-User-Id": "user-1"}
    )
    after = _mtime_or_none(DEBUG_EF2920)
    assert res.status_code == 200
    assert before == after


def test_generate_pool_returns_200_no_debug_side_effects(client_pool, pool_generator):
    pool_generator.generate_pool.return_value = {
        "generation_id": "g1",
        "status": "completed",
        "suggestions_generated": 5,
        "error": None,
    }
    before = _mtime_or_none(DEBUG_EF2920)
    res = client_pool.post(
        "/api/suggestions/pool/generate",
        json={"trigger_reason": "manual_refresh", "household_id": "hh-1"},
        headers={"X-User-Id": "user-1"},
    )
    after = _mtime_or_none(DEBUG_EF2920)
    assert res.status_code == 200
    assert before == after


def test_debug_ingest_endpoint_removed(client):
    res = client.post("/api/debug-ingest", json={"msg": "test"})
    assert res.status_code == 404


def test_debug_ingest_log_not_written(client):
    before = _mtime_or_none(DEBUG_392E90)
    client.post("/api/debug-ingest", json={"msg": "test"})
    after = _mtime_or_none(DEBUG_392E90)
    assert before == after


@pytest.mark.parametrize(
    "name,pattern,paths,exclude_dirs",
    [
        (
            "RG_NO_DEBUG_EF2920_IN_PROD",
            "debug-ef2920",
            ["backend", "frontend"],
            ("tests", "docs"),
        ),
        (
            "RG_NO_DEBUG_392E90_IN_PROD",
            "debug-392e90",
            ["backend", "frontend"],
            ("tests", "docs"),
        ),
        (
            "RG_NO_AGENT_DBG_FUNCTION_IN_PROD",
            "_agent_dbg",
            ["backend/routes/pool.py", "backend/services/pool_generator.py"],
            (),
        ),
        (
            "RG_NO_DEBUG_INGEST_IMPORT",
            "debug_ingest",
            ["backend/app.py"],
            (),
        ),
    ],
)
def test_no_debug_artifacts_in_source(name, pattern, paths, exclude_dirs):
    output = _rg_search(pattern, paths, exclude_dirs=exclude_dirs)
    assert not output.strip(), f"{name}: expected no matches, got:\n{output}"
