# Plano de Reescrita — Viva Bem

- **Status:** aprovado (decisões fechadas)
- **Data:** 2026-11-05
- **Estratégia:** API-first, greenfield, reescrita a partir de `reference_only/`
- **Referência:** `reference_only/` (Deno 2 + Hono 4 + `node:sqlite` + AngularJS + EIE)
- **Repositório alvo:** raiz de `vivaBem`

---

## 1. Contexto e objetivos

O projeto antigo é um app funcional de finanças pessoais + hábitos, com 13 módulos, frontend AngularJS/PWA, motor de conquistas e um Event Intelligence Engine (EIE). Ele carrega dívidas relevantes:

- dinheiro armazenado como `REAL` (erro de ponto flutuante);
- eventos de IA publicados de forma fire-and-forget (podem ser perdidos);
- 95+ avaliadores de conquistas escritos à mão;
- refresh token sem rotação com detecção de reuso;
- ausência de OpenAPI/versionamento de API;
- `getDb()` global, dificultando testes isolados;
- parcelas e metas modeladas de forma que distorcem resumos;
- autenticação caseira (PBKDF2/JWT) e rate limit apenas por IP.

**Objetivo:** reconstruir o produto com uma base limpa, testável, observável e evolutiva, preservando o domínio e a experiência, mas corrigindo as decisões acima.

**Fora do escopo desta fase:** frontend (Svelte 5 + Vite) será planejado e entregue depois da API.

---

## 2. Decisões aprovadas

| Tema | Decisão |
|---|---|
| Runtime | Deno 2.9 + TypeScript strict + `noUncheckedIndexedAccess` |
| HTTP | Hono 4 |
| Validação | Zod 4 |
| Documentação | `@hono/zod-openapi` + `@hono/swagger-ui` (OpenAPI 3.1) |
| Banco | `better-sqlite3` (síncrono) + `@sqliteai/sqlite-vector` |
| Acesso a dados | SQL puro + repositórios tipados (sem ORM) |
| Dinheiro | inteiro em menor unidade (`amountMinor`) + `currencyCode` |
| IDs | UUIDv7 em todas as tabelas |
| Auth | Argon2id + access JWT curto em cookie HttpOnly + refresh opaco rotativo |
| Sessão | cookie `vb_access` (15 min) + `vb_refresh` (30 dias, rotação + detecção de reuso) |
| CSRF | SameSite=Lax + validação de Origin/Sec-Fetch-Site + double-submit |
| API | `/api/v1`, envelope `{ data, meta }` / `{ error }` |
| Parcelas | N transações vinculadas por `installment_group_id` |
| Metas | contribuições explícitas (`goal_contributions`) |
| Conquistas | catálogo de 352 + DSL declarativa de critérios |
| IA | outbox transacional + worker + provider OpenAI-compatible + adapter Ollama |
| Vetores | `sqlite-vector` para busca semântica/RAG |
| Dados antigos | greenfield (sem migração) |
| Frontend | Svelte 5 + Vite (fase posterior) |
| Deploy | Docker multi-stage + Portainer + volume `/app/data` |
| Versionamento | SemVer 2.0.0 |
| Changelog | Keep a Changelog 1.1.0 |

---

## 3. Padrões obrigatórios do projeto

### 3.1 SemVer 2.0.0

O projeto segue [Semantic Versioning 2.0.0](https://semver.org/lang/pt-BR/).

**Formato:** `MAJOR.MINOR.PATCH`

- **MAJOR:** mudanças incompatíveis no contrato público (API, schema do banco, formato de dados exportados).
- **MINOR:** funcionalidades novas compatíveis com versões anteriores.
- **PATCH:** correções compatíveis (bugs, segurança, performance sem mudança de contrato).

**Regras adicionais:**

- Durante o desenvolvimento inicial (`0.y.z`), o contrato pode mudar a qualquer momento. A primeira versão estável será `1.0.0`, quando a API v1 estiver congelada.
- Pré-releases usam `-alpha.N`, `-beta.N`, `-rc.N` (ex.: `1.0.0-rc.1`).
- Metadados de build usam `+` (ex.: `1.2.3+20261105`).
- Tags Git são anotadas e seguem `vX.Y.Z` (ex.: `v0.1.0`), sempre iguais à versão de `deno.json`.
- A versão do pacote **não** é a versão da API. `/api/v1` pode continuar em `1.x.y` do pacote; uma quebra de contrato exige `/api/v2` **e** MAJOR.
- Migrações de banco são forward-only. Mudanças destrutivas usam o padrão expand/contract e exigem MAJOR.
- A versão é exposta em:
  - `deno.json` → `version` (fonte da verdade);
  - `src/version.ts` (leitura tipada do `deno.json`);
  - `GET /health` → `{ version }`;
  - OpenAPI → `info.version`;
  - label Docker `org.opencontainers.image.version`.

**Processo de release (inicialmente manual, depois task):**

1. Atualizar `deno.json` (`version`).
2. Mover `[Unreleased]` do `CHANGELOG.md` para `[X.Y.Z] - AAAA-MM-DD`.
3. Rodar `deno task fmt --check`, `deno task lint`, `deno task check`, `deno task test`.
4. Criar commit `chore(release): vX.Y.Z`.
5. Criar tag anotada `vX.Y.Z` e publicar.
6. Buildar imagem Docker com a mesma tag.

Meta: `deno task release -- patch|minor|major` automatiza 1–5.

### 3.2 Keep a Changelog 1.1.0

O projeto segue [Keep a Changelog 1.1.0](https://keepachangelog.com/pt-BR/1.1.0/).

**Arquivo:** `CHANGELOG.md` na raiz, UTF-8, versões mais recentes primeiro.

**Cabeçalho padrão:**

```markdown
# Changelog

Todas as mudanças notáveis deste projeto são documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).
```

**Estrutura:**

- `## [Unreleased]` sempre presente, mesmo vazio.
- `## [X.Y.Z] - AAAA-MM-DD` para cada release.
- Categorias (títulos em inglês, descrições em português):
  - `### Added`
  - `### Changed`
  - `### Deprecated`
  - `### Removed`
  - `### Fixed`
  - `### Security`
- Links de comparação no rodapé:

```markdown
[Unreleased]: https://github.com/ORG/REPO/compare/vX.Y.Z...HEAD
[X.Y.Z]: https://github.com/ORG/REPO/compare/vX.Y.Z-1...vX.Y.Z
```

**Regras:**

- Toda mudança visível ao usuário entra em `[Unreleased]` no mesmo PR.
- Não listar commits crus; descrever o impacto.
- `CHANGELOG.md` e `deno.json` devem estar sincronizados; CI valida.
- A primeira release será `0.1.0` ao concluir a Fase 0.
- Mudanças internas sem impacto (refactor sem mudança de comportamento) podem ser omitidas ou agrupadas em `Changed`.

### 3.3 Conventional Commits (recomendado, não obrigatório para o changelog)

Formato: `tipo(escopo): descrição`

Tipos: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`, `style`, `revert`.

- `feat` → MINOR (ou MAJOR se `BREAKING CHANGE`).
- `fix` → PATCH.
- `BREAKING CHANGE:` no rodapé → MAJOR.
- O changelog é curado manualmente; o histórico de commits é apoio, não a fonte.

### 3.4 Versionamento da API

- Prefixo `/api/v1`.
- Mudanças compatíveis (novos campos opcionais, novos endpoints) não exigem nova versão.
- Remoção/renomeação/alteração de tipo exige `/api/v2`.
- Período de depreciação: anunciar em `Deprecated`, manter por pelo menos um MINOR e remover no próximo MAJOR.

### 3.5 Definition of Done (por fase)

- `deno fmt --check`, `deno lint`, `deno check` e `deno test` verdes.
- OpenAPI atualizado e válido.
- `CHANGELOG.md` atualizado em `[Unreleased]`.
- Migrações testadas (aplicar duas vezes sem erro).
- Nenhum segredo com valor padrão.
- Toda query escopada por usuário.
- Operações multi-tabela em transação.
- Documentação da fase em `docs/` quando aplicável.

---

## 4. Arquitetura

### 4.1 Princípios

1. **Contrato primeiro:** Zod + OpenAPI definem o contrato antes da implementação.
2. **Sem singleton global de banco:** `createApp({ db, config, logger, ai })` recebe dependências; testes criam DB temporária.
3. **Camadas:** controller (HTTP) → service (regras) → repository (SQL). Controller não conhece SQL; repository não conhece HTTP.
4. **Transações no service:** operações multi-tabela usam `db.transaction(fn)`.
5. **Eventos via outbox:** o evento é gravado na mesma transação da regra de negócio.
6. **Erros tipados:** taxonomia única, sem `throw new Error("...")` genérico.
7. **Config central:** todo `Deno.env` passa por `src/config.ts`, validado no boot.
8. **Observabilidade:** request ID, logs JSON, health/ready, auditoria de ações de IA.

### 4.2 Estrutura de pastas

```text
src/
  main.ts                    # bootstrap: config → migrations → worker → server
  app.ts                     # factory do Hono (sem efeitos colaterais)
  config.ts                  # env validado com Zod
  version.ts                 # versão do deno.json
  http/
    errors.ts                # AppError + taxonomia
    error-handler.ts         # middleware global
    openapi.ts               # documento OpenAPI + Swagger UI
    middleware/
      request-id.ts
      request-logger.ts
      body-limit.ts
      security-headers.ts
      auth.ts
      csrf.ts
      rate-limit.ts
    validation.ts            # helpers de parse Zod
  db/
    client.ts                # conexão, pragmas, extensão, transações
    migrate.ts               # runner com checksum
    migrations/
      001_core.sql
      002_finance.sql
      003_planning.sql
      004_habits.sql
      005_investments.sql
      006_engagement.sql
      007_ai.sql
      008_data.sql
    repositories/
      users.ts
      sessions.ts
      accounts.ts
      categories.ts
      transactions.ts
      ...
  modules/
    auth/                    # controller, service, schemas
    users/
    accounts/
    categories/
    transactions/
    recurring/
    budgets/
    goals/
    habits/
    investments/
    achievements/
    notifications/
    family/
    insights/
    export/
  events/
    publisher.ts             # grava no outbox dentro da transação
    worker.ts                # claim/lease, backoff, dead-letter
    types.ts
  ai/
    providers/
      openai-compatible.ts   # chat + embeddings via fetch
      ollama.ts              # adapter opcional
      index.ts
    context/                 # builders por domínio
    prompts/                 # prompts por domínio
    tools/                   # definições de tools
    registry/
    executor/
    embeddings/              # sqlite-vector + RAG
    correlation/
  shared/
    crypto/
      argon2id.ts
      tokens.ts
    logger/
    utils/
      uuid.ts
      money.ts
      dates.ts
      result.ts
tests/
  helpers/
    db.ts
    app.ts
    auth.ts
  unit/
  integration/
  e2e/
docs/
  API.md
  ARCHITECTURE.md
  DECISIONS.md
  DEPLOY.md
CHANGELOG.md
deno.json
Dockerfile
Makefile
```

---

## 5. Modelo de dados

### 5.1 Convenções

- Dinheiro: `*_minor INTEGER NOT NULL` (centavos) + `currency_code TEXT NOT NULL`.
- IDs: `TEXT PRIMARY KEY` com UUIDv7.
- Timestamps: `TEXT` ISO-8601 UTC (`created_at`, `updated_at`).
- Datas de negócio: `TEXT` `YYYY-MM-DD` (`transaction_date`, `log_date`, `target_date`).
- Booleanos: `INTEGER NOT NULL DEFAULT 0` com `CHECK (col IN (0,1))`.
- Enums: `TEXT` com `CHECK (col IN (...))`.
- Soft delete: `is_active INTEGER NOT NULL DEFAULT 1` ou `deleted_at TEXT`.
- FKs com `ON DELETE RESTRICT` por padrão; `CASCADE` apenas em tabelas dependentes explícitas.
- `PRAGMA foreign_keys = ON`, `journal_mode = WAL`, `busy_timeout = 5000`, `synchronous = NORMAL`.
- Migrações forward-only, com checksum e transação por migração.
- `schema_migrations (version INTEGER PK, name TEXT, checksum TEXT, applied_at TEXT, execution_time_ms INTEGER)`.

### 5.2 Tabelas

#### Identidade

| Tabela | Colunas principais |
|---|---|
| `user_profiles` | `id`, `name`, `avatar_url`, `subscription_tier`, `setup_completed_at`, `created_at`, `updated_at` |
| `user_credentials` | `id`, `user_id` (unique), `email` (unique, normalizado), `password_hash`, `password_algorithm`, `email_verified`, `last_login_at`, `created_at`, `updated_at` |
| `user_preferences` | `user_id` (PK), `timezone`, `base_currency`, `locale`, `updated_at` |
| `user_sessions` | `id`, `user_id`, `refresh_token_hash`, `token_family_id`, `rotated_from`, `ip_address`, `user_agent`, `expires_at`, `created_at`, `last_used_at`, `revoked_at` |
| `auth_events` | `id`, `user_id` (nullable), `email`, `type` (`login_success`, `login_failed`, `refresh`, `logout`, `reuse_detected`), `ip_address`, `user_agent`, `created_at` |

#### Finanças

| Tabela | Colunas principais |
|---|---|
| `accounts` | `id`, `user_id`, `name`, `type` (`checking`, `savings`, `credit_card`, `investment`, `cash`), `currency_code`, `is_active`, `created_at`, `updated_at` |
| `credit_card_details` | `account_id` (PK), `closing_day`, `due_day`, `limit_minor` |
| `categories` | `id`, `user_id`, `parent_id`, `name`, `type` (`income`, `expense`, `transfer`), `color`, `icon`, `is_active`, `created_at`, `updated_at` |
| `transactions` | `id`, `account_id`, `category_id`, `transfer_group_id`, `recurring_transaction_id`, `type` (`income`, `expense`, `transfer`), `amount_minor`, `currency_code`, `description`, `transaction_date`, `is_cleared`, `external_id`, `import_hash`, `created_at`, `updated_at` |
| `credit_card_transactions` | `id`, `transaction_id` (unique), `installment_number`, `total_installments`, `installment_group_id` |
| `recurring_transactions` | `id`, `user_id`, `account_id`, `category_id`, `type`, `amount_minor`, `description`, `frequency` (`daily`, `weekly`, `monthly`, `yearly`), `interval`, `day_of_month`, `start_date`, `end_date`, `next_occurrence`, `is_active`, `created_at`, `updated_at` |
| `recurring_occurrences` | `id`, `recurring_transaction_id`, `occurrence_date`, `transaction_id`, `created_at` (unique `recurring_id + occurrence_date` para idempotência) |

#### Planejamento

| Tabela | Colunas principais |
|---|---|
| `budgets` | `id`, `user_id`, `category_id`, `name`, `limit_minor`, `period_type` (`monthly`, `yearly`, `custom`), `start_date`, `end_date`, `alert_threshold`, `is_active`, `created_at`, `updated_at` |
| `goals` | `id`, `user_id`, `target_account_id`, `name`, `description`, `target_amount_minor`, `currency_code`, `target_date`, `status` (`active`, `paused`, `completed`, `cancelled`), `created_at`, `updated_at` |
| `goal_contributions` | `id`, `goal_id`, `account_id`, `transaction_id`, `amount_minor`, `contribution_date`, `note`, `created_at` |

#### Hábitos

| Tabela | Colunas principais |
|---|---|
| `habits` | `id`, `user_id`, `name`, `description`, `color`, `habit_type` (`good`, `bad`), `frequency_type` (`daily`, `weekly`, `custom`), `days_of_week`, `daily_target`, `target_unit`, `order_index`, `parent_habit_id`, `is_active`, `created_at`, `updated_at` |
| `habit_logs` | `id`, `habit_id`, `log_date`, `value`, `note`, `trigger_id`, `replacement_used`, `deleted_at`, `created_at`, `updated_at` (unique `habit_id + log_date`) |
| `habit_triggers` | `id`, `user_id`, `bad_habit_id`, `replacement_habit_id`, `trigger_description`, `alternative_action`, `deleted_at`, `created_at`, `updated_at` |

#### Investimentos

| Tabela | Colunas principais |
|---|---|
| `investments` | `id`, `user_id`, `ticker`, `name`, `asset_class`, `currency_code`, `deleted_at`, `created_at`, `updated_at` (unique `user_id + ticker` entre ativos vivos) |
| `investment_transactions` | `id`, `investment_id`, `account_id`, `operation_type` (`buy`, `sell`, `dividend`, `fee`), `quantity` (REAL), `unit_price_minor`, `fees_minor`, `operation_date`, `created_at` |
| `investment_quotes` | `id`, `investment_id`, `price_minor`, `quoted_at`, `source`, `created_at` |

#### Engajamento

| Tabela | Colunas principais |
|---|---|
| `achievements` | `id`, `title` (único), `description`, `category` (`finance`, `habit`, `investment`, `system`), `points_reward`, `badge_icon_url`, `criteria_rule`, `criteria_params` (JSON), `target_metric`, `is_hidden`, `created_at` |
| `user_achievements` | `id`, `user_id`, `achievement_id`, `current_progress`, `is_unlocked`, `unlocked_at` (unique `user_id + achievement_id`, coerência entre `is_unlocked` e `unlocked_at`) |
| `notifications` | `id`, `user_id`, `title`, `message`, `category` (`finance`, `habit`, `security`, `system`, `investment`, `family`), `severity` (`low`, `medium`, `high`, `critical`), `link`, `is_read`, `created_at` |

#### Colaboração

| Tabela | Colunas principais |
|---|---|
| `family_links` | `id`, `requester_id`, `addressee_id`, `status` (`pending`, `accepted`, `rejected`, `revoked`), `created_at`, `responded_at` (par único sem ordem via `ux_family_links_pair`) |

#### IA / EIE

| Tabela | Colunas principais |
|---|---|
| `event_outbox` | `id`, `type`, `aggregate_type`, `aggregate_id`, `user_id`, `payload`, `status` (`pending`, `processing`, `completed`, `failed`), `priority`, `attempts`, `available_at`, `locked_at`, `worker_id`, `last_error`, `created_at`, `processed_at` |
| `ai_action_logs` | `id`, `event_id`, `tool`, `arguments`, `confidence`, `executed`, `execution_time_ms`, `error`, `created_at` |
| `ai_insights` | `id`, `user_id`, `category`, `severity`, `title`, `message`, `source_event`, `confidence`, `is_read`, `created_at` |
| `embedding_items` | `id`, `user_id`, `source_type`, `source_id`, `content_hash`, `embedding BLOB`, `model`, `dimensions`, `created_at` (unique `user_id + source_type + source_id`) |
| `ai_feedback` | `id`, `insight_id`, `user_id`, `rating` (`helpful`, `not_helpful`), `comment`, `created_at` |

### 5.3 Índices mínimos

- `transactions(account_id, transaction_date DESC)`
- `transactions(category_id, transaction_date DESC)`
- `transactions(transfer_group_id)`
- `transactions(recurring_transaction_id)`
- `transactions(user_id via accounts)` — usar JOIN indexado por `accounts(user_id, is_active)`
- `accounts(user_id, is_active)`
- `categories(user_id, parent_id, is_active)`
- `habit_logs(habit_id, log_date)` (unique)
- `budgets(user_id, category_id, start_date)`
- `goals(user_id, status)`
- `goal_contributions(goal_id, contribution_date)`
- `notifications(user_id, is_read, created_at DESC)`
- `achievements(criteria_rule)`
- `user_achievements(user_id, is_unlocked, unlocked_at DESC)`
- `ai_insights(user_id, is_read, created_at DESC)`
- `event_outbox(status, available_at, priority DESC)`
- `user_sessions(refresh_token_hash)` (unique), `user_sessions(user_id, expires_at)`
- `auth_events(email, created_at)`, `auth_events(ip_address, created_at)`
- `family_links(requester_id)`, `family_links(addressee_id)`
- `ux_family_links_pair` em `min(requester_id, addressee_id), max(requester_id, addressee_id)`
- `ux_transactions_import_hash` em `(account_id, import_hash)` parcial, apenas linhas vivas com hash
- `embedding_items(user_id, source_type, source_id)` (unique)

### 5.4 Correções em relação à referência

| Problema antigo | Correção |
|---|---|
| `REAL` para dinheiro | `INTEGER` em minor units |
| Parcela só como metadata | N transações com `installment_group_id` |
| Meta = saldo da conta | `goal_contributions` explícitas |
| Recorrência pode duplicar no boot | `recurring_occurrences` única por data |
| Eventos fire-and-forget | outbox transacional |
| `getDb()` global | injeção de dependência |
| Sessão sem detecção de reuso | `token_family_id` + `rotated_from` + revogação da família |
| 95 evaluators bespoke | DSL declarativa + catálogo |
| Sem versionamento de API | `/api/v1` + OpenAPI |
| Rate limit só por IP | por IP + e-mail/usuário |
| Sem auditoria de auth | `auth_events` |

---

## 6. Contrato da API

### 6.1 Convenções

- Base: `/api/v1`.
- Health: `GET /health`, `GET /ready` (fora da versão).
- OpenAPI: `GET /api/v1/openapi.json`; Swagger UI: `GET /api/docs`.
- `Content-Type: application/json`.
- Request ID: header `X-Request-Id` (gerado se ausente).
- Paginação: `?limit=50&offset=0` (máx. 100), `meta: { limit, offset, hasMore }`.
- Ordenação explícita por endpoint (ex.: `transaction_date DESC, id DESC`).
- Filtros por query string validadas com Zod.

### 6.2 Sucesso

```json
{
  "data": { "id": "...", "amountMinor": 12345, "currencyCode": "BRL" },
  "meta": { "limit": 50, "offset": 0, "hasMore": false }
}
```

### 6.3 Erro

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dados inválidos",
    "details": [{ "path": "amountMinor", "message": "Deve ser um inteiro positivo" }],
    "requestId": "019..."
  }
}
```

Códigos: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `AI_DISABLED`, `INTERNAL_ERROR`.

### 6.4 Autenticação

- `POST /api/v1/auth/register` → cria usuário, preferências e sessão; define cookies.
- `POST /api/v1/auth/login` → verifica Argon2id; define cookies.
- `POST /api/v1/auth/refresh` → valida refresh, rotaciona, define novos cookies.
- `POST /api/v1/auth/logout` → revoga a sessão e limpa cookies.
- `GET /api/v1/me` → perfil + preferências + estatísticas.
- `PATCH /api/v1/me`, `PATCH /api/v1/me/preferences`.
- `GET /api/v1/me/sessions`, `DELETE /api/v1/me/sessions/:id`.

**Cookies:**

| Cookie | Conteúdo | Flags | TTL |
|---|---|---|---|
| `vb_access` | JWT HS256 (`sub`, `sid`, `iat`, `exp`) | HttpOnly, Secure (prod), SameSite=Lax, Path=/ | 15 min |
| `vb_refresh` | token opaco 32 bytes base64url | HttpOnly, Secure (prod), SameSite=Lax, Path=/api/v1/auth | 30 dias |
| `vb_csrf` | token aleatório | SameSite=Lax, legível pelo JS | sessão |

- Refresh é de uso único; reuso de token revogado invalida a família inteira e registra `auth_events.type = reuse_detected`.
- Rotação: cada refresh gera novo `vb_refresh` e invalida o anterior.
- Logout revoga a sessão e limpa cookies.
- Limpeza periódica de sessões expiradas.

### 6.5 Segurança HTTP

- `SameSite=Lax` + verificação de `Origin`/`Sec-Fetch-Site` em métodos mutáveis.
- Double-submit CSRF (`vb_csrf` + header `X-CSRF-Token`).
- CORS restrito a `APP_ORIGIN`; `credentials: true`.
- Limite de body: 1 MB.
- Security headers: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`/`frame-ancestors`, HSTS em produção, CSP para o frontend.
- Rate limit: janela deslizante em memória por IP e por e-mail/usuário; endpoints de auth mais rígidos (5/min).
- Argon2id: parâmetros configuráveis; hash com algoritmo/parâmetros embutidos.
- Respostas de login não revelam se o e-mail existe (usar hash dummy para e-mails desconhecidos).

### 6.6 Endpoints por módulo

| Módulo | Endpoints principais |
|---|---|
| Auth | `POST /auth/register`, `/login`, `/refresh`, `/logout` |
| Users | `GET/PATCH /me`, `GET/PATCH /me/preferences`, `GET /me/sessions`, `DELETE /me/sessions/:id` |
| Accounts | `GET/POST /accounts`, `GET/PATCH/DELETE /accounts/:id`, `GET /accounts/:id/transactions`, `GET /accounts/:id/balance` |
| Categories | `GET/POST /categories`, `GET /categories/tree`, `GET/PATCH/DELETE /categories/:id` |
| Transactions | `GET/POST /transactions`, `GET/PATCH/DELETE /transactions/:id`, `GET /transactions/summary`, `POST /transactions/transfer`, `POST /transactions/:id/clear` |
| Recurring | `GET/POST /recurring`, `GET/PATCH/DELETE /recurring/:id`, `GET /recurring/upcoming`, `POST /recurring/:id/run-now` |
| Budgets | `GET/POST /budgets`, `GET/PATCH/DELETE /budgets/:id`, `GET /budgets/status` |
| Goals | `GET/POST /goals`, `GET/PATCH/DELETE /goals/:id`, `GET /goals/:id/progress`, `POST /goals/:id/contributions`, `DELETE /goals/:id/contributions/:contributionId` |
| Habits | `GET/POST /habits`, `GET/PATCH/DELETE /habits/:id`, `POST /habits/:id/logs`, `GET /habits/:id/logs`, `DELETE /habits/:id/logs/:logId`, `GET /habits/:id/streak`, `GET /habits/:id/calendar`, `POST /habits/:id/reorder`, `GET/POST /habit-triggers`, `PATCH/DELETE /habit-triggers/:id` |
| Investments | `GET/POST /investments`, `GET/PATCH/DELETE /investments/:id`, `GET/POST /investments/:id/transactions`, `GET/POST /investments/:id/quotes`, `GET /investments/portfolio`, `GET /investments/:id/performance` |
| Achievements | `GET /achievements`, `GET /achievements/me`, `GET /achievements/me/progress` |
| Notifications | `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `POST /notifications/read-all` |
| Family | `POST /family/invite`, `GET /family`, `POST /family/:id/accept`, `POST /family/:id/reject`, `DELETE /family/:id`, `GET /family/summary` |
| Insights | `GET /insights`, `GET /insights/unread-count`, `GET /insights/search?q=`, `PATCH /insights/:id/read`, `POST /insights/read-all`, `POST /insights/:id/feedback` |
| Export | `GET /export?format=csv\|json` (Fase 8) |
| Import | `POST /import/preview`, `POST /import/commit` (multipart CSV/OFX; Fase 8) |

> Importação, exportação e família foram implementadas na `0.9.0` (Fase 8). A
> importação usa `accountId` + `file` em `multipart/form-data`; o resumo
> familiar é agregado e nunca expõe transações individuais do parceiro.

---

## 7. IA / EIE

> Implementado na `0.8.0` (Fase 7).

### 7.1 Fluxo

```text
Service write (transação)
  ├─ regra de negócio
  └─ INSERT event_outbox
        │
        ▼
Worker (claim/lease)
  ├─ context builder (SQL)
  ├─ provider (chat/embeddings)
  ├─ validação Zod do JSON
  ├─ tool registry + executor
  ├─ ai_action_logs
  └─ ai_insights / notifications
```

### 7.2 Outbox e worker

- `event_outbox` gravado na mesma transação do domínio.
- Claim atômico com um único `UPDATE ... RETURNING`, que também incrementa
  `attempts`; o evento só é elegível quando `available_at <= now`.
- Lease com `locked_at`/`worker_id`; recuperação de eventos travados antes de
  cada ciclo.
- Backoff exponencial (5s, 10s, 20s… até 5 min); dead-letter após
  `AI_MAX_RETRIES`.
- Idempotência por `event.id`; tools também deduplicam argumentos e respeitam
  cooldown.
- Worker single-instance no mesmo processo; `AI_ENABLED=false` desliga tudo sem quebrar a API.

### 7.3 Provider

- OpenAI-compatible via `fetch`:
  - `POST {AI_API_BASE_URL}/chat/completions`
  - `POST {AI_API_BASE_URL}/embeddings`
- Config: `AI_API_BASE_URL`, `AI_API_KEY`, `AI_API_MODEL_CHAT_NAME`, `AI_API_MODEL_EMBEDDINGS_NAME`, `AI_EMBEDDING_DIMENSIONS`.
- Adapter Ollama opcional (`AI_OLLAMA_URL`, `AI_MODEL`), escolhido por `AI_PROVIDER`.
- Timeout com `AbortController`; retry é responsabilidade do worker, que aplica
  backoff exponencial.
- Parser robusto: remove ` thinking`, markdown, prosa; extrai o primeiro objeto JSON; valida com Zod.
- `response_format: { type: "json_object" }` quando suportado.

### 7.4 Contexto, prompts e tools

- Context builders: finance, habit, investment, security, family, correlation, recurring.
- Métricas calculadas em SQL; o LLM nunca consulta o banco.
- Prompts por domínio; resposta sempre JSON:
  ```json
  {
    "confidence": 0.96,
    "analysis": { "risk": "low", "summary": "..." },
    "tool_calls": [{ "name": "notify_user", "arguments": { } }]
  }
  ```
- Tool registry tipado: `name`, `description`, `category`, `risk`, `parameters` (Zod), `executor`.
- Executor valida parâmetros, autorização, cooldown, duplicidade e confiança mínima; audita em `ai_action_logs`.
- Tools iniciais: segurança (`block_ip`, `notify_admin`, `invalidate_session`), finanças (`notify_user`, `flag_budget_attention`, `suggest_category`, `create_financial_insight`), hábitos (`create_habit_suggestion`, `recommend_goal`, `create_motivation`), investimentos (`create_market_note`, `recommend_review`) e correlação (`create_correlation_insight`, `notify_correlation`).
- Nenhuma tool executa SQL arbitrário; tools só escrevem insights/notificações/flags. O executor aceita retorno síncrono ou `Promise`.

### 7.5 Embeddings e RAG

- Tabela `embedding_items` com `embedding BLOB`.
- `SELECT vector_init('embedding_items', 'embedding', 'dimension=<N>,type=FLOAT32,distance=cosine,normalized=1')` em cada conexão.
- Embedar transações (descrição), hábitos (nome/notas), insights e metas.
- Geração assíncrona via evento (`embedding.requested`) para não bloquear a API.
- Busca: `vector_full_scan` com filtro por `user_id`; fallback textual quando
  ainda não há embedding.
- Usos: busca semântica em insights/transações, detecção de assinaturas duplicadas, contexto para o LLM.
- Modelo/dimensões versionados em `embedding_items`; troca de modelo exige reindexação.

### 7.6 Correlação

- Métricas cruzadas em SQL (ex.: queda de hábito "cozinhar" × aumento de delivery).
- Disparo por threshold de eventos processados ou agendamento.
- LLM apenas resume/gera insight; não calcula métricas.

### 7.7 Privacidade

- IA opt-in por usuário; `AI_ENABLED=false` por padrão em produção.
- Redação de PII antes de enviar ao provider externo.
- Auditoria de tudo que foi enviado/executado.
- Modo offline (Ollama) sem envio externo.

---

## 8. Roadmap

| Fase | Entrega | Estimativa | Aceite resumido |
|---|---|---|---|
| 0 | Fundação: config, logger, erros, DB, migrações, testes, CI, Docker, OpenAPI base, health | 2–3 dias | `fmt/lint/check/test` verdes; `/health` e OpenAPI; Docker com volume |
| 1 | Identidade: Argon2id, sessões/cookies/rotação, CSRF, rate limit, `/me`, preferências, `auth_events` | 3–4 dias | fluxo completo de auth; reuso de refresh detectado; testes |
| 2 | Finanças: contas/cartão, categorias, transações/transferências/parcelas, resumos, saldos | 5–7 dias | transferência atômica; parcelas no mês certo; resumos sem float |
| 3 | Planejamento: recorrências, orçamentos + alertas, metas + contribuições | 3–4 dias | recorrência idempotente; thresholds 80/90/100; progresso por contribuição |
| 4 | Hábitos: CRUD, logs, streaks, calendário, triggers, stacking | 3–4 dias | streak correto em DST/virada de mês; log único por dia |
| 5 | Investimentos: ativos, operações, posições, custo médio, performance | 2–3 dias | posições e P&L conferem; autorização |
| 6 | Engajamento: catálogo + DSL de critérios, notificações | 2–3 dias | unlock idempotente; notificações escopadas |
| 7 | Eventos + IA: outbox, worker, provider, prompts, tools/executor, insights, embeddings, correlação | 5–7 dias | zero latência na API; eventos não perdidos; JSON inválido gera retry |
| 8 | Dados e colaboração: import CSV/OFX com dedupe, export, family links | 3–4 dias | import com preview/erros; export completo; acesso familiar escopado |
| 9 | Hardening: segurança, E2E, cobertura, índices, backups, docs, deploy | 3–4 dias | CI verde; E2E; deploy one-command |

**Total da API: ~31–43 dias.** Frontend Svelte 5 + Vite/PWA: ~15–20 dias (plano separado).

Fases 0 a 8 concluídas e publicadas de `0.1.0` a `0.9.0`. A Fase 9 (hardening)
é a próxima.

---

## 9. Fase 0 — detalhamento

### 9.1 Higiene do repositório

- Commit inicial do scaffold atual.
- `deno.json`:
  - imports: `@hono/hono`, `@hono/zod-openapi`, `@hono/swagger-ui`, `zod@4`, `@rabbit-company/argon2id`, `@std/assert`, `@std/testing`, `better-sqlite3`, `@sqliteai/sqlite-vector`;
  - `compilerOptions.strict` + `noUncheckedIndexedAccess`;
  - `nodeModulesDir` para pacotes nativos;
  - tasks `dev`, `start`, `test`, `check`, `lint`, `fmt`, `db:migrate`, `db:seed`, `db:reset`.
- `.env.example` com todas as variáveis (sem segredos reais).
- `.gitignore`: `build/`, `coverage/`, `*.db`, `*.db-wal`, `*.db-shm`, `node_modules`, `.env`.
- `README.md` com quick start.
- Corrigir `src/shared/helpers/argon2id.ts` e o import quebrado de `tests/argon2id.test.ts`.
- Remover `verbose: console.log` de `src/db/client.ts`.

### 9.2 Núcleo

- `src/config.ts`: schema Zod das envs; falha no boot se inválido.
- `src/version.ts`: lê `deno.json`.
- `src/shared/logger/index.ts`: JSON lines (`level`, `time`, `requestId`, `userId`, `method`, `path`, `status`, `durationMs`, `event`).
- `src/http/errors.ts`: `AppError` + códigos.
- `src/http/error-handler.ts`: resposta padronizada + log.
- Middlewares: `request-id`, `request-logger`, `body-limit`, `security-headers`.
- `src/db/client.ts`: factory `createDatabase(path)`; pragmas; `loadExtension(getExtensionPath())`; `vector_init`; `transaction(fn)`; `close()`.
- `src/db/migrate.ts` + `src/db/migrations/001_core.sql` (schema_migrations + identidade).
- `src/app.ts`: `createApp({ db, config, logger })`; `/health`; `/ready`; OpenAPI; Swagger; 404/erro.
- `src/main.ts`: bootstrap + shutdown gracioso (`SIGINT`/`SIGTERM`).

### 9.3 Testes, CI e deploy

- `tests/helpers/db.ts`: DB temporária por teste (in-memory ou arquivo em `Deno.makeTempDir`).
- `tests/helpers/app.ts`: `app.request` com cookies.
- Testes: conexão/pragmas, migração idempotente, health, OpenAPI válido.
- `.github/workflows/ci.yml`: `fmt --check`, `lint`, `check`, `test`.
- `Dockerfile` multi-stage (Deno + `deno install --allow-scripts=better-sqlite3` se necessário), non-root, healthcheck, volume `/app/data`.
- `Makefile`: `dev`, `start`, `test`, `migrate`, `seed`, `clean`, `deploy`.
- `CHANGELOG.md` inicial com `[Unreleased]`.
- `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/DEPLOY.md`.

### 9.4 Spikes obrigatórios

1. `better-sqlite3` + `sqlite-vector` buildando e carregando no Docker.
2. Argon2id no Deno sem Worker (medir tempo).
3. Isolamento de DB entre testes em paralelo.

### 9.5 Aceite

- `deno fmt --check`, `deno lint`, `deno check`, `deno test` verdes.
- `deno task dev` sobe; `/health` 200; `/api/v1/openapi.json` 200.
- `docker build` + `docker run`; volume persiste o SQLite.
- Migração roda duas vezes sem erro.
- `CHANGELOG.md` e `deno.json` sincronizados (versão `0.1.0`).

---

## 10. Fase 1 — detalhamento

- Migração `001_core.sql` (ou `002_identity.sql`): tabelas de identidade.
- `shared/crypto/argon2id.ts`: hash/verify com parâmetros configuráveis.
- `shared/crypto/tokens.ts`: geração de token opaco (32 bytes base64url), SHA-256, comparação constante.
- Repositórios: users, credentials, preferences, sessions, auth_events.
- Services: register, login, refresh (rotação + reuso), logout, getMe, updateMe, preferences.
- Middlewares: auth (cookie JWT), csrf, rate-limit.
- Controllers + schemas Zod + OpenAPI.
- Cookies: `vb_access`, `vb_refresh`, `vb_csrf`; flags por ambiente.
- Testes: register/login/refresh/logout; rotação; reuso revoga família; access expirado; CSRF; rate limit; validação; e-mail duplicado; timing de e-mail inexistente.

---

## 11. Testes

- **Unitários:** dinheiro, datas, UUID, tokens, validação, regras de streak/budget.
- **Integração:** repositórios + services com DB temporária; migrações.
- **HTTP:** `app.request` com cookies; auth, CSRF, rate limit, erros.
- **IA:** provider fake determinístico; outbox, worker, retry, dead-letter, executor, context, embeddings.
- **E2E:** boot do servidor em porta aleatória; register → login → conta → transação → resumo → logout.
- **Tempo:** `@std/testing/time` para recorrência/streak/DST.
- **Cobertura:** `deno test --coverage`; relatório no CI (sem threshold rígido no início).

---

## 12. Observabilidade e operação

- Logs JSON com request ID, usuário, rota, status e duração; redação de campos sensíveis.
- `/health` (liveness) e `/ready` (DB + migrações + worker).
- Auditoria: `auth_events`, `ai_action_logs`.
- Backup: `VACUUM INTO` ou `sqlite3 .backup`; script `deno task db:backup`.
- Restore documentado.
- Shutdown gracioso: parar worker, fechar DB, checkpoint WAL.
- Limpeza periódica: sessões expiradas, eventos concluídos antigos, embeddings órfãos.

---

## 13. Riscos

| Risco | Mitigação |
|---|---|
| `better-sqlite3`/`sqlite-vector` no Docker | spike na Fase 0; prebuild/`--allow-scripts`; fallback `node:sqlite` se necessário |
| Argon2id WASM lento | benchmark; parâmetros ajustáveis; cache de verificação? (não) |
| JSON inválido do LLM | parser robusto + Zod + retry + dead-letter |
| Datas/DST | UTC no banco + `Intl`/`@std/testing/time` + testes de borda |
| Dados financeiros em API externa | opt-in, redação, modo offline, auditoria |
| SQLite single-instance | adequado ao Portainer; documentar limite; migração futura para Postgres se necessário |
| Multi-moeda sem FX | documentar que resumos não convertem moedas; FX fica para depois |
| Escopo grande | fases verticais, DoD por fase, releases `0.x` |

---

## 14. Fora de escopo (registrado)

- Frontend Svelte 5/PWA (plano separado após a API).
- Conversão cambial.
- Verificação de e-mail e reset de senha (podem entrar na Fase 1 se priorizado).
- Import CSV/OFX real (Fase 8; precisa de arquivos de exemplo).
- Escala horizontal/multi-instância.
- App mobile nativo.

---

## 15. Anexos

### 15.1 Variáveis de ambiente

| Variável | Default | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `ENV` | `development` | `development`, `test`, `production` |
| `DATABASE_PATH` | `./data/app.db` | Caminho do SQLite |
| `APP_ORIGIN` | `http://localhost:3000` | Origem permitida (CORS/CSRF) |
| `COOKIE_SECURE` | `false` em dev | Cookies `Secure` |
| `ACCESS_TOKEN_TTL` | `15m` | TTL do access JWT |
| `REFRESH_TOKEN_TTL` | `30d` | TTL do refresh |
| `ARGON2_MEMORY_KIB` | `65536` | Memória do Argon2id |
| `ARGON2_ITERATIONS` | `3` | Iterações |
| `ARGON2_PARALLELISM` | `4` | Paralelismo |
| `LOG_LEVEL` | `info` | Nível de log |
| `AI_ENABLED` | `false` | Liga o worker/EIE |
| `AI_API_BASE_URL` | — | Base OpenAI-compatible |
| `AI_API_KEY` | — | Chave (opcional em local) |
| `AI_API_MODEL_CHAT_NAME` | — | Modelo de chat |
| `AI_API_MODEL_EMBEDDINGS_NAME` | — | Modelo de embeddings |
| `AI_EMBEDDING_DIMENSIONS` | — | Dimensão dos vetores |
| `AI_WORKER_INTERVAL` | `5000` | Intervalo do worker (ms) |
| `AI_MAX_RETRIES` | `3` | Tentativas |
| `AI_CONFIDENCE_THRESHOLD` | `0.7` | Confiança mínima |
| `AI_MAX_EVENTS_PER_BATCH` | `10` | Eventos por ciclo |
| `AI_CORRELATION_THRESHOLD` | `50` | Eventos para correlação |
| `AI_OLLAMA_URL` | `http://localhost:11434` | Adapter Ollama (opcional) |
| `AI_MODEL` | — | Modelo Ollama (opcional) |

### 15.2 Comandos previstos

```bash
deno task dev            # servidor com watch
deno task start          # produção
deno task test           # testes
deno task check          # typecheck
deno task lint           # lint
deno task fmt            # formatação
deno task db:migrate     # migrações
deno task db:seed        # dados demo
deno task db:reset       # apaga e recria
deno task db:backup      # backup
deno task release -- patch|minor|major
```

### 15.3 Primeira release

- Versão: `0.1.0` ao concluir a Fase 0.
- `CHANGELOG.md` com `[0.1.0] - AAAA-MM-DD`.
- Tag `v0.1.0`.
- `1.0.0` quando a API v1 estiver congelada e estável.

---

## 16. Próximo passo

Iniciar a **Fase 9** (hardening): segurança, E2E, cobertura, índices, backups,
documentação e deploy.
