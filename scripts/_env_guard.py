"""Guard destructive local scripts against accidental PROD Supabase targets."""

from __future__ import annotations

import os
import sys

PROD_PROJECT_REF = "pvmezsxdqotxaqfymmzd"


def is_prod_supabase_url(url: str | None = None) -> bool:
    value = (url or os.getenv("SUPABASE_URL") or "").strip()
    return PROD_PROJECT_REF in value


def assert_not_prod(*, allow_prod: bool = False, context: str = "script") -> None:
    if allow_prod:
        return
    if is_prod_supabase_url():
        print(
            f"Refusing {context}: SUPABASE_URL points at production ({PROD_PROJECT_REF}). "
            f"Pass --prod only when you mean to run against production.",
            file=sys.stderr,
        )
        sys.exit(1)


def assert_prod(*, allow_prod: bool, context: str = "script") -> None:
    if not allow_prod:
        print(
            f"Refusing {context}: pass --prod to target production explicitly.",
            file=sys.stderr,
        )
        sys.exit(1)
    if not is_prod_supabase_url():
        print(
            f"Refusing {context}: --prod requires SUPABASE_URL to contain {PROD_PROJECT_REF}.",
            file=sys.stderr,
        )
        sys.exit(1)
