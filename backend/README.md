# FAPI backend

FastAPI + Pydantic + NetworkX + google-genai. API contract: `../API-CONTRACT.md`.

```bash
uv sync                                   # install
uv run pytest                             # tests (never call Gemini)
uv run uvicorn app.main:app --port 8000   # serve API (+ SPA from ./static if built)
DEMO_MODE=cached uv run uvicorn app.main:app --port 8000   # always serve golden_path.json
```

Env (read from real env first, then `backend/.env`, then repo-root `.env`):

| Var | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | — | no key ⇒ cached (`fallback_reason: no_api_key`) |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | `gemini-2.5-flash` now 404s for new keys |
| `GEMINI_TIMEOUT_S` | `8` | over budget ⇒ cached (`timeout`) |
| `DEMO_MODE` | `live` | `cached` forces golden path |

Layout: `app/engine/exposure.py` (pure port of design `compute()`), `app/engine/whatif.py`,
`app/validator.py`, `app/reasoner.py`, `app/loader.py`, `app/main.py`.
Live mode: Gemini supplies steps, techniques and narrative prose. `hop_details`, `phases`,
`reasoning` and `ai_estimate` always come from `golden_path.json`.

Scenario data and the engine oracle are generated from the design guide (needs `node`):

```bash
uv run python scripts/extract_design_data.py /path/to/fapi-artifact/src/index.html
```

This writes `data/scenarios/<id>/{bank,golden_path}.json` and `tests/fixtures/js_expected.json`.
That file holds the design JS `compute()` output for every subset of every scenario's changes.
