# React SPA. `dev` = Vite dev server with HMR (used by `make dev`), `prod` = nginx (default).
FROM node:22-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app/frontend
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .

FROM base AS dev
EXPOSE 5173
CMD ["pnpm", "exec", "vite", "--host", "0.0.0.0", "--port", "5173"]

FROM base AS build
# vite.config.ts writes to ../backend/static for the single-container image; override here.
RUN pnpm exec tsc -b && pnpm exec vite build --outDir dist --emptyOutDir

# Unprivileged image: runs as the nginx user and listens on 8080, not 80.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS prod
# nginx renders templates/*.template with envsubst at startup.
ENV BACKEND_URL=http://backend:8000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
