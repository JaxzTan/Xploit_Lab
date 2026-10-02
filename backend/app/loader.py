"""Load and validate every scenario at import/startup — fail fast on any schema error."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.models import GoldenPath, Scenario

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "scenarios"


class ScenarioDataError(RuntimeError):
    pass


@dataclass(frozen=True)
class ScenarioBundle:
    scenario: Scenario
    golden: GoldenPath


def _load_one(sid: str, data_dir: Path) -> ScenarioBundle:
    d = data_dir / sid
    scenario = Scenario.model_validate_json((d / "bank.json").read_text())
    golden = GoldenPath.model_validate_json((d / "golden_path.json").read_text())
    if scenario.id != sid:
        raise ScenarioDataError(f"{d}/bank.json id {scenario.id!r} != directory {sid!r}")

    # The golden path must itself pass the validator, or the fallback is worthless.
    from app.validator import validate_path  # local import: avoid cycle at module load

    res = validate_path(scenario, golden.entry_point, golden.steps, golden.systems_reached)
    if not res.ok or not res.validation.bfs_subset:
        raise ScenarioDataError(f"{sid}: golden_path.json fails validation: {res.validation}")
    return ScenarioBundle(scenario, golden)


@lru_cache(maxsize=1)
def load_all(data_dir: Path = DATA_DIR) -> dict[str, ScenarioBundle]:
    order = json.loads((data_dir / "order.json").read_text())
    try:
        return {sid: _load_one(sid, data_dir) for sid in order}
    except Exception as exc:  # noqa: BLE001 — re-raise with context, fail fast
        raise ScenarioDataError(f"scenario data invalid: {exc}") from exc


def get(sid: str) -> ScenarioBundle | None:
    return load_all().get(sid)
