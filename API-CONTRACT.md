# FAPI API contract (shared by backend/ and frontend/)

Source of truth for UI + scenario data + engine rules: the design guide
`/Users/jaxztan/Downloads/fapi-artifact/src/index.html` (the `SCENARIOS` object,
`compute()`, `applyChanges()`, and the markup/render code). It supersedes the
PRD/TRD where they differ (3 scenarios, 6 tabs, stackable fixes, DORA `MAJOR`/`BELOW`,
`exposed_capacity_24h_usd` / `detection_delay_hours` / `control_multiplier`).
Architecture follows the TRD (FastAPI + Pydantic + NetworkX + google-genai, React+Vite+TS+Tailwind+React Flow, one Docker image).

All JSON is snake_case. Money is a number in USD (no rounding server-side beyond `round()` to int).

## GET /healthz
`{"status":"ok"}`

## GET /api/scenarios
```json
[{"id":"meridian","name":"Meridian Bank","label":"meridian-bank · 13 nodes · 13 edges"}, ...]
```
Order = `SCENARIO_ORDER` (`meridian`, `hydra`, `lion`).

## GET /api/scenarios/{id}
Static scenario data. Everything the design guide holds per scenario EXCEPT what the
AI produces (techniques, hop details, phases, reasoning, narrative, ai_estimate)
and EXCEPT computed numbers.
```json
{
  "id": "meridian",
  "meta": { "name", "headline_lead", "headline_tail", "entity", "reg_primary", "reg_secondary",
            "label", "entry_label", "hops_word", "idle_h1", "idle_intro", "cyber_note",
            "exp_note", "mttd_phrase", ... any other per-scenario display strings, snake_cased },
  "entry": "clearpay-inbox",
  "nodes": [{ "id", "name", "plain_name", "type", "criticality", "critical_function"?,
              "exposed_capacity_24h_usd"?, "detection_delay_hours"?, "detection_delay_evidence"?,
              "x", "y", "entry"? }],
  "edges": [{ "edge_id", "source", "destination", "permission", "allowed",
              "control_multiplier"?, "evidence"? }],
  "rules": { "disruption": {"critical":68,"high":24,"medium":8,"multi_critical"?:96}, "threshold": 100000 },
  "changes": [{ "id", "label", "op": "remove_edge"|"clear_evidence", "target", "field"?,
                "effort", "cuts", "note" }],
  "source": "live" | "cached"   // which reasoner mode the server is in (DEMO_MODE)
}
```

## POST /api/analyze   body: `{"scenario_id":"meridian"}`
Runs reasoner (Gemini live, 8 s timeout → golden cache fallback; `DEMO_MODE=cached` forces cache),
validates every hop against allowed edges, cross-checks `systems_reached` with code BFS,
runs the engine. Response:
```json
{
  "scenario_id": "meridian",
  "source": "live" | "cached",
  "fallback_reason": null | "timeout" | "error" | "validation_failed" | "no_api_key" | "demo_mode",
  "path": {
    "entry_point": "clearpay-inbox",
    "steps": [{"from":"clearpay-inbox","to":"clearpay-keyvault","technique":"...","evidence_edge":"e1"}],
    "systems_reached": ["..."],
    "path_edge_ids": ["e1","e2",...],          // == design guide pathEdgeIds
    "on_path": ["clearpay-inbox", ...]          // == design guide onPath
  },
  "validation": { "hops_verified": 6, "hops_total": 6, "bfs_subset": true, "rejected_hops": [] },
  "techniques": { "e1": "..." },               // design guide TECHNIQUES
  "hop_details": { "e1": {"title","how","leverage", ...} },  // HOP_DETAILS, keys snake_cased
  "phases": [ {"phase","tactic","start","end","edge","detail","branch_exposure"?} ],   // PHASES
  "reasoning": [ {"title","verdict","thought","check"} ],     // REASONING
  "ai_estimate": {"low": 4000000, "high": 6000000},           // AI_ESTIMATE
  "narrative": "... with {exposure} and {disruption} ALREADY substituted by the server ...",
  "narrative_template": "... raw with placeholders ...",
  "verdict": Verdict
}
```

## POST /api/what-if   body: `{"scenario_id":"meridian","change_ids":["revoke-payment-write"]}`
Stackable: applies all listed changes to a deep copy, re-runs BFS + engine. Never calls Gemini.
Empty list allowed (after == before).
```json
{
  "before": Verdict, "after": Verdict,
  "avoided_usd": 2400000,            // before.financial_exposure_usd - after.financial_exposure_usd
  "effort_hours": 1,                 // sum of change.effort
  "removed_edges": ["e6"],
  "cleared_evidence": [{"node_id":"payments-core","field":"detection_delay_hours"}]
}
```
Unknown scenario_id or change_id → 404/422.

## Verdict
Port of the design guide `compute()` — must reproduce its numbers exactly.
```json
{
  "cyber_risk": "HIGH"|"MEDIUM"|"LOW",
  "financial_exposure_usd": 2400000,
  "disruption_hours": 72,
  "regulatory_status": "MAJOR"|"BELOW",
  "complete": true,
  "critical_financial_count": 1,
  "reached": ["clearpay-keyvault", ...],     // BFS from entry over allowed edges (entry itself not included, same as design)
  "per_system": [{
     "node_id": "payments-core",
     "exposed_capacity_24h_usd": 2400000,
     "detection_delay_hours": 24 | null,
     "detection_window_factor": 1.0,          // min(delay/24,1); 1.0 when unknown
     "gap_unknown": false,
     "control_multiplier": 1.0,               // best product over simple paths
     "chain": ["e1","e2",...],
     "bypass_unknown": false,
     "exposure_usd": 2400000
  }],
  "evidence": [{ "factor": "...", "value": "...", "source": "node:payments-core | edge:e6 | rules.json", "rule_id": "R-EXP-1", "unknown": false }]
}
```
Rule IDs (also in each scenario's rules): `R-EXP-1` exposure = capacity × window × multiplier,
`R-WIN-1` window = min(delay/24,1), `R-BYP-1` best-path product of control_multiplier,
`R-DIS-1` disruption tier lookup + multi-critical override, `R-CYB-1` cyber risk,
`R-REG-1` DORA simulated (critical-function financial system reached → MAJOR),
`R-UNK-1` missing evidence → factor 1.0, `complete=false`, UI shows "up to $X".

Footer text (TR-12): "Synthetic data · Regulatory flag is a simplified rule, not legal advice".
