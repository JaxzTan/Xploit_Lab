"""Gemini reasoner with golden-path fallback.

Live mode: one structured-output call (response_schema=AttackPath, temperature 0) supplies
the hops, a technique per hop, systems_reached and the narrative prose (with {exposure} /
{disruption} placeholders). The rich display content — hop_details, phases, reasoning and
ai_estimate — is NOT produced live; it is always taken from golden_path.json.

Fallback to golden_path.json on: no API key, DEMO_MODE=cached, 8 s timeout, any API/parse
error, or any hop the validator rejects.

The graph sent to Gemini carries NO dollar, detection or multiplier fields, and dollar
amounts inside free-text evidence are redacted.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Literal

from app import config
from app.engine.exposure import usd
from app.loader import ScenarioBundle
from app.models import AttackPath, RejectedHop, Scenario, Step, Validation
from app.validator import validate_path

log = logging.getLogger("fapi.reasoner")

FallbackReason = Literal["timeout", "error", "validation_failed", "no_api_key", "demo_mode"]

_MONEY = re.compile(r"[$€£]\s?\d[\d,.]*\s?(?:[kKmMbB]n?|million|billion)?")
# engine inputs quoted inside free text, e.g. "(path_control_multiplier 0.80)"
_ENGINE_FIELD = re.compile(
    r"\s*\(?\b\w*(?:control_multiplier|detection_delay\w*|exposed_capacity\w*)\b[\s=:]*[\d.]+h?\)?"
)


@dataclass
class ReasonerResult:
    source: Literal["live", "cached"]
    fallback_reason: FallbackReason | None
    entry_point: str
    steps: list[Step]
    systems_reached: list[str]
    path_edge_ids: list[str]
    on_path: list[str]
    techniques: dict[str, str]
    narrative_template: str
    validation: Validation
    rejected_live_hops: list[RejectedHop] = field(default_factory=list)
    latency_ms: int | None = None


def redact(text: str | None) -> str | None:
    if not text:
        return text
    return _ENGINE_FIELD.sub("", _MONEY.sub("[amount withheld]", text))


def sanitized_graph(scenario: Scenario) -> dict:
    """Graph for the prompt: no exposed_capacity / detection / control_multiplier / layout."""
    return {
        "entry": scenario.entry,
        "nodes": [
            {k: v for k, v in {
                "id": n.id, "name": n.name, "plain_name": n.plain_name, "type": n.type,
                "criticality": n.criticality, "critical_function": n.critical_function,
                "entry": n.entry,
            }.items() if v is not None}
            for n in scenario.nodes
        ],
        "edges": [
            {k: v for k, v in {
                "edge_id": e.edge_id, "source": e.source, "destination": e.destination,
                "permission": e.permission, "allowed": e.allowed, "evidence": redact(e.evidence),
            }.items() if v is not None}
            for e in scenario.edges
        ],
    }


PROMPT = """You are an attack-path analyst for a bank. Below is the bank's configuration graph
as JSON. The attacker controls the entry node "{entry}".

Rules (hard constraints):
1. Use ONLY nodes and edges that appear in the graph. Never invent a node, edge, or edge_id.
2. A hop may only use an edge with "allowed": true. Edges with "allowed": false are blocked.
3. Each step: "from" = edge.source, "to" = edge.destination, "evidence_edge" = edge.edge_id.
4. Include every hop needed to reach every node of type "financial" that is reachable from the
   entry; stop at the financial systems (do not continue past them).
5. "technique": the attack technique for that hop, with its MITRE ATT&CK ID, informed by the
   edge's permission and evidence text, written as "<Technique name> (Txxxx) — <one short clause>".
6. "systems_reached": the ids of the nodes the attacker reaches on those hops (not the entry).
7. "narrative": 3-4 sentences for a non-technical bank board explaining how the compromise
   cascades. Do NOT write any number, amount, currency, duration or percentage. Where the
   money at risk belongs, write the literal placeholder {{exposure}}; where the hours of
   disruption belong, write the literal placeholder {{disruption}} (e.g. "{{disruption}} hours").
8. You do not estimate money, detection times, probabilities or regulatory status.

Graph:
{graph}
"""


def _cached(bundle: ScenarioBundle, reason: FallbackReason,
            rejected: list[RejectedHop] | None = None, latency_ms: int | None = None
            ) -> ReasonerResult:
    g, sc = bundle.golden, bundle.scenario
    res = validate_path(sc, g.entry_point, g.steps, g.systems_reached)
    validation = res.validation
    if rejected:
        validation = validation.model_copy(update={"rejected_hops": rejected})
    return ReasonerResult(
        source="cached", fallback_reason=reason, entry_point=g.entry_point, steps=g.steps,
        systems_reached=res.systems_reached, path_edge_ids=g.path_edge_ids, on_path=g.on_path,
        techniques=g.techniques, narrative_template=g.narrative_template,
        validation=validation, rejected_live_hops=rejected or [], latency_ms=latency_ms,
    )


_client = None


def _get_client(api_key: str):
    global _client
    if _client is None:
        from google import genai
        from google.genai import types

        _client = genai.Client(
            api_key=api_key,
            # The API rejects deadlines < 10 s; the 8 s budget is enforced by asyncio.wait_for.
            http_options=types.HttpOptions(timeout=15_000),
        )
    return _client


async def _call_gemini(scenario: Scenario, api_key: str) -> AttackPath:
    from google.genai import types

    client = _get_client(api_key)
    prompt = PROMPT.format(entry=scenario.entry,
                           graph=json.dumps(sanitized_graph(scenario), ensure_ascii=False))
    resp = await client.aio.models.generate_content(
        model=config.gemini_model(),
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0,
            response_mime_type="application/json",
            response_schema=AttackPath,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        ),
    )
    return AttackPath.model_validate_json(resp.text)


def _narrative_ok(text: str) -> bool:
    # "{disruption} hours" (not bare "{disruption}") so the injected figure always carries its unit
    return "{exposure}" in text and "{disruption} hours" in text and not _MONEY.search(text) \
        and "$" not in text


async def reason(bundle: ScenarioBundle) -> ReasonerResult:
    sc = bundle.scenario
    if config.demo_mode_cached():
        return _cached(bundle, "demo_mode")
    api_key = config.gemini_api_key()
    if not api_key:
        return _cached(bundle, "no_api_key")

    t0 = time.perf_counter()
    try:
        path = await asyncio.wait_for(_call_gemini(sc, api_key), timeout=config.GEMINI_TIMEOUT_S)
    except (asyncio.TimeoutError, TimeoutError):
        ms = int((time.perf_counter() - t0) * 1000)
        log.warning("%s: Gemini timed out after %d ms -> cached", sc.id, ms)
        return _cached(bundle, "timeout", latency_ms=ms)
    except Exception as exc:  # noqa: BLE001 — any API/parse error falls back
        ms = int((time.perf_counter() - t0) * 1000)
        if "timeout" in type(exc).__name__.lower() or "timed out" in str(exc).lower():
            log.warning("%s: Gemini timed out (%s) -> cached", sc.id, type(exc).__name__)
            return _cached(bundle, "timeout", latency_ms=ms)
        log.warning("%s: Gemini error %s: %s -> cached", sc.id, type(exc).__name__,
                    str(exc)[:300])
        return _cached(bundle, "error", latency_ms=ms)
    ms = int((time.perf_counter() - t0) * 1000)

    res = validate_path(sc, path.entry_point, path.steps, path.systems_reached)
    if not res.ok:
        log.warning("%s: live path failed validation (%d rejected) -> cached",
                    sc.id, len(res.validation.rejected_hops))
        return _cached(bundle, "validation_failed", rejected=res.validation.rejected_hops,
                       latency_ms=ms)

    narrative = path.narrative
    if not _narrative_ok(narrative):
        log.warning("%s: live narrative missing placeholders or contains numbers -> "
                    "using golden narrative template", sc.id)
        narrative = bundle.golden.narrative_template

    on_path = [sc.entry]
    for s in path.steps:
        for nid in (s.from_, s.to):
            if nid not in on_path:
                on_path.append(nid)
    return ReasonerResult(
        source="live", fallback_reason=None, entry_point=sc.entry, steps=path.steps,
        systems_reached=res.systems_reached, path_edge_ids=[s.evidence_edge for s in path.steps],
        on_path=on_path, techniques={s.evidence_edge: s.technique for s in path.steps},
        narrative_template=narrative, validation=res.validation, latency_ms=ms,
    )


def _fmt_num(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else str(x)


def fill_narrative(template: str, meta: dict, exposure_raw: float, disruption: float) -> str:
    """Server-side number injection (TR-10). Placeholders mirror the design guide."""
    out = template.replace("{exposure}", usd(exposure_raw))
    out = out.replace("{disruption}", _fmt_num(disruption))
    out = out.replace("{hops}", str(meta.get("hops_word", "")))
    out = out.replace("{mttd}", str(meta.get("mttd_phrase", "")))
    if "avoided" in meta:
        out = out.replace("{avoided}", usd(meta["avoided"]))
    return out
