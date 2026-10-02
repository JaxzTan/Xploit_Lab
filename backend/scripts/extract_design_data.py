"""One-off extractor: design guide (index.html) -> backend/data/scenarios/<id>/*.json.

Evaluates the design guide's `SCENARIOS` object and engine functions with node, so
nothing is hand-copied. Also runs the design's own `compute()` / `applyChanges()` for
every subset of each scenario's changes and freezes the results as the engine test
oracle in `tests/fixtures/js_expected.json`.

Usage (from backend/):
    uv run python scripts/extract_design_data.py [path/to/index.html]
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_DESIGN = Path("/Users/jaxztan/Downloads/fapi-artifact/src/index.html")
BACKEND = Path(__file__).resolve().parent.parent
SCEN_DIR = BACKEND / "data" / "scenarios"
FIXTURE = BACKEND / "tests" / "fixtures" / "js_expected.json"

RULE_IDS = {
    "R-EXP-1": "exposure = exposed_capacity_24h_usd × detection_window_factor × control_multiplier",
    "R-WIN-1": "detection_window_factor = min(detection_delay_hours / 24, 1)",
    "R-BYP-1": "control_multiplier = best product of edge.control_multiplier over simple paths from entry",
    "R-DIS-1": "disruption = max tier lookup over reached nodes; 1 critical financial system ⇒ critical tier; 2+ ⇒ multi_critical",
    "R-CYB-1": "cyber_risk = HIGH if any critical node reached, MEDIUM if any high, else LOW",
    "R-REG-1": "DORA (simulated): critical-function financial system reached via unauthorized access ⇒ MAJOR, else BELOW",
    "R-UNK-1": "missing evidence ⇒ factor 1.0, complete=false, UI shows 'up to $X'",
}

# JS run inside node: evaluates the design's script slice and prints JSON.
NODE_JS = r"""
const fs = require('fs');
const html = fs.readFileSync(process.argv[1], 'utf8');
const s = html.indexOf('const SCENARIOS');
const e = html.indexOf('class Component extends DCLogic');
if (s < 0 || e < 0) throw new Error('design markers not found');
const code = html.slice(s, e);
const api = new Function(code + `
return { SCENARIOS, SCENARIO_ORDER, applyScenario, compute, applyChanges,
         get CHANGES() { return CHANGES; } };`)();
const out = { order: api.SCENARIO_ORDER, scenarios: api.SCENARIOS, expected: {} };
for (const id of api.SCENARIO_ORDER) {
  api.applyScenario(id);
  const sc = api.SCENARIOS[id];
  const changes = sc.CHANGES;
  const n = changes.length;
  const ser = (v) => ({
    reached: Array.from(v.reached), total: v.total, complete: v.complete,
    disruption: v.disruption, critical_financial_count: v.criticalFinancialCount,
    cyber: v.cyber, regulatory: v.regulatory,
    per_system: v.perSystem.map((p) => ({ node_id: p.node.id, gap: p.gap, gap_unknown: p.gapUnknown,
      bypass: p.bypass, chain: p.chain, bypass_unknown: p.bypassUnknown, exposure: p.exposure }))
  });
  const cases = [];
  for (let mask = 0; mask < (1 << n); mask++) {
    const list = changes.filter((_, i) => mask & (1 << i));
    const m = api.applyChanges(list);
    cases.push({ change_ids: list.map((c) => c.id), verdict: ser(api.compute(m.nodes, m.edges)) });
  }
  out.expected[id] = cases;
}
process.stdout.write(JSON.stringify(out));
"""


def snake(key: str) -> str:
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", key)
    return s.lower()


def snake_keys(obj, *, skip_map_keys: bool = False):
    """Recursively snake_case dict keys (map keys like 'e1' are already lowercase)."""
    if isinstance(obj, dict):
        return {(k if skip_map_keys else snake(k)): snake_keys(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [snake_keys(v) for v in obj]
    return obj


AI_KEYS = {"TECHNIQUES", "HOP_DETAILS", "PHASES", "REASONING", "AI_ESTIMATE", "NARRATIVE",
           "pathEdgeIds", "onPath"}
STRUCT_KEYS = {"NODES", "EDGES", "RULES", "ENTRY", "CHANGES"}


def build(sc: dict) -> tuple[dict, dict]:
    meta = {snake(k): v for k, v in sc.items() if k not in AI_KEYS | STRUCT_KEYS}
    rules = snake_keys(sc["RULES"])
    rules["rule_ids"] = RULE_IDS
    bank = {
        "id": sc["id"],
        "meta": meta,
        "entry": sc["ENTRY"],
        "nodes": snake_keys(sc["NODES"]),
        "edges": snake_keys(sc["EDGES"]),
        "rules": rules,
        "changes": snake_keys(sc["CHANGES"]),
    }
    edges = {e["edge_id"]: e for e in sc["EDGES"]}
    path_ids = sc["pathEdgeIds"]
    steps = [
        {"from": edges[eid]["source"], "to": edges[eid]["destination"],
         "technique": sc["TECHNIQUES"].get(eid, ""), "evidence_edge": eid}
        for eid in path_ids
    ]
    golden = {
        "entry_point": sc["ENTRY"],
        "steps": steps,
        "systems_reached": [n for n in sc["onPath"] if n != sc["ENTRY"]],
        "path_edge_ids": path_ids,
        "on_path": sc["onPath"],
        "techniques": sc["TECHNIQUES"],
        "hop_details": {k: snake_keys(v) for k, v in sc["HOP_DETAILS"].items()},
        "phases": snake_keys(sc["PHASES"]),
        "reasoning": snake_keys(sc["REASONING"]),
        "ai_estimate": sc["AI_ESTIMATE"],
        "narrative_template": sc["NARRATIVE"],
    }
    return bank, golden


def main() -> None:
    design = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DESIGN
    raw = subprocess.run(["node", "-e", NODE_JS, str(design)], check=True,
                         capture_output=True, text=True).stdout
    data = json.loads(raw)
    for sid in data["order"]:
        bank, golden = build(data["scenarios"][sid])
        out = SCEN_DIR / sid
        out.mkdir(parents=True, exist_ok=True)
        (out / "bank.json").write_text(json.dumps(bank, indent=2, ensure_ascii=False) + "\n")
        (out / "golden_path.json").write_text(json.dumps(golden, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {out}/bank.json, golden_path.json")
    (SCEN_DIR / "order.json").write_text(json.dumps(data["order"]) + "\n")
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(data["expected"], indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {FIXTURE}")


if __name__ == "__main__":
    main()
