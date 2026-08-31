#!/usr/bin/env python3
"""Send a test message and exception to GlitchTip for launch-readiness verification."""

from __future__ import annotations

import sys

import sentry_sdk

from backend.config import get_config
from backend.utils.monitoring import capture_exception, capture_message, init_monitoring


def main() -> int:
    config = get_config()
    if not config.SENTRY_DSN:
        print("SENTRY_DSN is not set; cannot send test events.", file=sys.stderr)
        return 1

    init_monitoring(config)

    msg_id = capture_message("Meald backend monitoring test event", level="info")
    print(f"Test message event id: {msg_id or '(pending)'}")

    try:
        raise RuntimeError("Meald backend monitoring test exception")
    except RuntimeError as exc:
        exc_id = capture_exception(exc)
        print(f"Test exception event id: {exc_id or '(pending)'}")

    # Ensure transport drains before process exit (hosted GlitchTip smoke).
    sentry_sdk.flush(timeout=10)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
