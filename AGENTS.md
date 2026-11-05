# AGENTS.md — Viva Bem

Guia para agentes de IA e contribuidores. Leia este arquivo **antes** de alterar qualquer coisa.

- **Plano canônico:** [`docs/PLAN.md`](docs/PLAN.md)
- **Referência legada:** `reference_only/` — **somente leitura**, nunca editar
- **Status:** reescrita greenfield, API-first; Fase 0 (fundação) concluída, versão `0.1.0`

---

## 1. Visão do projeto

Viva Bem é um app de finanças pessoais + construção de hábitos, com análise assíncrona por IA (Event Intelligence Engine). Estamos reescrevendo o projeto antigo do zero, preservando o domínio e a experiência, mas corrigindo as dívidas técnicas:

- dinheiro em `REAL` → agora inteiro em minor units;
- eventos de IA fire-and-forget → agora outbox transacional;
- `getDb()` global → agora injeção de dependência;
- refresh sem rotação → agora rotação com detecção de reuso;
- 95+ avaliadores de conquistas bespoke → agora DSL declarativa;
- sem OpenAPI/versionamento → agora `/api/v1` + OpenAPI 3.1.

**Estratégia:** API primeiro. O frontend (Svelte 5 + Vite/PWA) será feito depois da API.

---

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Deno 2.9+ |
| Linguagem | TypeScript strict + `noUncheckedIndexedAccess` |
| HTTP | Hono 4 |
| Validação | Zod 4 |
| OpenAPI | `@hono/zod-openapi` + `@hono/swagger-ui` |
| Banco | `better-sqlite3` (síncrono) + `@sqliteai/sqlite-vector` |
| Auth | Argon2id + access JWT em cookie HttpOnly + refresh opaco rotativo |
| Logs | logger JSON próprio |
| Testes | `Deno.test` + `@std/assert` + `@std/testing/time` |
| Deploy | Docker multi-stage + Portainer |

**Não adicione dependências sem justificar.** Prefira a biblioteca padrão do Deno e `fetch` nativo.

---

## 3. Estado atual do repositório

A Fase 0 está concluída (`0.1.0`). O que existe hoje:

| Item | Estado |
|---|---|
| `src/config.ts` | env validado com Zod; única leitora de `Deno.env` |
| `src/shared/logger/` | logger JSON com redação de dados sensíveis |
| `src/http/` | `AppError`, handler de erros, OpenAPI, middlewares |
| `src/db/client.ts` | conexão SQLite + extensão vetorial + transações |
| `src/db/migrate.ts` | runner forward-only com checksum |
| `src/db/migrations/001_core.sql` | tabelas de identidade |
| `src/app.ts` | factory do Hono (sem efeitos colaterais) |
| `src/main.ts` | bootstrap: config → migrações → servidor |
| `tests/` | unitários e integração com SQLite real |
| `bin/sqlite-vector/` | binários de fallback (Linux x86_64/arm64) |
| `docs/erDiagram.mmd` | ERD de referência para o novo schema |
| `docs/PLAN.md` | plano completo aprovado |
| `CHANGELOG.md` | Keep a Changelog, com `[Unreleased]` e `[0.1.0]` |
| Docker/CI | `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml` |

**Permissões do Deno:** `better-sqlite3` é um addon nativo e exige `--allow-ffi`; ele também consulta `process.report`/CPUs e exige `--allow-sys`. As tasks do `deno.json` já encapsulam as permissões necessárias. Nunca use `--allow-all`.

---

## 4. Comandos

### 4.1 Comandos disponíveis

```bash
deno task dev            # servidor com watch (carrega .env se existir)
deno task start          # servidor
deno task test           # suíte completa (tests/)
deno task test:coverage  # testes com cobertura
deno task check          # typecheck de src, tests e scripts
deno task lint           # lint
deno task fmt            # formatação
deno task fmt:check      # verifica formatação
deno task db:migrate     # aplica migrações pendentes
deno task db:reset       # apaga e recria o banco
deno task db:backup      # backup em backups/
deno task check:release  # valida versão x CHANGELOG
```

### 4.2 Alvo para as próximas fases

```bash
deno task db:seed        # dados demo (Fase 2)
deno task release -- patch|minor|major
```

**Regra:** todo comando de dev/teste deve rodar sem privilégios além dos necessários. Nunca use `--allow-all` em produção.

---

## 5. Arquitetura

### 5.1 Camadas

```text
HTTP (Hono)
  └─ controller  → validação Zod, OpenAPI, cookies, status HTTP
       └─ service → regras de negócio, transações, eventos
            └─ repository → SQL preparado, mapeamento snake_case ↔ camelCase
```

- **Controller** não conhece SQL.
- **Service** não conhece `Request`/`Response`.
- **Repository** não conhece HTTP.
- **Nunca** crie um singleton global de banco (`getDb()`). O banco é injetado:

```ts
const app = createApp({ db, config, logger, ai });
```

- Operações multi-tabela usam `db.transaction(fn)`.
- Eventos de domínio são gravados no **outbox dentro da mesma transação**.

### 5.2 Estrutura de pastas

```text
src/
  main.ts              # bootstrap: config → migrations → worker → server
  app.ts               # factory do Hono (testável)
  config.ts            # env validado com Zod
  version.ts           # versão do deno.json
  http/                # erros, OpenAPI, middlewares
  db/                  # client, migrate, migrations, repositories
  modules/             # auth, users, accounts, categories, transactions,
                       # recurring, budgets, goals, habits, investments,
                       # achievements, notifications, family, insights, export
  events/              # publisher (outbox) + worker
  ai/                  # providers, context, prompts, tools, registry,
                       # executor, embeddings, correlation
  shared/              # crypto, logger, utils
tests/
  helpers/ unit/ integration/ e2e/
docs/
  PLAN.md API.md ARCHITECTURE.md DECISIONS.md DEPLOY.md
```

### 5.3 Módulo padrão

```text
src/modules/<dominio>/
  <dominio>.controller.ts
  <dominio>.service.ts
  <dominio>.repository.ts
  <dominio>.schemas.ts
```

---

## 6. Convenções de código

- TypeScript **strict**; proibido `any` implícito. Prefira `unknown` + validação.
- Use `import type` para tipos.
- Exportações nomeadas; evite `export default` (exceto onde a ferramenta exigir).
- Nomes de arquivos e variáveis em **inglês**; comentários e documentação em **português**.
- Banco em `snake_case`; TypeScript em `camelCase`; converta no repositório.
- Erros: use `AppError` com código; **nunca** `throw new Error("texto")` genérico.
- Config: **nunca** `Deno.env.get()` fora de `src/config.ts`.
- Logs: use o logger injetado; **nunca** `console.log` em código de aplicação.
- Dinheiro: **sempre** `amountMinor: number` inteiro + `currencyCode`; nunca `float`.
- Datas: timestamps UTC ISO-8601; datas de negócio `YYYY-MM-DD`.
- IDs: **UUIDv7** em todas as tabelas.
- Validação: Zod na borda; tipos inferidos dos schemas.
- SQL: apenas prepared statements; nunca interpole entrada de usuário.
- Comentários: explique **por quê**, não **o quê**.

---

## 7. Banco de dados

### 7.1 Convenções

| Item | Regra |
|---|---|
| Dinheiro | `*_minor INTEGER NOT NULL` + `currency_code TEXT NOT NULL` |
| IDs | `TEXT PRIMARY KEY` com UUIDv7 |
| Timestamps | `TEXT` ISO-8601 UTC |
| Datas de negócio | `TEXT` `YYYY-MM-DD` |
| Booleanos | `INTEGER NOT NULL DEFAULT 0` + `CHECK (col IN (0,1))` |
| Enums | `TEXT` + `CHECK (col IN (...))` |
| Soft delete | `is_active` ou `deleted_at`; nunca apagar dados do usuário |
| FKs | `ON DELETE RESTRICT` por padrão |
| Pragmas | `foreign_keys=ON`, `journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL` |

### 7.2 Migrações

- Arquivos SQL numerados em `src/db/migrations/` (`001_core.sql`, `002_finance.sql`, ...).
- Runner com checksum e transação por migração.
- **Forward-only.** Mudanças destrutivas usam expand/contract e exigem MAJOR.
- Rodar duas vezes deve ser idempotente.
- Nunca altere uma migração já aplicada; crie uma nova.

### 7.3 Regras de acesso

- Toda query de dados de usuário deve ser escopada por `user_id` (direto ou via `accounts`).
- Nunca confie em `userId` vindo do cliente; use o da sessão.
- Operações multi-tabela em transação.
- Paginação máxima de 100.

---

## 8. API

### 8.1 Contrato

- Base: `/api/v1`; health em `/health` e `/ready`.
- OpenAPI: `/api/v1/openapi.json`; Swagger UI: `/api/docs`.
- Sucesso: `{ "data": ..., "meta": ... }`.
- Erro: `{ "error": { "code", "message", "details", "requestId" } }`.
- Códigos: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `AI_DISABLED`, `INTERNAL_ERROR`.
- Paginação: `?limit=50&offset=0` (máx. 100) + `meta.hasMore`.
- Request ID: `X-Request-Id` (gerado se ausente).
- Toda rota nova **deve** entrar no OpenAPI.

### 8.2 Auth

- `vb_access`: JWT HS256, HttpOnly, Secure em produção, SameSite=Lax, Path=/, 15 min.
- `vb_refresh`: token opaco 32 bytes, HttpOnly, SameSite=Lax, Path=/api/v1/auth, 30 dias.
- `vb_csrf`: token legível pelo JS para double-submit.
- Refresh é de uso único; reuso revoga a família inteira e registra `auth_events`.
- Logout revoga a sessão e limpa cookies.
- Nunca retorne tokens no corpo JSON em fluxos de cookie.
- Login não deve revelar se o e-mail existe (hash dummy para e-mails desconhecidos).

### 8.3 Segurança HTTP

- CSRF: SameSite=Lax + `Origin`/`Sec-Fetch-Site` + `X-CSRF-Token`.
- CORS restrito a `APP_ORIGIN` com `credentials: true`.
- Body limit: 1 MB.
- Rate limit por IP **e** por e-mail/usuário; auth mais rígido (5/min).
- Security headers obrigatórios; CSP quando o frontend entrar.
- Argon2id com parâmetros configuráveis.

---

## 9. Eventos e IA (EIE)

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

Regras:

- **Nunca** publique evento fora do outbox. O evento nasce na mesma transação da regra.
- Worker com claim atômico, lease, backoff, recuperação de travados e dead-letter.
- Provider OpenAI-compatible via `fetch`; adapter Ollama opcional.
- Parser robusto: remove ` thinking`/prosa, extrai JSON, valida com Zod, faz retry.
- Context builders calculam métricas em SQL; **o LLM nunca consulta o banco**.
- O LLM **não executa SQL** nem regras de negócio; só sugere tool calls.
- Executor valida parâmetros, autorização, cooldown, duplicidade e confiança; audita tudo.
- `AI_ENABLED=false` por padrão em produção; IA é opt-in por usuário.
- Redija PII antes de enviar a provider externo.
- Embeddings em `embedding_items` com `vector_init` por conexão; gere de forma assíncrona.

---

## 10. Conquistas (achievements)

- Catálogo de 352 conquistas portado para seed.
- Critérios em **DSL declarativa**: `COUNT`, `SUM`, `STREAK`, `DISTINCT`, `EXISTS`, `THRESHOLD`.
- Avaliação síncrona após o commit da regra de negócio, com SQL eficiente.
- Unlock **idempotente** (unique `user_id + achievement_id`).
- Não crie um evaluator novo sem antes verificar se a DSL cobre o caso.

---

## 11. Versionamento e changelog

### 11.1 SemVer 2.0.0

- Formato `MAJOR.MINOR.PATCH`.
- `0.y.z` durante desenvolvimento inicial; `1.0.0` quando a API v1 estiver congelada.
- Tags Git `vX.Y.Z`, iguais à versão do `deno.json`.
- Versão exposta em `deno.json`, `src/version.ts`, `/health`, OpenAPI e label Docker.
- Versão do pacote ≠ versão da API: quebra de contrato exige `/api/v2` + MAJOR.
- Migrações destrutivas exigem MAJOR e expand/contract.

### 11.2 Keep a Changelog 1.1.0

- `CHANGELOG.md` na raiz, `[Unreleased]` sempre presente.
- Categorias: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
- Toda mudança visível entra em `[Unreleased]` no mesmo PR.
- `CHANGELOG.md` e `deno.json` devem estar sincronizados.
- Primeira release: `0.1.0` (2026-11-05), publicada ao concluir a Fase 0.

### 11.3 Conventional Commits (recomendado)

`feat(scope): ...`, `fix(scope): ...`, `docs: ...`, `refactor: ...`, `test: ...`, `chore: ...`.
`BREAKING CHANGE:` no rodapé → MAJOR.

### 11.4 Release

1. Atualizar `deno.json` (`version`).
2. Mover `[Unreleased]` para `[X.Y.Z] - AAAA-MM-DD`.
3. Rodar `fmt`, `lint`, `check`, `test`.
4. Commit `chore(release): vX.Y.Z`.
5. Tag anotada `vX.Y.Z`.
6. Build Docker com a mesma tag.

---

## 12. Testes

- **Unitários:** dinheiro, datas, UUID, tokens, validação, streaks, budgets.
- **Integração:** repositórios + services com DB temporária; migrações.
- **HTTP:** `app.request` com cookies; auth, CSRF, rate limit, erros.
- **IA:** provider fake determinístico; outbox, worker, retry, dead-letter, executor, context, embeddings.
- **E2E:** servidor em porta aleatória; register → login → conta → transação → resumo → logout.
- **Tempo:** `@std/testing/time` para recorrência, streak e DST.
- **Nunca mocke o banco**; use SQLite real em diretório temporário.
- Cada teste deve ser isolado: DB própria, sem estado compartilhado.
- Testes de ordem não devem depender de outros testes.

```bash
deno test --allow-read --allow-write --allow-env --allow-sys --allow-ffi
deno test --coverage
```

---

## 13. Segurança — checklist

- [ ] Toda query escopada por usuário.
- [ ] Nenhum `userId` vindo do cliente é confiado.
- [ ] CSRF/Origin validados em métodos mutáveis.
- [ ] Rate limit em auth e endpoints sensíveis.
- [ ] Body limit e validação Zod.
- [ ] Cookies HttpOnly/Secure/SameSite corretos.
- [ ] Segredos apenas via env; nunca no código ou no Git.
- [ ] Logs sem tokens, senhas, PII ou payloads sensíveis.
- [ ] IA opt-in, com redação e auditoria.
- [ ] Migrações testadas e forward-only.

---

## 14. O que NÃO fazer

- ❌ Editar `reference_only/` (é somente leitura).
- ❌ Copiar padrões legados: `REAL` para dinheiro, `getDb()` global, eventos fire-and-forget, 95 evaluators bespoke.
- ❌ Criar singleton de banco ou importar `getDb()` em módulos.
- ❌ Publicar evento fora do outbox.
- ❌ Usar `Deno.env.get()` fora de `src/config.ts`.
- ❌ Usar `console.log` em código de aplicação.
- ❌ Apagar dados de usuário (hard delete).
- ❌ Retornar linhas cruas do banco (`snake_case`) na API.
- ❌ Colocar regra de negócio no controller.
- ❌ Deixar o LLM calcular métricas ou executar SQL.
- ❌ Commitar `.env`, `data/`, `*.db`, `node_modules/`, `build/`.
- ❌ Bumpar versão sem atualizar o changelog.
- ❌ Adicionar dependência sem justificativa.
- ❌ Alterar migração já aplicada.

---

## 15. Fluxo de trabalho do agente

1. Leia `AGENTS.md` e `docs/PLAN.md`.
2. Verifique a fase atual e o Definition of Done.
3. Inspecione o código existente antes de editar.
4. Faça mudanças pequenas e coesas; preserve o estilo.
5. Rode `deno fmt`, `deno lint`, `deno check` e `deno test`.
6. Atualize OpenAPI, `CHANGELOG.md` e docs quando aplicável.
7. Se a tarefa exigir uma decisão de arquitetura não documentada, **pare e pergunte**.
8. Commit com Conventional Commits.

### Definition of Done (por fase)

- `deno fmt --check`, `deno lint`, `deno check`, `deno test` verdes.
- OpenAPI atualizado e válido.
- `CHANGELOG.md` atualizado em `[Unreleased]`.
- Migrações testadas (aplicar duas vezes sem erro).
- Nenhum segredo com valor padrão.
- Toda query escopada por usuário.
- Operações multi-tabela em transação.

---

## 16. Roadmap

| Fase | Entrega | Status |
|---|---|---|
| 0 | Fundação: config, logger, erros, DB, migrações, testes, CI, Docker, OpenAPI base | ✅ `0.1.0` |
| 1 | Identidade: Argon2id, sessões/cookies/rotação, CSRF, rate limit, `/me` | ⏳ próximo |
| 2 | Finanças: contas/cartão, categorias, transações/transferências/parcelas, resumos | ⬜ |
| 3 | Planejamento: recorrências, orçamentos + alertas, metas + contribuições | ⬜ |
| 4 | Hábitos: CRUD, logs, streaks, calendário, triggers, stacking | ⬜ |
| 5 | Investimentos: ativos, operações, posições, performance | ⬜ |
| 6 | Engajamento: catálogo + DSL de critérios, notificações | ⬜ |
| 7 | Eventos + IA: outbox, worker, provider, prompts, tools, insights, embeddings | ⬜ |
| 8 | Dados e colaboração: import CSV/OFX, export, family links | ⬜ |
| 9 | Hardening: segurança, E2E, cobertura, índices, backups, docs, deploy | ⬜ |
| 10 | Frontend Svelte 5 + Vite/PWA | ⬜ |

Detalhes, estimativas e critérios de aceite: [`docs/PLAN.md`](docs/PLAN.md).

---

## 17. Arquivos-chave

| Arquivo | Papel |
|---|---|
| `docs/PLAN.md` | Plano completo aprovado |
| `docs/erDiagram.mmd` | ERD de referência |
| `CHANGELOG.md` | Histórico de mudanças (Keep a Changelog) |
| `deno.json` | Runtime, imports, tasks, versão (SemVer) |
| `src/config.ts` | Configuração validada com Zod |
| `src/db/client.ts` | Conexão SQLite + extensão vetorial |
| `src/db/migrate.ts` | Runner de migrações forward-only |
| `src/app.ts` | Factory do Hono |
| `src/main.ts` | Bootstrap da aplicação |
| `src/db/migrations/` | Migrações SQL numeradas |
| `bin/sqlite-vector/` | Binários de fallback da extensão vetorial |
| `Dockerfile` | Imagem multi-stage não-root |
| `.github/workflows/ci.yml` | CI (qualidade + build Docker) |
| `reference_only/` | Projeto antigo, somente leitura |

---

## 18. Dúvidas frequentes

**Posso usar `node:sqlite` em vez de `better-sqlite3`?**
Não sem aprovação. A stack aprovada usa `better-sqlite3` + `sqlite-vector`. Se houver bloqueio técnico (Docker/FFI), pare e proponha a mudança.

**Posso usar ORM?**
Não. O padrão aprovado é SQL puro + repositórios tipados.

**Posso pular o outbox e publicar direto?**
Não. O outbox garante que nenhum evento seja perdido.

**Posso adicionar um campo novo na API sem nova versão?**
Sim, se for opcional e retrocompatível. Remoções/renomeações exigem `/api/v2`.

**Posso alterar o schema com uma migração destrutiva?**
Só com expand/contract e aprovação; exige MAJOR.

**Onde registro uma decisão nova?**
Em `docs/DECISIONS.md` (ADR curto) e no `CHANGELOG.md` se afetar o usuário.
