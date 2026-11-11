# Viva Bem

[![CI](https://github.com/Erik-Castro/vivaBem-enhanced/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Erik-Castro/vivaBem-enhanced/actions/workflows/ci.yml)
[![Versão](https://img.shields.io/github/v/tag/Erik-Castro/vivaBem-enhanced?label=version&sort=semver)](https://github.com/Erik-Castro/vivaBem-enhanced/tags)
[![Deno](https://img.shields.io/badge/Deno-2.9-000000?logo=deno&logoColor=white)](https://deno.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev/)
[![Licença: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

App de finanças pessoais + construção de hábitos, com análise assíncrona por IA. Este repositório é
uma reescrita greenfield, **API-first**, a partir do projeto legado em `reference_only/` (somente
leitura).

- **Plano completo:** [`docs/PLAN.md`](docs/PLAN.md)
- **API:** [`docs/API.md`](docs/API.md) e `/api/docs`
- **Frontend:** [`docs/FRONTEND.md`](docs/FRONTEND.md) — SPA em `web/`
- **Deploy e operação:** [`docs/DEPLOY.md`](docs/DEPLOY.md)
- **Guia de contribuição/agentes:** [`AGENTS.md`](AGENTS.md)
- **Changelog:** [`CHANGELOG.md`](CHANGELOG.md)

## Stack

| Camada            | Tecnologia                                         |
| ----------------- | -------------------------------------------------- |
| Runtime           | Deno 2.9                                           |
| HTTP              | Hono 4                                             |
| Validação/OpenAPI | Zod 4 + `@hono/zod-openapi` (OpenAPI 3.1)          |
| Banco             | SQLite (`better-sqlite3`) + `sqlite-vector`        |
| Auth              | Argon2id + access JWT em cookie + refresh rotativo |
| Testes            | `Deno.test` + `@std/assert`                        |
| Frontend          | Svelte 5 + Vite 7 + TypeScript + PWA               |
| Deploy            | Docker multi-stage + Compose (API + Nginx)         |

## Requisitos

- Deno **2.9.8** ou superior
- Node **20.19+** ou **22.12+** (apenas para o frontend em `web/`)
- Docker (opcional, para deploy)

`better-sqlite3` é um addon nativo: as tasks já incluem `--allow-ffi` e `--allow-sys`.

## Quick start

```bash
deno install
deno task dev
```

`deno task dev` carrega o `.env.example` automaticamente — não é preciso criar `.env`. Variáveis
exportadas no shell têm precedência sobre o arquivo (por exemplo, `JWT_SECRET=... deno task dev`).

Servidor em `http://localhost:3000`:

| Rota                                                     | Descrição                          |
| -------------------------------------------------------- | ---------------------------------- |
| `GET /health`                                            | Liveness                           |
| `GET /ready`                                             | Readiness (banco + migrações)      |
| `GET /api/v1/openapi.json`                               | Documento OpenAPI 3.1              |
| `GET /api/docs`                                          | Swagger UI                         |
| `GET /api/v1/auth/csrf`                                  | Bootstrap do token CSRF            |
| `POST /api/v1/auth/register`                             | Cria conta e inicia sessão         |
| `POST /api/v1/auth/login`                                | Autentica                          |
| `POST /api/v1/auth/refresh`                              | Rotaciona a sessão                 |
| `POST /api/v1/auth/logout`                               | Encerra a sessão                   |
| `GET/PATCH /api/v1/me`                                   | Perfil do usuário                  |
| `PATCH /api/v1/me/preferences`                           | Preferências regionais             |
| `GET /api/v1/me/sessions`                                | Sessões ativas                     |
| `DELETE /api/v1/me/sessions/:id`                         | Revoga uma sessão                  |
| `GET/POST /api/v1/accounts`                              | Lista e cria contas                |
| `GET/PATCH/DELETE /api/v1/accounts/:id`                  | Detalhe, edição e desativação      |
| `GET /api/v1/accounts/:id/balance`                       | Saldo e limite disponível          |
| `GET /api/v1/accounts/:id/transactions`                  | Extrato da conta                   |
| `GET/POST /api/v1/categories`                            | Lista e cria categorias            |
| `GET /api/v1/categories/tree`                            | Árvore de categorias               |
| `GET/PATCH/DELETE /api/v1/categories/:id`                | Detalhe, edição e desativação      |
| `GET/POST /api/v1/transactions`                          | Lista e cria transações            |
| `GET/PATCH/DELETE /api/v1/transactions/:id`              | Detalhe, edição e remoção          |
| `GET /api/v1/transactions/summary`                       | Resumo por moeda e categoria       |
| `POST /api/v1/transactions/transfer`                     | Transferência entre contas         |
| `POST /api/v1/transactions/:id/clear`                    | Marca como compensada              |
| `GET/POST /api/v1/recurring`                             | Lista e cria recorrências          |
| `GET /api/v1/recurring/upcoming`                         | Próximas ocorrências previstas     |
| `GET/PATCH/DELETE /api/v1/recurring/:id`                 | Detalhe, edição e desativação      |
| `POST /api/v1/recurring/:id/run-now`                     | Materializa a próxima ocorrência   |
| `GET/POST /api/v1/budgets`                               | Lista e cria orçamentos            |
| `GET /api/v1/budgets/status`                             | Consumo, saldo e limiares          |
| `GET/PATCH/DELETE /api/v1/budgets/:id`                   | Detalhe, edição e desativação      |
| `GET/POST /api/v1/goals`                                 | Lista e cria metas                 |
| `GET/PATCH/DELETE /api/v1/goals/:id`                     | Detalhe, edição e cancelamento     |
| `GET /api/v1/goals/:id/progress`                         | Progresso e contribuições          |
| `POST /api/v1/goals/:id/contributions`                   | Registra contribuição              |
| `DELETE /api/v1/goals/:id/contributions/:contributionId` | Remove contribuição                |
| `GET/POST /api/v1/habits`                                | Lista e cria hábitos               |
| `GET/PATCH/DELETE /api/v1/habits/:id`                    | Detalhe, edição e desativação      |
| `POST /api/v1/habits/:id/reorder`                        | Move o hábito na ordem de exibição |
| `GET/POST /api/v1/habits/:id/logs`                       | Lista e registra logs diários      |
| `DELETE /api/v1/habits/:id/logs/:logId`                  | Remove um log diário               |
| `GET /api/v1/habits/:id/streak`                          | Streak corrente e recorde          |
| `GET /api/v1/habits/:id/calendar`                        | Calendário de cumprimento          |
| `GET/POST /api/v1/habit-triggers`                        | Lista e cria gatilhos              |
| `PATCH/DELETE /api/v1/habit-triggers/:id`                | Edita e remove gatilho             |
| `GET/POST /api/v1/investments`                           | Lista e cria ativos                |
| `GET/PATCH/DELETE /api/v1/investments/:id`               | Detalhe, edição e remoção          |
| `GET/POST /api/v1/investments/:id/transactions`          | Lista e registra operações         |
| `GET /api/v1/investments/portfolio`                      | Carteira consolidada               |
| `GET /api/v1/investments/:id/performance`                | Posição, custo médio e P&L         |
| `GET/POST /api/v1/investments/:id/quotes`                | Lista e registra cotações          |
| `GET /api/v1/achievements`                               | Catálogo público de conquistas     |
| `GET /api/v1/achievements/me`                            | Conquistas desbloqueadas           |
| `GET /api/v1/achievements/me/progress`                   | Progresso de todas as conquistas   |
| `GET /api/v1/notifications`                              | Lista notificações                 |
| `GET /api/v1/notifications/unread-count`                 | Notificações não lidas             |
| `PATCH /api/v1/notifications/:id/read`                   | Marca uma notificação como lida    |
| `POST /api/v1/notifications/read-all`                    | Marca todas como lidas             |
| `GET /api/v1/insights`                                   | Insights gerados pela IA           |
| `GET /api/v1/insights/unread-count`                      | Insights não lidos                 |
| `GET /api/v1/insights/search?q=`                         | Busca textual/vetorial de insights |
| `PATCH /api/v1/insights/:id/read`                        | Marca um insight como lido         |
| `POST /api/v1/insights/read-all`                         | Marca todos os insights como lidos |
| `POST /api/v1/insights/:id/feedback`                     | Registra feedback do insight       |
| `POST /api/v1/import/preview`                            | Prévia de import CSV/OFX           |
| `POST /api/v1/import/commit`                             | Importa CSV/OFX com dedupe         |
| `GET /api/v1/export?format=csv\|json`                    | Exporta os dados do usuário        |
| `POST /api/v1/family/invite`                             | Convida um familiar                |
| `GET /api/v1/family`                                     | Convites e vínculo ativo           |
| `POST /api/v1/family/:id/accept`                         | Aceita um convite                  |
| `POST /api/v1/family/:id/reject`                         | Recusa um convite                  |
| `DELETE /api/v1/family/:id`                              | Encerra convite ou vínculo         |
| `GET /api/v1/family/summary`                             | Resumo agregado do parceiro        |

Importação usa `multipart/form-data` com os campos `accountId` e `file`; exportação aceita
`format=csv` ou `format=json`. O resumo familiar expõe apenas totais e contagens do mês corrente,
nunca transações individuais.

O banco é criado em `./data/app.db` e as migrações rodam no boot.

## Frontend

O SPA fica em `web/` (Svelte 5 + Vite + PWA) e consome a API pela mesma origem.

```bash
cd web && npm ci
make web-dev          # Vite em http://localhost:5173
```

Com a API rodando em `:3000`, use `APP_ORIGIN=http://localhost:5173` — a API exige que a origem do
navegador seja exatamente essa. Também existem:

```bash
make web-check        # svelte-check
make web-build        # build de produção em web/dist
cd web && npm run preview   # build em http://localhost:4173 (APP_ORIGIN igual)
```

Telas entregues: login/cadastro, painel, contas, transações (com transferência), recorrências,
categorias, orçamentos, metas, hábitos, investimentos, conquistas, notificações, insights, dados
(import/export), família e configurações (perfil, preferências, sessões e tema). Detalhes:
[`docs/FRONTEND.md`](docs/FRONTEND.md).

## Autenticação

O fluxo é baseado em cookies, sem tokens no corpo da resposta:

1. `GET /api/v1/auth/csrf` define `vb_csrf` (legível pelo JS).
2. `POST /api/v1/auth/register` ou `/login` define `vb_access` (JWT, 15 min) e `vb_refresh` (opaco,
   30 dias) — ambos HttpOnly.
3. Toda requisição mutável envia o header `X-CSRF-Token` com o valor de `vb_csrf`.
4. `POST /api/v1/auth/refresh` rotaciona o refresh token; reutilizar um token já rotacionado revoga
   a família inteira.

Em produção os cookies usam `Secure`. Em desenvolvimento (`ENV=development`) rodando em HTTP,
`COOKIE_SECURE=auto` mantém os cookies utilizáveis.

## Comandos

```bash
deno task dev            # servidor com watch
deno task start          # servidor
deno task dev:worker     # worker do EIE com watch (outbox → IA)
deno task worker         # worker do EIE (processo separado da API)
deno task test           # testes
deno task test:coverage  # testes com cobertura
deno task check          # typecheck
deno task lint           # lint
deno task fmt            # formatação
deno task db:migrate     # migrações
deno task db:reset       # apaga e recria o banco
deno task db:backup      # backup em backups/
deno task outbox:replay --stats             # resumo da fila (totais, retries, dead letter)
deno task outbox:replay --list  # eventos em dead letter
deno task outbox:replay --id=<uuid> --force  # recoloca na fila
deno task check:release  # valida versão x changelog

make web-install         # npm ci no frontend
make web-dev             # Vite em http://localhost:5173
make web-check           # svelte-check
make web-build           # build de produção em web/dist
```

Ou use o `Makefile`: `make help`.

## Configuração

Todas as variáveis estão em [`.env.example`](.env.example). Destaques:

| Variável                  | Padrão                   | Observação                                                 |
| ------------------------- | ------------------------ | ---------------------------------------------------------- |
| `PORT`                    | `3000`                   |                                                            |
| `ENV`                     | `development`            | `development`, `test`, `production`                        |
| `DATABASE_PATH`           | `./data/app.db`          | Use `/app/data/app.db` no Docker                           |
| `APP_ORIGIN`              | `http://localhost:3000`  | Origem exata do frontend (CORS/CSRF)                       |
| `WEB_PORT`                | `8080`                   | Porta publicada do container web no Compose                |
| `JWT_SECRET`              | —                        | **Obrigatório em produção** (32+ caracteres)               |
| `RATE_LIMIT_AUTH_MAX`     | `5`                      | Tentativas por minuto em autenticação                      |
| `RATE_LIMIT_DATA_MAX`     | `30`                     | Chamadas por minuto em import/export                       |
| `AI_ENABLED`              | `false`                  | O `.env.example` liga com Ollama local; opt-in por usuário |
| `AI_PROVIDER`             | `openai`                 | `openai` (compatível) ou `ollama`                          |
| `AI_MODEL`                | —                        | Modelo de chat do Ollama (ex.: `qwen3.5:2b`)               |
| `AI_OLLAMA_URL`           | `http://localhost:11434` | Endpoint do Ollama                                         |
| `WORKER_CONCURRENCY`      | `1`                      | Eventos processados em paralelo (1 a 8)                    |
| `WORKER_LEASE_MS`         | `60000`                  | Validade do lease do evento                                |
| `WORKER_MAX_ATTEMPTS`     | `5`                      | Tentativas antes do dead letter                            |
| `WORKER_POLL_INTERVAL_MS` | `1000`                   | Intervalo de polling da outbox                             |
| `VECTOR_EXTENSION_PATH`   | —                        | Sobrescreve o binário do `sqlite-vector`                   |

Nenhum segredo tem valor padrão em produção. Em dev, um segredo efêmero é gerado no boot (com aviso
no log).

### IA local (Ollama)

O `.env.example` já vem com `AI_ENABLED=true` e `AI_PROVIDER=ollama`, usando `qwen3.5:2b` para chat
e `nomic-embed-text` para embeddings (768 dimensões). Outros modelos locais (`gemma4:e2b`,
`ornith-1.5:9b`, `lfm3-omni`, ...) podem ser usados trocando `AI_MODEL`; confira os disponíveis com
`ollama list`.

A IA continua opt-in por usuário: depois do login, ative "Inteligência artificial" em `#/settings`.
Sem isso nenhum evento entra no outbox. Em produção, defina `AI_ENABLED=false` (ou configure um
provider com chave).

O consumidor do outbox é um processo independente: `deno task worker` (ou `deno task dev:worker` com
watch). A API responde normalmente mesmo com o provider lento; os dois processos compartilham apenas
o arquivo SQLite. Sem `AI_ENABLED=true` o worker registra `worker_disabled` e encerra. Eventos que
esgotam as tentativas ficam em dead letter; `deno task outbox:replay --stats` dá o panorama da fila
(totais, retries e dead letter por tipo) e `--list` mostra os eventos um a um.

## Docker

Deploy em um comando com Compose (build da API + frontend, volumes e healthcheck):

```bash
cp .env.example .env   # defina APP_ORIGIN e JWT_SECRET; em HTTP local, COOKIE_SECURE=false
# Em produção mantenha AI_ENABLED=false (o exemplo liga a IA com Ollama local).
make deploy            # docker compose up -d --build
curl -fsS http://127.0.0.1:3000/ready
```

- API: `http://localhost:3000` (health em `/health`)
- Frontend: `http://localhost:8080` (Nginx não-root, proxy para a API)

O worker de IA é um serviço separado, no profile `ai` do Compose:

```bash
docker compose --profile ai up -d --build   # API + frontend + worker
docker compose --profile ai up -d worker    # apenas o worker
```

Sem IA habilitada ele encerra com `worker_disabled`; a stack continua funcionando sem o worker.

Em produção troque `APP_ORIGIN` pela URL HTTPS pública do frontend e mantenha `COOKIE_SECURE=true`.

Build manual da API:

```bash
docker build --build-arg VERSION=$(grep -o '"version": *"[^"]*"' deno.json | cut -d'"' -f4) -t vivabem:local .
docker run --rm -p 3000:3000 \
  -v vivabem-data:/app/data \
  -v vivabem-backups:/app/backups \
  -e JWT_SECRET="$(openssl rand -base64 48)" \
  -e APP_ORIGIN="http://localhost:3000" \
  vivabem:local
```

Build manual do frontend (o Nginx procura a API no host `vivabem`; use Compose para a rede correta):

```bash
docker build -t vivabem-web:local ./web
docker run --rm -p 8080:8080 vivabem-web:local
```

Backup, restore, Portainer e checklist de produção: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Checklist de produção

- [ ] `ENV=production`, HTTPS e `COOKIE_SECURE=true`.
- [ ] `JWT_SECRET` forte e fora do Git.
- [ ] `APP_ORIGIN` igual à origem do frontend.
- [ ] Volume `/app/data` persistente.
- [ ] Backup diário agendado, copiado para fora do host e restore testado.
- [ ] `/health` e `/ready` monitorados.
- [ ] `AI_ENABLED=false` até o usuário autorizar.
- [ ] Uma única instância (SQLite é single-writer).
- [ ] Frontend em HTTPS na mesma origem da API (proxy `/api` do Nginx).

## Estrutura

```text
src/
  main.ts          # bootstrap da API: config → migrações → seed → servidor
  worker/          # entry point e runtime do consumidor da outbox (IA)
  app.ts           # factory do Hono (sem efeitos colaterais)
  config.ts        # env validado com Zod
  version.ts       # versão lida do deno.json
  http/            # erros, OpenAPI, middlewares
  db/              # conexão, migrações, repositórios
  modules/         # domínios (auth, transactions, habits, ...)
  events/          # outbox + registry + replay CLI
  ai/              # providers, prompts, tools, executor, embeddings
  shared/          # logger, crypto, utils
tests/             # unit, integration, e2e
bin/sqlite-vector/ # fallback do binário da extensão vetorial
web/               # SPA Svelte 5 + Vite + PWA (Nginx no Compose)
```

## Versionamento

- [SemVer 2.0.0](https://semver.org/lang/pt-BR/): `MAJOR.MINOR.PATCH`.
- [Keep a Changelog 1.1.0](https://keepachangelog.com/pt-BR/1.1.0/).
- A versão do `deno.json` é a fonte da verdade e aparece em `/health`, no OpenAPI e na label Docker.
- Durante `0.y.z` o contrato ainda pode mudar; `1.0.0` marca o congelamento da API v1.

## Status

Fases 0 (fundação), 1 (identidade), 2 (finanças), 3 (planejamento), 4 (hábitos), 5 (investimentos),
6 (engajamento), 7 (eventos + IA), 8 (dados e colaboração), 9 (hardening e operação), 10 (frontend
Svelte 5 + Vite/PWA) e 11 (worker independente) concluídas — versão atual `1.0.0`. Todas as telas do
frontend foram entregues: autenticação, painel, contas, transações, categorias, orçamentos, metas,
hábitos, investimentos e conquistas. Veja o roadmap em [`AGENTS.md`](AGENTS.md#16-roadmap).
