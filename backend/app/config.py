"""Environment config. Local runs read backend/.env then the repo-root .env (never override
real env vars, which is what Cloud Run uses)."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

_BACKEND = Path(__file__).resolve().parent.parent
for _p in (_BACKEND / ".env", _BACKEND.parent / ".env"):
    if _p.is_file():
        load_dotenv(_p, override=False)

# gemini-2.5-flash now returns 404 for new keys; gemini-3.8-flash works but measured ~24 s
# (over the 8 s budget). gemini-3.1-flash-lite answers in ~6 s with a valid path.
DEFAULT_MODEL = "gemini-3.1-flash-lite"
GEMINI_TIMEOUT_S = float(os.environ.get("GEMINI_TIMEOUT_S") or 8.0)


def gemini_api_key() -> str | None:
    # GEMINI_API is accepted as a legacy alias for GEMINI_API_KEY.
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GEMINI_API") or None


def gemini_model() -> str:
    return os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL


def demo_mode_cached() -> bool:
    return os.environ.get("DEMO_MODE", "live").strip().lower() == "cached"


def server_source() -> str:
    """Which reasoner mode the server is in: 'cached' if forced or no key, else 'live'."""
    return "cached" if demo_mode_cached() or not gemini_api_key() else "live"
