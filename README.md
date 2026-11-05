# Viva Bem

App de finanças pessoais + construção de hábitos, com análise assíncrona por IA. Este repositório é
uma reescrita greenfield, **API-first**, a partir do projeto legado em `reference_only/` (somente
leitura).

- **Plano completo:** [`docs/PLAN.md`](docs/PLAN.md)
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

## Requisitos

- Deno **2.9.8** ou superior
- Docker (opcional, para deploy)

`better-sqlite3` é um addon nativo: as tasks já incluem `--allow-ffi` e `--allow-sys`.

## Quick start

```bash
cp .env.example .env
deno install
deno task dev
```

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

O banco é criado em `./data/app.db` e as migrações rodam no boot.

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
deno task test           # testes
deno task test:coverage  # testes com cobertura
deno task check          # typecheck
deno task lint           # lint
deno task fmt            # formatação
deno task db:migrate     # migrações
deno task db:reset       # apaga e recria o banco
deno task db:backup      # backup em backups/
deno task check:release  # valida versão x changelog
```

Ou use o `Makefile`: `make help`.

## Configuração

Todas as variáveis estão em [`.env.example`](.env.example). Destaques:

| Variável                | Padrão                  | Observação                                   |
| ----------------------- | ----------------------- | -------------------------------------------- |
| `PORT`                  | `3000`                  |                                              |
| `ENV`                   | `development`           | `development`, `test`, `production`          |
| `DATABASE_PATH`         | `./data/app.db`         | Use `/app/data/app.db` no Docker             |
| `APP_ORIGIN`            | `http://localhost:3000` | CORS/CSRF                                    |
| `JWT_SECRET`            | —                       | **Obrigatório em produção** (32+ caracteres) |
| `AI_ENABLED`            | `false`                 | IA é opt-in por usuário                      |
| `AI_PROVIDER`           | `openai`                | `openai` (compatível) ou `ollama`            |
| `VECTOR_EXTENSION_PATH` | —                       | Sobrescreve o binário do `sqlite-vector`     |

Nenhum segredo tem valor padrão em produção. Em dev, um segredo efêmero é gerado no boot (com aviso
no log).

## Docker

```bash
docker build --build-arg VERSION=$(grep -o '"version": *"[^"]*"' deno.json | cut -d'"' -f4) -t vivabem:local .
docker run --rm -p 3000:3000 \
  -v vivabem-data:/app/data \
  -e JWT_SECRET="$(openssl rand -base64 48)" \
  -e APP_ORIGIN="http://localhost:3000" \
  vivabem:local
```

Detalhes de Portainer, backup e restore: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Estrutura

```text
src/
  main.ts          # bootstrap: config → migrações → seed → servidor
  app.ts           # factory do Hono (sem efeitos colaterais)
  config.ts        # env validado com Zod
  version.ts       # versão lida do deno.json
  http/            # erros, OpenAPI, middlewares
  db/              # conexão, migrações, repositórios
  modules/         # domínios (auth, transactions, habits, ...)
  events/          # outbox + worker
  ai/              # providers, prompts, tools, executor, embeddings
  shared/          # logger, crypto, utils
tests/             # unit, integration, e2e
bin/sqlite-vector/ # fallback do binário da extensão vetorial
```

## Versionamento

- [SemVer 2.0.0](https://semver.org/lang/pt-BR/): `MAJOR.MINOR.PATCH`.
- [Keep a Changelog 1.1.0](https://keepachangelog.com/pt-BR/1.1.0/).
- A versão do `deno.json` é a fonte da verdade e aparece em `/health`, no OpenAPI e na label Docker.
- Durante `0.y.z` o contrato ainda pode mudar; `1.0.0` marca o congelamento da API v1.

## Status

Fases 0 (fundação), 1 (identidade), 2 (finanças), 3 (planejamento), 4 (hábitos), 5 (investimentos),
6 (engajamento) e 7 (eventos + IA) concluídas — versão atual `0.8.0`. Próxima: Fase 8 (dados e
colaboração). Veja o roadmap em [`AGENTS.md`](AGENTS.md#16-roadmap).
