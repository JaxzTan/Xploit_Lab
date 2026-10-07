"""FAPI FastAPI app — endpoints per API-CONTRACT.md, plus the built SPA from backend/static/."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from app import config, loader
from app.engine.whatif import UnknownChangeError, baseline, what_if
from app.models import (
    AnalyzeRequest,
    AnalyzeResponse,
    PathOut,
    StepOut,
    WhatIfRequest,
    WhatIfResponse,
)
from app.reasoner import fill_narrative, reason

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("fapi")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    bundles = loader.load_all()  # fail fast on invalid scenario data
    log.info("loaded scenarios %s; reasoner mode=%s model=%s", list(bundles),
             config.server_source(), config.gemini_model())
    yield


app = FastAPI(title="FAPI — Financial Attack Path Intelligence", lifespan=lifespan)


def _bundle(sid: str) -> loader.ScenarioBundle:
    b = loader.get(sid)
    if b is None:
        raise HTTPException(status_code=404, detail=f"unknown scenario_id {sid!r}")
    return b


# Cloud Run reserves paths ending in "z", so /healthz never reaches the app there; /health does.
@app.get("/health")
@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/api/scenarios")
def list_scenarios() -> list[dict]:
    return [
        {"id": sid, "name": b.scenario.meta.get("name", sid), "label": b.scenario.meta.get("label", "")}
        for sid, b in loader.load_all().items()
    ]


@app.get("/api/scenarios/{sid}")
def get_scenario(sid: str) -> dict:
    sc = _bundle(sid).scenario
    out = sc.model_dump(exclude_none=True)
    out["source"] = config.server_source()
    return out


@app.post("/api/analyze", response_model=AnalyzeResponse, response_model_by_alias=True)
async def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    b = _bundle(req.scenario_id)
    r = await reason(b)
    verdict = baseline(b.scenario)
    log.info("analyze %s source=%s fallback=%s latency_ms=%s hops=%d/%d",
             req.scenario_id, r.source, r.fallback_reason, r.latency_ms,
             r.validation.hops_verified, r.validation.hops_total)
    g = b.golden
    return AnalyzeResponse(
        scenario_id=req.scenario_id,
        source=r.source,
        fallback_reason=r.fallback_reason,
        path=PathOut(
            entry_point=r.entry_point,
            steps=[StepOut(**{"from": s.from_}, to=s.to, technique=s.technique,
                           evidence_edge=s.evidence_edge) for s in r.steps],
            systems_reached=r.systems_reached,
            path_edge_ids=r.path_edge_ids,
            on_path=r.on_path,
        ),
        validation=r.validation,
        techniques=r.techniques,
        # Not produced live: always from golden_path.json (see reasoner docstring).
        hop_details=g.hop_details,
        phases=g.phases,
        reasoning=g.reasoning,
        ai_estimate=g.ai_estimate,
        narrative=fill_narrative(r.narrative_template, b.scenario.meta,
                                 verdict.financial_exposure_raw, verdict.disruption_hours),
        narrative_template=r.narrative_template,
        verdict=verdict,
    )


@app.post("/api/what-if", response_model=WhatIfResponse)
def what_if_endpoint(req: WhatIfRequest) -> WhatIfResponse:
    b = _bundle(req.scenario_id)
    try:
        r = what_if(b.scenario, req.change_ids)
    except UnknownChangeError as exc:
        raise HTTPException(status_code=422,
                            detail=f"unknown change_id(s) for {req.scenario_id}: {exc.args[0]}")
    return WhatIfResponse(
        before=r.before, after=r.after, avoided_usd=r.avoided_usd, effort_hours=r.effort_hours,
        removed_edges=r.removed_edges, cleared_evidence=r.cleared_evidence,
    )


# ------------------------------------------------------------------ SPA (one container)


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    if full_path.startswith("api/") or full_path == "api":
        raise HTTPException(status_code=404, detail="not found")
    index = STATIC_DIR / "index.html"
    if not index.is_file():
        raise HTTPException(status_code=404, detail="frontend not built (backend/static missing)")
    if full_path:
        candidate = (STATIC_DIR / full_path).resolve()
        if candidate.is_file() and STATIC_DIR.resolve() in candidate.parents:
            return FileResponse(candidate)
    return FileResponse(index)
