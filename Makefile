DENO ?= deno
IMAGE ?= vivabem
TAG ?= $(shell grep -o '"version": *"[^"]*"' deno.json | head -1 | sed 's/.*"\([^"]*\)"$$/\1/')

.PHONY: help install dev start test check lint fmt migrate reset backup seed clean docker-build docker-run deploy up down logs web-install web-dev web-build web-check

help: ## Lista os comandos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Instala dependências (cria node_modules)
	$(DENO) install

dev: ## Sobe o servidor com watch
	$(DENO) task dev

start: ## Sobe o servidor
	$(DENO) task start

test: ## Roda a suíte de testes
	$(DENO) task test

check: ## Typecheck de src, tests e scripts
	$(DENO) task check

lint: ## Lint
	$(DENO) task lint

fmt: ## Formata o código
	$(DENO) task fmt

migrate: ## Aplica as migrações pendentes
	$(DENO) task db:migrate

reset: ## Apaga e recria o banco
	$(DENO) task db:reset

backup: ## Gera um backup em backups/
	$(DENO) task db:backup

seed: ## Dados de demonstração (a partir da Fase 2)
	@echo "seed ainda não implementado"

clean: ## Remove artefatos locais (não remove o banco)
	rm -rf coverage build

web-install: ## Instala dependências do frontend
	cd web && npm ci

web-dev: ## Sobe o frontend com Vite (proxy para a API em :3000)
	cd web && npm run dev

web-build: ## Gera o build de produção do frontend
	cd web && npm run build

web-check: ## Typecheck do frontend (svelte-check)
	cd web && npm run check

docker-build: ## Builda a imagem Docker
	docker build --build-arg VERSION=$(TAG) -t $(IMAGE):$(TAG) .

docker-run: ## Roda a imagem (requer JWT_SECRET no ambiente)
	docker run --rm -p 3000:3000 -v vivabem-data:/app/data -e JWT_SECRET="$${JWT_SECRET:?defina JWT_SECRET}" $(IMAGE):$(TAG)

deploy: up ## Builda e sobe a stack em background
up: ## Builda e sobe a stack (compose)
	docker compose up -d --build

down: ## Para e remove os containers (mantém volumes)
	docker compose down

logs: ## Acompanha os logs da stack
	docker compose logs -f --tail=100
