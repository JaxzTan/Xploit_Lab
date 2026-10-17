"""/v1 API (TRD_V2 §5): sample, validate, and the streamed analyze run.

`POST /v1/analyze` returns `text/event-stream`. Events, in order:
  stage{id,label,status,meta,ms} · inputs · ai_input · ai_output · validation · error · result
The stream never dies on a model failure: an `error` event names the fallback
("cached" golden file by input hash, else "engine_only") and the run continues.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections import deque
from collections.abc import AsyncIterator
from datetime import date

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app import config
from app.v1 import ai, checks, engine
from app.v1.schema import MAX_BODY_BYTES, LintResult, ScenarioInput, lint

log = logging.getLogger("fapi.v1")
router = APIRouter(prefix="/v1")

HEARTBEAT_S = 2.0
RATE_LIMIT = 10          # live analyses …
RATE_WINDOW_S = 600      # … per 10 minutes per IP (in memory, per instance)
_hits: dict[str, deque[float]] = {}


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() or (request.client.host if request.client else "?")


def _allow_live(ip: str) -> bool:
    now = time.monotonic()
    q = _hits.setdefault(ip, deque())
    while q and now - q[0] > RATE_WINDOW_S:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        return False
    q.append(now)
    return True


async def _read_json(request: Request) -> object:
    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        raise HTTPException(413, detail={"errors": [{"path": "$", "msg": f"body over {MAX_BODY_BYTES // 1024} KB"}]})
    try:
        return json.loads(body or b"null")
    except json.JSONDecodeError as exc:
        raise HTTPException(422, detail={"errors": [{"path": "$", "msg": f"invalid JSON: {exc.msg} (line {exc.lineno})"}]})


@router.get("/sample")
def sample() -> JSONResponse:
    return JSONResponse(json.loads(ai.SAMPLE_PATH.read_text()))


@router.post("/validate")
async def validate(request: Request) -> dict:
    return lint(await _read_json(request)).as_dict()


@router.post("/analyze")
async def analyze(request: Request, mode: str = "live") -> StreamingResponse:
    res = lint(await _read_json(request))
    if not res.ok:
        raise HTTPException(422, detail=res.as_dict())
    want_live = mode != "cached" and not config.demo_mode_cached()
    if want_live and not config.gemini_api_key():
        skip = "no GEMINI_API_KEY on the server"
    elif want_live and not _allow_live(_client_ip(request)):
        skip = f"rate limit: {RATE_LIMIT} live analyses per {RATE_WINDOW_S // 60} min"
    elif not want_live:
        skip = "DEMO_MODE=cached" if config.demo_mode_cached() else "mode=cached"
    else:
        skip = None
    return StreamingResponse(
        _run(res, skip), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _stage(sid: str, label: str, status: str, meta: str = "", ms: int | None = None) -> str:
    return _sse("stage", {"id": sid, "label": label, "status": status, "meta": meta, "ms": ms})


def _inputs(d: ScenarioInput, entry: str, v: dict) -> dict:
    """Processing step 02: what the engine uses, ranked by exposure, and what it ignores."""
    on_path = {entry}
    path_edges: set[str] = set()
    for p in v["per_system"]:
        on_path |= set(p["route"])
        path_edges |= set(p["chain"])
    crit: dict[str, int] = {}
    for p in v["per_system"]:
        crit[p["criticality"]] = crit.get(p["criticality"], 0) + 1
    tiers = d.rules.disruption_hours.model_dump()
    supporting = [{"label": f"criticality: {k}", "note": f"{n} target{'s' if n > 1 else ''} → disruption hours",
                   "value": f"{tiers.get(k, 0):g}h"} for k, n in crit.items()]
    supporting += [
        {"label": "materiality_threshold_usd", "note": "from input" if d.rules_given else "default",
         "value": engine.usd(d.rules.materiality_threshold_usd)},
        {"label": "edge.control_bypass_probability", "note": "multiplied along each path",
         "value": f"{len(path_edges)} edges"},
    ]
    not_used = [{"label": f"{e.edge_id} · {e.source} → {e.destination}", "note": "allowed: false · blocked"}
                for e in d.edges if not e.allowed]
    not_used += [{"label": n.id, "note": f"{n.type} · not on any path"}
                 for n in d.nodes if n.id not in on_path]
    return {"priority": v["per_system"], "supporting": supporting, "not_used": not_used}


async def _run(res: LintResult, skip: str | None) -> AsyncIterator[str]:
    d, entry = res.data, res.entry
    assert d is not None and entry is not None
    run_id = f"{uuid.uuid4().hex[:4]}-{date.today().isoformat()}"
    t_run = time.perf_counter()
    stats = res.stats()

    def ms(t: float) -> int:
        return int((time.perf_counter() - t) * 1000)

    yield _stage("parse", "Schema and graph lint", "done",
                 f"{stats['nodes']} nodes · {stats['edges']} edges · entry {entry}", 0)

    t = time.perf_counter()
    verdict = engine.compute(d, entry)
    wi = engine.what_ifs(d, entry, verdict)
    yield _sse("inputs", _inputs(d, entry, verdict))
    yield _stage("rank_inputs", "Ranking inputs by exposure at stake", "done",
                 f"{len(verdict['per_system'])} reachable financial systems", ms(t))

    payload = ai.prompt_payload(d, entry)
    golden = ai.golden_for(d)
    analysis: ai.AttackAnalysis | None = None
    source, model, fallback = "engine_only", None, None

    if skip is None:
        model = config.gemini_model()
        yield _stage("gemini_call", f"Calling {model} with response_schema=AttackAnalysis", "running", "temperature 0")
        yield _sse("ai_input", {"model": model, "temperature": 0, "prompt_redactions": ai.REDACTED, "payload": payload})
        t = time.perf_counter()
        task = asyncio.ensure_future(asyncio.wait_for(ai.call_gemini(payload), config.GEMINI_TIMEOUT_S))
        while not task.done():
            done, _ = await asyncio.wait({task}, timeout=HEARTBEAT_S)
            if not done:
                yield ": heartbeat\n\n"
        try:
            analysis = task.result()
            source = "live"
            yield _sse("ai_output", analysis.model_dump(mode="json", by_alias=True))
            yield _stage("gemini_call", f"Calling {model} with response_schema=AttackAnalysis", "done",
                         f"{ms(t) / 1000:.1f} s", ms(t))
        except Exception as exc:  # noqa: BLE001 — timeout or any API / parse error falls back
            reason = "timed out" if isinstance(exc, (asyncio.TimeoutError, TimeoutError)) else f"{type(exc).__name__}"
            fallback = "cached" if golden else "engine_only"
            log.warning("run %s: gemini %s -> %s", run_id, reason, fallback)
            yield _stage("gemini_call", f"Calling {model}", "failed", reason, ms(t))
            yield _sse("error", {"stage": "gemini_call", "message": f"Gemini {reason}", "fallback": fallback})
    else:
        fallback = "cached" if golden else "engine_only"
        intentional = skip.startswith(("DEMO_MODE", "mode="))
        if not intentional or not golden:
            msg = f"Live model skipped: {skip}" if not intentional else "No golden output for this input"
            yield _sse("error", {"stage": "gemini_call", "message": msg, "fallback": fallback})

    hop_checks: list[dict] = []
    steps = None
    if analysis is not None:
        hop_checks, steps = checks.validate_hops(d, entry, verdict["reached"], analysis)
        if not steps:
            fallback = "cached" if golden else "engine_only"
            yield _sse("error", {"stage": "validate_hops", "message": "no model hop survived validation",
                                 "fallback": fallback})
            analysis, source = None, "engine_only"
    if analysis is None and fallback == "cached" and golden is not None:
        analysis = ai.AttackAnalysis.model_validate(golden["analysis"])
        source, model = "cached", golden.get("model", "golden")
        yield _stage("load_golden", "Loading golden output for this input hash", "done", "no model call", 0)
        yield _sse("ai_input", {"model": model, "temperature": 0, "prompt_redactions": ai.REDACTED, "payload": payload})
        yield _sse("ai_output", golden["analysis"])
        hop_checks, steps = checks.validate_hops(d, entry, verdict["reached"], analysis)

    reasoning: list[dict] = []
    phases: list[dict] = []
    bfs_subset, extra = True, []
    if analysis is not None:
        t = time.perf_counter()
        hop_nodes = {entry} | {s.from_ for s in steps or []} | {s.to for s in steps or []}
        reasoning = checks.reasoning_verdicts(d, entry, verdict["reached"], verdict, analysis, hop_nodes)
        phases = checks.phases_out(d, verdict, analysis)
        extra = [n for n in analysis.systems_reached if n not in set(verdict["reached"])]
        bfs_subset = not extra
        counts = {k: sum(r["verdict"] == k for r in reasoning) for k in ("accepted", "corrected", "rejected")}
        ok = sum(h["ok"] for h in hop_checks)
        yield _sse("validation", {"hops": hop_checks, "bfs_subset": bfs_subset, "extra": extra,
                                  "reasoning_verdicts": counts})
        yield _stage("validate_hops", "Validating every hop against the input", "done",
                     f"{ok}/{len(hop_checks)} allowed edges", ms(t))
        yield _stage("bfs_crosscheck", "Cross-checking systems_reached with code BFS", "done",
                     "subset ✓" if bfs_subset else f"BFS wins · dropped {', '.join(extra)}", 0)
    else:
        yield _stage("validate_hops", "Engine-only: hops are the BFS best paths", "done", "no model output", 0)

    t = time.perf_counter()
    hops = checks.hops_out(d, steps, verdict)
    yield _stage("engine", "Running exposure engine", "done", "pure functions · D-1 to D-5", ms(t))
    yield _stage("what_ifs", "Precomputing what-if changes", "done", f"{len(wi)} changes", 0)

    ai_estimate = None
    if analysis is not None:
        lo, hi = analysis.loss_estimate_usd.low, analysis.loss_estimate_usd.high
        total = verdict["financial_exposure_usd"]
        delta = round(((lo + hi) / 2 - total) / total * 100) if total else None
        ai_estimate = {"low": lo, "high": hi, "delta_pct_vs_engine": delta}
    on_path = [entry]
    for h in hops:
        for nid in (h["from"], h["to"]):
            if nid not in on_path:
                on_path.append(nid)
    template = analysis.narrative if analysis is not None else checks.ENGINE_NARRATIVE

    result = {
        "run_id": run_id, "source": source, "model": model, "fallback": fallback,
        "scenario_id": d.scenario_id,
        "scenario_label": f"{d.scenario_id} · {len(d.nodes)} nodes · {len(d.edges)} edges",
        "entry": entry,
        "verdict": engine.summary(verdict) | {"threshold_usd": verdict["threshold_usd"]},
        "per_system": verdict["per_system"],
        "reached": verdict["reached"],
        "evidence": verdict["evidence"],
        "hops": hops,
        "path_edges": [h["edge_id"] for h in hops],
        "on_path": on_path,
        "validation": {"hops": hop_checks, "bfs_subset": bfs_subset, "extra": extra},
        "phases": phases,
        "reasoning": reasoning,
        "mttd_estimates": [m.model_dump() for m in analysis.mttd_estimate_h] if analysis else [],
        "ai_estimate": ai_estimate,
        "narrative": checks.fill_narrative(template, len(hops), verdict, wi),
        "what_ifs": wi,
        "rules": {"disruption_hours": d.rules.disruption_hours.model_dump(),
                  "materiality_threshold_usd": d.rules.materiality_threshold_usd},
        "graph": {"nodes": [n.model_dump(exclude_none=True) for n in d.nodes],
                  "edges": [e.model_dump(exclude_none=True) for e in d.edges]},
        "ms": ms(t_run),
    }
    log.info("run %s scenario=%s source=%s fallback=%s total=%s ms=%d", run_id, d.scenario_id,
             source, fallback, engine.usd(verdict["financial_exposure_usd"]), result["ms"])
    yield _sse("result", result)
