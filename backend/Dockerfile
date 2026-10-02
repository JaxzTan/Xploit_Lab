# FastAPI backend. `dev` = hot reload (used by `make dev`), `prod` = default.
FROM python:3.12-slim AS base
COPY --from=ghcr.io/astral-sh/uv:0.11.25 /uv /usr/local/bin/uv
# venv lives outside the source tree so synced/mounted code never shadows it.
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"
WORKDIR /app/backend
COPY pyproject.toml uv.lock ./
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')"

FROM base AS dev
RUN uv sync --frozen --no-install-project
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

FROM base AS prod
RUN uv sync --frozen --no-dev --no-install-project
COPY . .
RUN useradd --system --no-create-home app
USER app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
