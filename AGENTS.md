# AGENTS.md — Viva Bem

Guia para agentes de IA e contribuidores. Leia este arquivo **antes** de alterar qualquer coisa.

- **Plano canônico:** [`docs/PLAN.md`](docs/PLAN.md)
- **Referência legada:** `reference_only/` — **somente leitura**, nunca editar
- **Status:** reescrita greenfield, API-first; Fases 0 (fundação), 1 (identidade), 2 (finanças), 3 (planejamento), 4 (hábitos), 5 (investimentos), 6 (engajamento), 7 (eventos + IA) e 8 (dados e colaboração) concluídas, versão `0.9.0`

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

As Fases 0 (`0.1.0`), 1 (`0.2.0`), 2 (`0.3.0`), 3 (`0.4.0`), 4 (`0.5.0`), 5 (`0.6.0`), 6 (`0.7.0`), 7 (`0.8.0`) e 8 (`0.9.0`) estão concluídas. O que existe hoje:

| Item | Estado |
|---|---|
| `src/config.ts` | env validado com Zod; única leitora de `Deno.env` |
| `src/shared/logger/` | logger JSON com redação de dados sensíveis |
| `src/http/` | `AppError`, handler de erros, OpenAPI, middlewares |
| `src/http/cookies.ts` | cookies `vb_access`, `vb_refresh`, `vb_csrf` e flags |
| `src/http/middleware/` | request-id, logger, body-limit, security-headers, CORS, CSRF, rate-limit, auth, ip-blocklist |
| `src/shared/crypto/jwt.ts` | assinatura/verificação de access token HS256 |
| `src/shared/crypto/tokens.ts` | token opaco, SHA-256, base64url, comparação constante |
| `src/shared/utils/rate-limiter.ts` | janela deslizante em memória |
| `src/events/` | outbox transacional, publisher e worker com lease/backoff/dead-letter |
| `src/ai/` | providers, parser, redação, prompts, contexto, correlação, embeddings, executor, tools |
| `src/modules/auth/` | repository, service e controller de identidade |
| `src/modules/users/` | `/me`, preferências (incl. `aiEnabled`) e sessões |
| `src/modules/accounts/` | contas, cartões, saldo e limite disponível |
| `src/modules/categories/` | categorias, árvore e desativação em cascata |
| `src/modules/transactions/` | transações, transferências, parcelas e resumos |
| `src/modules/recurring/` | recorrências, ocorrências idempotentes e run-now |
| `src/modules/budgets/` | orçamentos, consumo por subárvore e limiares |
| `src/modules/goals/` | metas, contribuições e progresso |
| `src/modules/habits/` | hábitos, logs, streaks, calendário e gatilhos |
| `src/modules/investments/` | ativos, operações, cotações, posições e performance |
| `src/modules/achievements/` | catálogo, DSL de critérios, progresso e desbloqueio |
| `src/modules/notifications/` | notificações escopadas, leitura e contagem |
| `src/modules/insights/` | insights da IA, leitura, contagem, busca e feedback |
| `src/modules/import/` | parsers CSV/OFX, preview, dedupe e commit idempotente |
| `src/modules/export/` | bundle JSON completo e CSV de transações |
| `src/modules/family/` | convites, vínculo familiar e resumo agregado do parceiro |
| `src/modules/security/` | repositório de bloqueio de IP acionado pelas tools |
| `src/shared/utils/date.ts` | datas de negócio, soma de meses com clamp, intervalos e dia ISO |
| `src/db/client.ts` | conexão SQLite + extensão vetorial + transações |
| `src/db/migrate.ts` | runner forward-only com checksum |
| `src/db/migrations/001_core.sql` | tabelas de identidade |
| `src/db/migrations/002_finance.sql` | contas, cartões, categorias, transações e parcelas |
| `src/db/migrations/003_planning.sql` | recorrências, orçamentos, metas e contribuições |
| `src/db/migrations/004_habits.sql` | hábitos, logs diários e gatilhos |
| `src/db/migrations/005_investments.sql` | ativos, operações e cotações |
| `src/db/migrations/006_engagement.sql` | conquistas, progresso e notificações |
| `src/db/migrations/007_ai.sql` | outbox, logs de IA, insights, feedback, embeddings e blocklist |
| `src/db/migrations/008_data.sql` | vínculos familiares e unicidade de `import_hash` |
| `src/app.ts` | factory do Hono (sem efeitos colaterais) |
| `src/main.ts` | bootstrap: config → migrações → seed → catch-up → runtime de IA → servidor |
| `tests/` | unitários e integração com SQLite real (206 testes) |
| `bin/sqlite-vector/` | binários de fallback (Linux x86_64/arm64) |
| `docs/erDiagram.mmd` | ERD de referência para o novo schema |
| `docs/PLAN.md` | plano completo aprovado |
| `CHANGELOG.md` | Keep a Changelog, com `[Unreleased]` e releases |
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
deno task db:seed        # dados demo (Fase 3)
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
                       # achievements, notifications, family, insights,
                       # import, export
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

### 5.4 Planejamento (Fase 3)

- Recorrências aceitam apenas `income`/`expense`; a materialização cria uma
  transação e uma linha em `recurring_occurrences` na mesma transação.
- `unique (recurring_transaction_id, occurrence_date)` garante idempotência;
  catch-up no boot e `POST /recurring/{id}/run-now` compartilham o mesmo caminho.
- Recorrências mensais/anuais mantêm o dia-alvo via `addMonthsWithDay` (31 vira
  28/29/30 quando necessário) e são limitadas a 500 ocorrências por execução.
- O consumo do orçamento soma a subárvore inteira da categoria; o nível usa o
  `alert_threshold` configurável e os limiares fixos `[80, 90, 100]`.
- Contribuições de meta têm soft delete (`deleted_at`) e são somadas apenas
  quando ativas; a meta completa/reverte automaticamente conforme o total.
- A moeda da meta é imutável depois da primeira contribuição.

### 5.5 Hábitos (Fase 4)

- `habit_type` é `good` ou `bad`; `frequency_type` é `daily`, `weekly` ou
  `custom`. Dias são armazenados como array JSON de dias ISO (1 = segunda …
  7 = domingo); `daily` não usa dias e `weekly` exige exatamente um.
- O dia agendado é cumprido quando um hábito bom tem log com
  `value >= daily_target`; um hábito ruim conta o dia limpo quando não há log
  ou o log registra `value <= 0`.
- O streak pula dias não agendados, usa aritmética UTC (imune a DST/fuso) e
  não quebra o dia corrente de um hábito bom antes de ele terminar.
- `habit_logs` tem unicidade `(habit_id, log_date)`; o POST do dia faz upsert e
  restaura uma linha previamente removida via `deleted_at`.
- O hábito só aceita logs entre a data de criação e hoje; o tipo é imutável
  depois que existem registros.
- Empilhamento via `parent_habit_id` com limite de 5 níveis, detecção de ciclos
  e desativação recursiva da subárvore.
- Gatilhos ligam um hábito ruim a uma substituição boa; a desativação da
  subárvore remove em cascata os gatilhos relacionados.
- `GET /habits/{id}/streak` e `GET /habits/{id}/calendar` aceitam `?date=` para
  avaliação determinística; o calendário cobre no máximo 366 dias.

### 5.6 Investimentos (Fase 5)

- `quantity` é `REAL > 0` (ativos fracionários); preços, taxas e valores
  monetários são inteiros em minor units com a moeda do ativo.
- Operações são `buy`, `sell`, `dividend` e `fee`; compras e vendas exigem
  quantidade e preço, dividendos exigem quantidade e valor por unidade e taxas
  avulsas exigem apenas `fees_minor > 0`.
- O custo médio é ponderado: a compra soma preço + taxas à base de custo; a
  venda remove a fração proporcional da base e realiza
  `bruto - taxas - custo removido`; dividendos somam ao resultado e taxas
  avulsas reduzem o realizado.
- `totalPnlMinor = realizado + dividendos + não realizado`; o não realizado só
  existe quando há cotação. `returnPercent = totalPnl / investido`, arredondado
  a 2 casas.
- A operação é validada contra a posição inteira recalculada, então venda a
  descoberto é bloqueada mesmo em lançamentos retroativos. Operações não podem
  ser futuras nem anteriores à criação do ativo.
- A conta da operação precisa pertencer ao usuário e ter a mesma moeda do
  ativo; a moeda do ativo é imutável depois da primeira operação.
- A ordenação de operações no mesmo dia usa `operation_date`, `created_at` e
  `rowid`; UUIDv7 do mesmo milissegundo não é monotônico e não serve como
  desempate.
- `GET /investments/portfolio` consolida posições e totais por moeda; uma
  posição aberta sem cotação marca `valuationComplete = false`.
- `investment_quotes` guarda o histórico; a cotação mais recente valoriza a
  posição e a carteira. O ativo usa soft delete via `deleted_at` e o ticker é
  único por usuário apenas entre ativos vivos (case-insensitive).

### 5.7 Engajamento (Fase 6)

- O catálogo tem 352 conquistas (22 ocultas) e 106 regras únicas, portadas de
  `reference_only/`; o seed é idempotente pelo título.
- Cada conquista referencia uma regra da DSL (`achievements.criteria.ts`) e
  parâmetros JSON (`criteria_params`), usados hoje apenas pelo dia da semana de
  `CONSECUTIVE_DAY_OF_WEEK`.
- A DSL cobre `count`, `exists`, `sum`, `max`, `maxGroup`, `maxGroupDays`,
  `streak`, `maxGroupStreak`, `rowStreak`, `sameValueStreak`, `daysSince`,
  `ratioPredicate`, `maxRatioPredicate`, `uniform`, `conditional`, `allOf`,
  `score` e `constant`.
- Streaks usam `day`, `businessDay`, `week` ou `month`, com uma unidade de
  tolerância para não quebrar o período corrente antes de ele terminar; datas
  são avaliadas em UTC.
- Datasets, colunas e ordenações vêm de listas fechadas e passam por regex
  antes de entrar no SQL; nenhuma regra interpola entrada de usuário ou
  específica um `SELECT` no service.
- A avaliação é preguiçosa em `GET /achievements/me*` e roda após mutações
  autenticadas bem-sucedidas, fora da transação da regra, com até três passadas
  para conquistas de meta. Falha de avaliação é logada e não quebra a resposta.
- `user_achievements` tem unicidade `(user_id, achievement_id)`; uma conquista
  já desbloqueada não é reavaliada e `unlocked_at` não muda.
- O primeiro desbloqueio cria uma notificação com título estável
  `Conquista desbloqueada: <título>`, categoria da conquista e severidade por
  faixa de pontos; títulos repetidos não geram nova notificação.
- Toda leitura/escrita de notificação é escopada por `user_id` da sessão;
  acesso cruzado retorna `NOT_FOUND` e `read-all` não atravessa o escopo.
- O catálogo público (`GET /achievements`) esconde conquistas ocultas e não
  expõe `criteria_rule` nem `criteria_params`; o resumo usa o total de 352.

### 5.8 Eventos e IA (Fase 7)

- `event_outbox` é gravado na mesma transação da regra de negócio e só recebe
  eventos quando `AI_ENABLED=true` **e** `user_preferences.ai_enabled=1`;
  `EventPublisher.publish` devolve `null` quando a IA está desligada ou o
  usuário não autorizou, então pode ser chamado sem condicional nos services.
- O claim usa um único `UPDATE ... RETURNING`, incrementando `attempts`; o
  worker recupera leases vencidos antes de cada ciclo, aplica backoff de 5s até
  5min e envia para dead-letter quando `AI_MAX_RETRIES + 1` tentativas falham.
- O processor indexa embeddings quando o tipo é `embedding.requested`; nos
  demais eventos monta contexto via SQL, redige PII, chama o provider, valida a
  resposta com Zod e delega as tool calls ao executor.
- O executor valida schema, confiança mínima, risco alto (≥ 0.9), cooldown,
  duplicidade de argumentos em 24h e audita tudo em `ai_action_logs`. Nenhuma
  tool executa SQL arbitrário.
- Insights são escopados por `user_id`; a busca usa vetores quando disponíveis
  e cai para `LIKE` em título/mensagem antes da indexação terminar.
- A correlação cross-domain (`habit_spending_link`, `weekend_spending_peak`) é
  calculada em SQL e só agenda `correlation.check` após
  `AI_CORRELATION_THRESHOLD` eventos concluídos desde a última execução.

### 5.9 Dados e colaboração (Fase 8)

- A importação aceita `multipart/form-data` com `accountId` e `file`, detecta
  CSV ou OFX pelo conteúdo (nunca pela extensão) e limita a 1 MB e 5.000 linhas.
- O `import_hash` é `sha256` de `external|accountId|FITID` quando há `FITID`;
  sem ele, de `content|accountId|data|tipo|valor|descrição normalizada`. A conta
  entra na chave para impedir dedupe entre contas diferentes.
- `transactions.import_hash` tem unicidade parcial por conta entre linhas vivas;
  o commit usa `ON CONFLICT DO NOTHING`, então reimportar o mesmo arquivo é
  idempotente mesmo com concorrência.
- O preview devolve no máximo 500 linhas, mas os totais e os erros por linha
  cobrem o arquivo inteiro; erros não interrompem as linhas válidas.
- O commit grava as transações e publica `finance.transaction.imported` no
  outbox dentro da mesma transação, com totais e até 200 IDs de amostra.
- O export JSON devolve todas as entidades do usuário em camelCase; o CSV
  exporta transações vivas com nome da conta e da categoria. Hashes de senha e
  refresh token e vetores de embedding nunca entram no bundle.
- Um usuário só pode ter um vínculo familiar pendente ou ativo por vez. O par é
  único sem ordem (`ux_family_links_pair`); recusar/revogar e convidar de novo
  reabre a mesma linha.
- O resumo familiar expõe apenas totais do mês corrente por moeda e contagens
  agregadas do parceiro; nunca transações, contas ou categorias individuais.
- Convite, aceite, recusa e revogação geram notificação para o outro lado;
  qualquer acesso cruzado a um vínculo retorna `NOT_FOUND`.

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
- Provider OpenAI-compatible via `fetch`; adapter Ollama opcional via `AI_PROVIDER`.
- Parser robusto: remove ` thinking`/prosa, extrai JSON e valida com Zod; falha de
  parse vira retry no worker, não no parser.
- Context builders calculam métricas em SQL; **o LLM nunca consulta o banco**.
- O LLM **não executa SQL** nem regras de negócio; só sugere tool calls.
- Executor valida parâmetros, autorização, cooldown, duplicidade e confiança; audita tudo.
- `AI_ENABLED=false` por padrão em produção; IA é opt-in por usuário.
- Redija PII antes de enviar a provider externo.
- Embeddings em `embedding_items` com `vector_init` preguiçoso quando a IA está
  ligada; gere de forma assíncrona via `embedding.requested`.

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
- Segunda release: `0.2.0` (2026-11-05), publicada ao concluir a Fase 1.
- Terceira release: `0.3.0` (2026-11-05), publicada ao concluir a Fase 2.
- Quarta release: `0.4.0` (2026-11-05), publicada ao concluir a Fase 3.
- Quinta release: `0.5.0` (2026-11-05), publicada ao concluir a Fase 4.
- Sexta release: `0.6.0` (2026-11-05), publicada ao concluir a Fase 5.
- Sétima release: `0.7.0` (2026-11-05), publicada ao concluir a Fase 6.
- Oitava release: `0.8.0` (2026-11-05), publicada ao concluir a Fase 7.
- Nona release: `0.9.0` (2026-11-09), publicada ao concluir a Fase 8.

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
| 1 | Identidade: Argon2id, sessões/cookies/rotação, CSRF, rate limit, `/me` | ✅ `0.2.0` |
| 2 | Finanças: contas/cartão, categorias, transações/transferências/parcelas, resumos | ✅ `0.3.0` |
| 3 | Planejamento: recorrências, orçamentos + alertas, metas + contribuições | ✅ `0.4.0` |
| 4 | Hábitos: CRUD, logs, streaks, calendário, triggers, stacking | ✅ `0.5.0` |
| 5 | Investimentos: ativos, operações, posições, performance | ✅ `0.6.0` |
| 6 | Engajamento: catálogo + DSL de critérios, notificações | ✅ `0.7.0` |
| 7 | Eventos + IA: outbox, worker, provider, prompts, tools, insights, embeddings | ✅ `0.8.0` |
| 8 | Dados e colaboração: import CSV/OFX, export, family links | ✅ `0.9.0` |
| 9 | Hardening: segurança, E2E, cobertura, índices, backups, docs, deploy | ⏳ próximo |
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
| `src/http/cookies.ts` | Cookies de autenticação e CSRF |
| `src/http/middleware/auth.ts` | Exige access token e sessão ativa |
| `src/http/middleware/csrf.ts` | Double-submit + Origin/Sec-Fetch-Site |
| `src/http/middleware/rate-limit.ts` | Rate limit por IP |
| `src/modules/auth/` | Registro, login, refresh, logout, reuso |
| `src/modules/users/` | Perfil, preferências e sessões |
| `src/modules/accounts/` | Contas, cartões, saldo e limite disponível |
| `src/modules/categories/` | Categorias, árvore e desativação em cascata |
| `src/modules/transactions/` | Transações, transferências, parcelas e resumos |
| `src/modules/recurring/` | Recorrências, ocorrências e run-now |
| `src/modules/budgets/` | Orçamentos, consumo por subárvore e limiares |
| `src/modules/goals/` | Metas, contribuições e progresso |
| `src/modules/habits/` | Hábitos, logs, streaks, calendário e gatilhos |
| `src/modules/investments/` | Ativos, operações, cotações, posições e performance |
| `src/modules/achievements/` | Catálogo, DSL de critérios, progresso e desbloqueio |
| `src/modules/notifications/` | Notificações escopadas, leitura e contagem |
| `src/modules/insights/` | Insights da IA, leitura, contagem, busca e feedback |
| `src/modules/import/` | Parsers CSV/OFX, preview, dedupe e commit idempotente |
| `src/modules/export/` | Bundle JSON completo e CSV de transações |
| `src/modules/family/` | Convites, vínculo familiar e resumo agregado do parceiro |
| `src/modules/security/` | Bloqueio de IP acionado pelas tools |
| `src/events/event-publisher.ts` | Publicação no outbox (opt-in e IA ligada) |
| `src/events/worker.ts` | Claim, lease, backoff, dead-letter e correlação |
| `src/ai/ai.processor.ts` | Orquestração de contexto, provider, parser e executor |
| `src/ai/ai.executor.ts` | Validação, confiança, cooldown, dedupe e auditoria |
| `src/ai/ai.redaction.ts` | Redação de PII antes do provider |
| `src/ai/embeddings.service.ts` | Indexação assíncrona e busca vetorial |
| `src/ai/ai.correlation.ts` | Padrões cross-domain e scheduler |
| `src/http/middleware/ip-blocklist.ts` | Enforcement da blocklist de IP |
| `src/http/middleware/achievement-evaluation.ts` | Avaliação após mutações autenticadas |
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
