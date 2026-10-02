# Xploit Lab — FAPI (Financial Attack Path Intelligence)

> Shows how one compromised vendor can cascade through a bank, and turns that attack path into a board-level verdict: cyber risk, dollars at risk, hours of disruption, and a simplified DORA regulatory flag.

![Python](https://img.shields.io/badge/python-3.12-blue)
![TypeScript](https://img.shields.io/badge/typescript-React%2019-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

🏆 Built at **[TODO: event name]** ([TODO: date]) · **Live demo:** [TODO: url] · **Demo video:** [TODO: url or remove]

> All bank data is synthetic. The regulatory flag is a simplified rule, not legal advice.

## Table of Contents
- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Common Commands](#common-commands)
- [Troubleshooting](#troubleshooting)
- [License](#license)
- [Author](#author)

## What it does

1. **Pick a scenario.** Three synthetic banks are bundled: `meridian`, `hydra`, `lion` (`backend/data/scenarios/`). Each is a graph of systems (nodes) and permissions (edges), plus a set of possible fixes.
2. **Analyze.** `POST /api/analyze` asks Gemini to propose the attack path: ordered hops, a technique per hop, and narrative prose.
3. **Validate.** Every hop must match an existing `allowed` edge. The claimed `systems_reached` must be a subset of a code-side BFS. If either check fails, the app discards the AI output and serves the pre-validated `golden_path.json`.
4. **Compute the verdict.** A deterministic engine (`backend/app/engine/exposure.py`) calculates exposure, disruption, cyber risk and regulatory status. No number comes from the LLM. The narrative uses `{exposure}` / `{disruption}` placeholders that the code fills in.
5. **Show Me Why.** Every figure lists its factors, its source node or edge, and a rule ID (`R-EXP-1`, `R-WIN-1`, …). Missing evidence becomes the worst case (factor 1.0) and marks the verdict incomplete ("up to $X"). It never silently becomes 0.
6. **What-if.** `POST /api/what-if` applies one or more fixes to a copy of the graph, re-runs BFS and the engine, and returns before/after, avoided USD and effort hours. This step never calls Gemini.

**Live vs cached.** The server falls back to `golden_path.json` when there is no API key, when Gemini takes longer than 8 s, on an error, or when validation fails. `DEMO_MODE=cached` forces the fallback. Every response includes `source: live|cached` and a `fallback_reason`, and the UI shows which one was used. Even in live mode, `hop_details`, `phases`, `reasoning` and `ai_estimate` always come from the golden file. Only the steps, techniques and narrative are live.

## Architecture

| Part | Stack | Where |
|---|---|---|
| Backend API | FastAPI, Pydantic, NetworkX, google-genai (Python 3.12, `uv`) | `backend/` |
| Frontend SPA | React 19, Vite, TypeScript, Tailwind 4, React Flow (pnpm) | `frontend/` |
| API contract | Endpoint and verdict shapes, rule IDs | `API-CONTRACT.md` |
| Product / tech specs | PRD, TRD | `docs/` |

There are two ways to deploy:
- **Local / compose:** two containers. nginx serves the SPA and proxies `/api` and `/healthz` to the FastAPI backend.
- **Cloud Run:** the root `Dockerfile` builds one image. FastAPI serves both the API and the built SPA on `$PORT` (8080). `firebase.json` hosts the static SPA and rewrites `/api/**` and `/healthz` to the Cloud Run service `fapi` in `us-central1`.

```
.
├── backend/          FastAPI app, engine, scenario data, tests
├── frontend/         React SPA (Vite), nginx config
├── docs/             PRD + TRD
├── API-CONTRACT.md   API shapes shared by backend and frontend
├── Dockerfile        single-container Cloud Run image
├── docker-compose*.yml
└── Makefile
```

## Getting Started

### Prerequisites
- Docker with Compose v2.22+ (needed for `docker compose watch`)
- `make`
- To run without Docker: Python 3.12 + [`uv`](https://docs.astral.sh/uv/), Node 22 + pnpm 10 (via `corepack enable`)
- Optional: a Gemini API key. The app runs in cached mode without one.

### Setup
```bash
git clone https://github.com/JaxzTan/Xploit_Lab.git
cd Xploit_Lab
cp .env.example .env    # add GEMINI_API_KEY; set GEMINI_MODEL=gemini-3.1-flash-lite
```

### Run

| Mode | Command | Open |
|---|---|---|
| Production-like | `make` | http://localhost:8888 (API on :8000) |
| Hot reload | `make dev` | http://localhost:5173 (API on :8000) |
| Stop either mode | `make down` | — |

Without Docker:

```bash
cd backend && uv sync && uv run uvicorn app.main:app --port 8000
cd frontend && pnpm install && pnpm dev          # proxies /api to :8000
cd frontend && pnpm dev:mock                     # no backend: in-browser mock API
```

## Configuration

The backend reads real env vars first, then `backend/.env`, then the repo-root `.env`. Real env vars are never overridden.

| Variable | Default | Used by | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | — | backend | Empty ⇒ cached mode. `GEMINI_API` is accepted as a legacy alias |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | backend | |
| `GEMINI_TIMEOUT_S` | `8` | backend | Over budget ⇒ cached (`timeout`) |
| `DEMO_MODE` | `live` | backend | `cached` always serves `golden_path.json` |
| `PORT` | `8080` | root Dockerfile | Cloud Run port |
| `BACKEND_PORT` | `8000` | compose | Host port for the API |
| `FRONTEND_PORT` | `8888` | compose | Host port for nginx |
| `FRONTEND_DEV_PORT` | `5173` | compose dev | Host port for Vite |
| `BACKEND_URL` | `http://backend:8000` | nginx | Proxy target |
| `API_PROXY_TARGET` | `http://localhost:8000` | Vite | Dev proxy target |
| `VITE_MOCK` | unset | frontend | `1` ⇒ in-browser mock API |

## Common Commands

```bash
cd backend && uv run pytest              # backend tests (never call Gemini)
cd frontend && pnpm typecheck            # TS check
cd frontend && pnpm build                # writes SPA to backend/static
docker build -t fapi .                   # single-container Cloud Run image
curl localhost:8000/healthz              # {"status":"ok"}
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every analysis is `cached` with `fallback_reason: error` | `.env.example` sets `GEMINI_MODEL=gemini-2.5-flash`, which now returns 404 for new keys | Set `GEMINI_MODEL=gemini-3.1-flash-lite` or delete the line |
| `fallback_reason: no_api_key` | `GEMINI_API_KEY` empty or not loaded | Put it in the repo-root `.env`, then restart the backend |
| `fallback_reason: timeout` | The model takes longer than 8 s | Use a flash-lite model or raise `GEMINI_TIMEOUT_S` |
| Frontend container stays in "waiting" | The backend healthcheck on `/healthz` has not passed yet | `docker compose logs backend`. Startup fails fast on invalid scenario JSON |
| UI shows a "mock api" tag | Frontend was started with `VITE_MOCK=1` | Run `pnpm dev` instead |
| Port already in use | 8000 / 8888 / 5173 taken | Set `BACKEND_PORT` / `FRONTEND_PORT` / `FRONTEND_DEV_PORT` |

## License

MIT. See [LICENSE](LICENSE).

## Author

**Jaxz Tan Cheng Soo**
- GitHub: [@JaxzTan](https://github.com/JaxzTan)
- LinkedIn: [jaxz-tan-cheng-soo](https://www.linkedin.com/in/jaxz-tan-cheng-soo)

**Johnny Tan**
- LinkedIn: [johnny-tan](https://www.linkedin.com/in/johnny-tcy-5aa38b1b7?utm_source=share_via&utm_content=profile&utm_medium=member_android)