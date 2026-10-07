# Stage 1: build the React SPA into backend/static
FROM node:22-slim AS web
WORKDIR /app/frontend
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# Stage 2: FastAPI serves the API and the built SPA
FROM python:3.12-slim
RUN pip install --no-cache-dir uv==0.11.25
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock* ./
RUN uv sync --no-dev --no-install-project
COPY backend/ ./
COPY --from=web /app/backend/static ./static
ENV PORT=8080 PATH="/app/backend/.venv/bin:$PATH"
EXPOSE 8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
