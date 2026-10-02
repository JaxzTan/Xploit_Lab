import json
from pathlib import Path

import pytest

from app import loader

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def _cached_by_default(monkeypatch):
    # Never hit Gemini from the test suite unless a test opts in explicitly.
    monkeypatch.setenv("DEMO_MODE", "cached")


@pytest.fixture(scope="session")
def bundles():
    return loader.load_all()


def js_cases():
    """(scenario_id, change_ids, verdict) produced by the design guide's own JS compute()."""
    data = json.loads((FIXTURES / "js_expected.json").read_text())
    return [(sid, c["change_ids"], c["verdict"]) for sid, cases in data.items() for c in cases]
