"""Grep-based CI guardrails: no Playwright or session-machinery artifacts in source."""

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


def _walk_text_files(root: Path) -> list[Path]:
    if root.is_file():
        return [root]
    return [p for p in root.rglob("*") if p.is_file() and "__pycache__" not in p.parts]


def _rg_equivalent(pattern: str, *paths: str) -> list[str]:
    """Return matching lines in the same spirit as `rg pattern paths`."""
    rx = re.compile(pattern)
    matches: list[str] = []
    for rel in paths:
        target = REPO_ROOT / rel
        for file_path in _walk_text_files(target):
            try:
                text = file_path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for line_no, line in enumerate(text.splitlines(), start=1):
                if rx.search(line):
                    matches.append(f"{file_path.relative_to(REPO_ROOT)}:{line_no}:{line}")
    return matches


@pytest.mark.parametrize(
    "case_id,pattern,paths",
    [
        (
            "RG_NO_PLAYWRIGHT_IMPORT_IN_PROD",
            r"from playwright|import playwright|playwright_stealth",
            ["backend/"],
        ),
        (
            "RG_NO_PLAYWRIGHT_DEP",
            "playwright",
            ["pyproject.toml", "uv.lock"],
        ),
    ],
)
def test_rg_no_playwright_in_paths(case_id, pattern, paths):
    matches = _rg_equivalent(pattern, *paths)
    assert not matches, f"{case_id}: unexpected matches:\n" + "\n".join(matches)


def test_rg_no_playwright_provider_file():
    assert not (REPO_ROOT / "backend/providers/playwright_provider.py").exists()


def test_rg_no_deprecated_dirs():
    assert not (REPO_ROOT / "backend/providers/_deprecated").exists()
    assert not (REPO_ROOT / "backend/services/_deprecated").exists()


def test_rg_no_session_machinery():
    matches = _rg_equivalent("SessionCleanupWorker|LoginSessionManager", "backend/")
    assert not matches, f"Unexpected session machinery:\n" + "\n".join(matches)
