COMPOSE := docker compose -f docker-compose.yml

.PHONY: all dev down

# Build and run both services detached: app at http://localhost:8888, API at :8000
all:
	$(COMPOSE) --profile prod up -d --build

# Hot reload: Vite at http://localhost:5173, API at :8000. Ctrl-C to stop watching.
dev:
	$(COMPOSE) --profile dev up --build --watch

# Stop and remove containers from either mode
down:
	$(COMPOSE) --profile prod --profile dev down --remove-orphans
