"""Request-scoped attribution for AI provider calls."""

from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Optional

_ai_call_context: ContextVar[Optional["AICallContext"]] = ContextVar(
    "ai_call_context", default=None
)


@dataclass(frozen=True)
class AICallContext:
    user_id: Optional[str] = None
    household_id: Optional[str] = None
    receipt_id: Optional[str] = None
    operation: Optional[str] = None


def get_ai_call_context() -> Optional[AICallContext]:
    return _ai_call_context.get()


def set_ai_call_context(ctx: Optional[AICallContext]) -> Token:
    return _ai_call_context.set(ctx)


def reset_ai_call_context(token: Token) -> None:
    _ai_call_context.reset(token)


def merge_ai_call_context(**kwargs) -> tuple[Token, AICallContext]:
    """Set context, preserving unspecified fields from the current context."""
    current = get_ai_call_context()
    merged = AICallContext(
        user_id=kwargs.get("user_id", current.user_id if current else None),
        household_id=kwargs.get(
            "household_id", current.household_id if current else None
        ),
        receipt_id=kwargs.get("receipt_id", current.receipt_id if current else None),
        operation=kwargs.get("operation", current.operation if current else None),
    )
    token = set_ai_call_context(merged)
    return token, merged
