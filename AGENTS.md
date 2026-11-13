# AGENTS.md — Viva Bem

Guia para agentes de IA e contribuidores. Leia este arquivo **antes** de alterar qualquer coisa.

- **Plano canônico:** [`docs/PLAN.md`](docs/PLAN.md)
- **Referência legada:** `reference_only/` — **somente leitura**, nunca editar
- **Status:** reescrita greenfield, API-first; Fases 0 (fundação), 1 (identidade), 2 (finanças), 3 (planejamento), 4 (hábitos), 5 (investimentos), 6 (engajamento), 7 (eventos + IA), 8 (dados e colaboração), 9 (hardening e operação), 10 (frontend Svelte 5 + Vite/PWA) e 11 (worker independente) concluídas — versão `1.1.0`

---

## 1. Visão do projeto

Viva Bem é um app de finanças pessoais + construção de hábitos, com análise assíncrona por IA (Event Intelligence Engine). Estamos reescrevendo o projeto antigo do zero, preservando o domínio e a experiência, mas corrigindo as dívidas técnicas:

- dinheiro em `REAL` → agora inteiro em minor units;
- eventos de IA fire-and-forget → agora outbox transacional;
- `getDb()` global → agora injeção de dependência;
- refresh sem rotação → agora rotação com detecção de reuso;
- 95+ avaliadores de conquistas bespoke → agora DSL declarativa;
- sem OpenAPI/versionamento → agora `/api/v1` + OpenAPI 3.1.

**Estratégia:** API primeiro. O frontend (Svelte 5 + Vite/PWA) fica em `web/` e
consome a API em `/api/v1` pela mesma origem; o MVP está entregue.

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
| Frontend | Svelte 5 (runes) + Vite 7 + TypeScript strict + PWA |
| Estilo do frontend | CSS próprio com design tokens; sem Tailwind nem lib de componentes |
| Deploy | Docker multi-stage + Nginx + Portainer |

**Não adicione dependências sem justificar.** Prefira a biblioteca padrão do Deno e `fetch` nativo.

---

## 3. Estado atual do repositório

As Fases 0 (`0.1.0`), 1 (`0.2.0`), 2 (`0.3.0`), 3 (`0.4.0`), 4 (`0.5.0`), 5 (`0.6.0`), 6 (`0.7.0`), 7 (`0.8.0`), 8 (`0.9.0`), 9 (`0.10.0`), 10 (`0.11.0`), 11 (`0.12.0`) e 12 (`1.0.0`) estão concluídas, com a correção de autenticação publicada em `1.0.1`. O que existe hoje:

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
| `src/events/` | outbox transacional, publisher, registry de eventos e CLI de replay |
| `src/worker/` | entry point e runtime do worker: polling, lease/heartbeat, concorrência e shutdown gracioso |
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
| `src/modules/notifications/notifications.push.*` | assinaturas push, sender VAPID, dispatcher e rotas |
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
| `src/db/migrations/009_hardening.sql` | índices de manutenção (sessões e outbox) |
| `src/db/migrations/010_worker.sql` | lease da outbox, `dead_letter`, replay e `dedupe_key` |
| `src/db/migrations/011_idempotency.sql` | chaves de idempotência por usuário |
| `src/db/migrations/012_push.sql` | assinaturas push e `push_state` das notificações |
| `src/app.ts` | factory do Hono (sem efeitos colaterais) |
| `src/main.ts` | bootstrap da API: config → migrações → seed → catch-up → servidor (sem worker) |
| `tests/` | unitários e integração com SQLite real (241 testes) |
| `bin/sqlite-vector/` | binários de fallback (Linux x86_64/arm64) |
| `web/` | SPA Svelte 5 + Vite + PWA: shell, páginas, componentes, `lib/` e assets PWA |
| `web/src/lib/api.ts` | cliente HTTP com cookies, CSRF, refresh single-flight e tradução de erros |
| `web/src/lib/auth.svelte.ts` | store de sessão (init, login, register, logout) |
| `web/src/lib/router.svelte.ts` | hash router reativo |
| `web/src/app.css` | design tokens, layout, tema e responsividade |
| `web/nginx.conf` | fallback do SPA, proxy `/api`, CSP, cache e `/healthz` |
| `web/Dockerfile` | build Node 24 + runtime Nginx não-root (porta 8080) |
| `docs/erDiagram.mmd` | ERD de referência para o novo schema |
| `docs/PLAN.md` | plano completo aprovado |
| `docs/FRONTEND.md` | arquitetura, rotas, auth, PWA e deploy do frontend |
| `CHANGELOG.md` | Keep a Changelog, com `[Unreleased]` e releases |
| Docker/CI | `Dockerfile`, `web/Dockerfile`, `compose.yaml`, `.github/workflows/ci.yml` |

**Permissões do Deno:** `better-sqlite3` é um addon nativo e exige `--allow-ffi`; ele também consulta `process.report`/CPUs e exige `--allow-sys`. As tasks do `deno.json` já encapsulam as permissões necessárias. Nunca use `--allow-all`.

---

## 4. Comandos

### 4.1 Comandos disponíveis

```bash
deno task dev            # servidor com watch (carrega .env.example)
deno task start          # servidor
deno task dev:worker     # worker com watch (carrega .env.example)
deno task worker         # worker do EIE (consome o outbox)
deno task test           # suíte completa (tests/)
deno task test:coverage  # testes com cobertura
deno task check          # typecheck de src, tests e scripts
deno task lint           # lint
deno task fmt            # formatação
deno task fmt:check      # verifica formatação
deno task db:migrate     # aplica migrações pendentes
deno task db:reset       # apaga e recria o banco
deno task db:backup      # backup em backups/
deno task outbox:replay --list   # eventos em dead letter
deno task outbox:replay --id=<uuid> --force  # recoloca na fila
deno task push:keys      # gera o par VAPID para o .env/Portainer
deno task check:release  # valida versão x CHANGELOG

make web-install         # npm ci em web/
make web-dev             # Vite em http://localhost:5173 (proxy para :3000)
make web-check           # svelte-check (0 erros e 0 warnings)
make web-build           # build de produção + PWA em web/dist
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
  main.ts              # bootstrap da API: config → migrations → seed → server
  worker/
    main.ts            # entry point do worker (sem HTTP)
    runtime.ts         # polling, lease/heartbeat, pool e shutdown
    backoff.ts errors.ts
  app.ts               # factory do Hono (testável)
  config.ts            # env validado com Zod
  version.ts           # versão do deno.json
  http/                # erros, OpenAPI, middlewares
  db/                  # client, migrate, migrations, repositories
  modules/             # auth, users, accounts, categories, transactions,
                       # recurring, budgets, goals, habits, investments,
                       # achievements, notifications, family, insights,
                       # import, export
  events/              # publisher (outbox) + registry + replay CLI
  ai/                  # providers, context, prompts, tools, registry,
                       # executor, embeddings, correlation
  shared/              # crypto, logger, utils
tests/
  helpers/ unit/ integration/ e2e/
web/
  index.html vite.config.ts nginx.conf Dockerfile
  public/              # ícones e assets do PWA
  src/
    App.svelte main.ts app.css
    lib/                # api, auth, router, theme, toast, format, types
    components/         # AppShell, modais, linha de transação
    pages/              # login, register, dashboard, accounts, transactions,
                        # recurring, categories, budgets, goals, habits,
                        # investments, achievements, notifications, insights,
                        # data, family, settings, coming-soon, not-found
docs/
  PLAN.md API.md ARCHITECTURE.md DECISIONS.md DEPLOY.md FRONTEND.md
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
- A API não consome o outbox. O consumidor é o processo independente
  `src/worker/main.ts` (Fase 11), que abre a própria conexão SQLite e fala com
  a API apenas pelo arquivo do banco (WAL + `busy_timeout`).
- O claim usa um único `UPDATE ... RETURNING`, incrementando `attempts` e
  gravando `lease_token`/`lease_expires_at`; `complete`/`fail` só afetam a
  concessão corrente (`worker_id` + token). Leases vencidos são recuperados
  antes de cada ciclo; heartbeat renova o lease durante o processamento.
- Backoff de 5s até 5min; falha permanente (payload inválido, tipo
  desconhecido, 4xx do provider) vai direto para `dead_letter`; falha
  transitória esgota `WORKER_MAX_ATTEMPTS` antes de ir para `dead_letter`.
- `src/events/event-registry.ts` descreve pipeline e validação de payload por
  tipo; o processor consulta o registry antes de montar contexto.
- O processor indexa embeddings quando o tipo é `embedding.requested`; nos
  demais eventos monta contexto via SQL, redige PII, chama o provider, valida a
  resposta com Zod e delega as tool calls ao executor.
- Insights e notificações deduplicam por `dedupe_key = "<eventId>:<título>"`
  com índice único parcial; reprocessar o mesmo evento não duplica efeitos.
  A entrega continua sendo pelo menos uma vez, nunca exactly-once.
- O executor valida schema, confiança mínima, risco alto (≥ 0.9), cooldown,
  duplicidade de argumentos em 24h e audita tudo em `ai_action_logs`. Nenhuma
  tool executa SQL arbitrário.
- Insights são escopados por `user_id`; a busca usa vetores quando disponíveis
  e cai para `LIKE` em título/mensagem antes da indexação terminar.
- A correlação cross-domain (`habit_spending_link`, `weekend_spending_peak`) é
  calculada em SQL e só agenda `correlation.check` após
  `AI_CORRELATION_THRESHOLD` eventos concluídos desde a última execução.
- O worker não migra: `assertSchemaCurrent` falha no boot se a API ainda não
  aplicou o schema. `deno task outbox:replay` é o caminho auditável para
  devolver eventos de `dead_letter` à fila.

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

### 5.10 Hardening e operação (Fase 9)

- A manutenção (`src/db/maintenance.ts`) roda no boot e a cada 24h, dentro de
  uma transação, e remove apenas dados operacionais: sessões expiradas, eventos
  de outbox concluídos com mais de 30 dias, bloqueios de IP vencidos e
  embeddings cujo insight de origem não existe. Falha é logada e não derruba o
  processo.
- `idx_user_sessions_expires` e o índice parcial `idx_event_outbox_cleanup`
  (migração `009_hardening.sql`) sustentam a limpeza sem varrer tabelas.
- O backup usa `VACUUM INTO` em `src/db/backup.ts`, produzindo snapshot
  consistente com WAL ativo; a CLI `db:backup` reutiliza o mesmo módulo.
- Headers de API incluem CSP `default-src 'none'`, `Cache-Control: no-store`,
  COOP e `X-Permitted-Cross-Domain-Policies`; `/api/docs` fica sem CSP para o
  Swagger UI.
- `RATE_LIMIT_DATA_MAX` (padrão 30/min por IP) limita importação e exportação,
  separado de `RATE_LIMIT_AUTH_MAX`.
- E2E usam `Deno.serve` em porta aleatória (`tests/helpers/server.ts`) e um
  cliente com cookie jar, exercitando sockets, cookies e shutdown reais.
- `compose.yaml` + `make deploy` entregam build, volumes de dados/backups,
  healthcheck, shutdown gracioso e deploy em um comando; o CI publica cobertura
  LCOV.

### 5.11 Frontend (Fase 10)

- O SPA vive em `web/`: Svelte 5 com runes, Vite 7, TypeScript strict e PWA
  (`vite-plugin-pwa`/Workbox). Detalhes em `docs/FRONTEND.md`.
- Rotas usam hash (`#/dashboard`, ...) para hospedagem estática; `App.svelte`
  aplica guards (público x autenticado) e `router.svelte.ts` normaliza o hash.
- Cookies são a única credencial: o cliente (`lib/api.ts`) usa
  `credentials: "include"`, faz bootstrap de CSRF em `GET /auth/csrf`, envia
  `X-CSRF-Token` em métodos mutáveis e renova a sessão uma única vez em `401`.
- Dinheiro nunca vira `float` no cliente: `amountMinor` é formatado com
  `Intl.NumberFormat` e a entrada é convertida por `toMinorUnits`.
- Estilo é CSS próprio com tokens (`app.css`), tema claro/escuro em
  `data-theme` e persistência em `localStorage`. Não introduza Tailwind nem
  biblioteca de componentes sem aprovação.
- Navegação: sidebar no desktop; no mobile (≤ 900px), cinco atalhos fixos
  (Painel, Transações, Contas, Orçamentos e Metas) e menu "Mais" em bottom
  sheet com as demais rotas.
- Telas entregues: login/registro, painel, contas, transações, recorrências,
  categorias, orçamentos, metas, hábitos, investimentos, conquistas,
  notificações, insights, dados (import/export), família e configurações.
- `notifications.svelte.ts` mantém o sino (badge, polling de 60s pausado com a
  aba oculta) e traduz links da API para rotas do SPA; o painel é renderizado
  fora do topbar porque o `backdrop-filter` cria containing block para
  `position: fixed` no mobile.
- `Data.svelte` envia `multipart/form-data` por `api()` (campo `form`) e baixa
  exportações por `Blob`/`download()`; `Family.svelte` só busca o resumo quando
  existe vínculo ativo; `Insights.svelte` usa a mesma busca com fallback
  textual e não esconde os insights existentes quando a IA está desativada
  (apenas avisa).
- O container é Nginx não-root na porta 8080, com fallback do SPA, proxy de
  `/api`, `/health` e `/ready`, CSP e cache de assets; `sw.js` não é cacheado.
- `vite` está fixado em 7.x de propósito: o Vite 8/Rolldown usa instruções
  indisponíveis em CPUs AVX-only e quebra o build. Não atualize sem testar.
- `npm run check` deve ficar em 0 erros e 0 warnings; `npm run build` deve gerar
  `sw.js` e o manifest.

### 5.12 Push e offline

- Push é opt-in por dispositivo: `push.svelte.ts` separa `supported` (APIs do
  navegador), `enabled` (`PUSH_ENABLED` no servidor) e `subscribed` (assinatura
  viva deste dispositivo). O opt-in fica em Configurações.
- A entrega usa a própria linha de `notifications` (`push_state`, `push_attempts`
  e claim/lease) em vez de um evento novo na outbox; nenhum call site de
  notificação conhece push.
- O worker entrega push de forma independente da IA: ele sobe com `AI_ENABLED`
  ou `PUSH_ENABLED` e só encerra com os dois desligados (`worker_disabled`).
- `404`/`410` do serviço de push revogam a assinatura; falhas transitórias voltam
  para `pending` até `PUSH_MAX_ATTEMPTS` e depois viram `failed`.
- As chaves VAPID vivem só no ambiente (nunca no banco); `deno task push:keys`
  gera o par e `assertPushConfig` falha no boot se faltar alguma.
- Com `PUSH_ENABLED=false` as rotas de escrita respondem `PUSH_DISABLED` (503).
- O service worker (`web/src/sw.ts`, `injectManifest`) cuida de `push`,
  `notificationclick` e badge; mutações offline vão para IndexedDB com
  `Idempotency-Key` e snapshot de CSRF.
- Background Sync é híbrido: com aba aberta a página reproduz a fila; sem aba o
  worker tenta com o snapshot e aborta em `401`/`403`. **O service worker nunca
  chama `/auth/refresh`** — duas renovações revogariam a família de tokens.
- Periodic Background Sync (`vivabem-refresh`, 24h) só atualiza o badge; a API
  nunca é cacheada.

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
- Frontend: Svelte 5 com runes (sem stores legadas); estado global só para
  sessão, rota, tema e toasts. Tipos espelham o contrato da API em `lib/types.ts`.
- Frontend: nunca leia tokens (são HttpOnly) nem monte URL absoluta da API; use
  `lib/api.ts` e caminhos relativos (`/transactions`, não `/api/v1/transactions`).
- Frontend: dinheiro em `amountMinor`; formatação e conversão só via
  `lib/format.ts`.

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
- O consumidor é o worker independente (`src/worker/main.ts`); a API não processa eventos.
- Worker com claim atômico, lease com token, backoff, recuperação de travados e `dead_letter`.
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
- **Imutabilidade de release:** uma tag Git ou de imagem já publicada nunca é
  sobrescrita. Correção nova = patch novo (`1.0.1`, `1.0.2`, ...) + tag nova;
  `latest` pode avançar, mas as tags `X.Y.Z` ficam congeladas.
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
- Décima release: `0.10.0` (2026-11-09), publicada ao concluir a Fase 9.
- Décima segunda release: `0.12.0` (2026-11-11), publicada ao concluir a Fase 11.
- Décima terceira release: `1.0.0` (2026-11-11), publicada ao congelar a API v1.
- Décima quarta release: `1.0.1` (2026-11-13), correção da idempotência nas rotas
  de autenticação e do repasse de `AI_*` no Compose/Portainer.
- Décima quinta release: `1.1.0` (2026-11-13), notificações push, fila offline,
  Background Sync e Periodic Sync.

### 11.3 Conventional Commits (recomendado)

`feat(scope): ...`, `fix(scope): ...`, `docs: ...`, `refactor: ...`, `test: ...`, `chore: ...`.
`BREAKING CHANGE:` no rodapé → MAJOR.

### 11.4 Release

1. Atualizar `deno.json` (`version`).
2. Mover `[Unreleased]` para `[X.Y.Z] - AAAA-MM-DD`.
3. Rodar `fmt`, `lint`, `check`, `test`.
4. Commit `chore(release): vX.Y.Z`.
5. Tag anotada `vX.Y.Z` e push de `main` + tag.
6. Build Docker com a mesma tag e push sem sobrescrever tags já publicadas
   (`latest` só avança junto com a versão nova).

---

## 12. Testes

- **Unitários:** dinheiro, datas, UUID, tokens, validação, streaks, budgets.
- **Integração:** repositórios + services com DB temporária; migrações.
- **HTTP:** `app.request` com cookies; auth, CSRF, rate limit, erros.
- **IA:** provider fake determinístico; outbox, worker, retry, dead-letter, executor, context, embeddings.
- **E2E:** servidor em porta aleatória; register → login → conta → transação → resumo → logout.
- **Tempo:** `@std/testing/time` para recorrência, streak e DST.
- **Frontend:** `npm run check` (svelte-check, 0 erros e 0 warnings) e
  `npm run build` (Vite + PWA) no CI; validação de navegador é manual com
  Playwright/Chromium e cobre o fluxo de registro, finanças e transferência.
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
- ❌ Adicionar Tailwind, biblioteca de componentes ou fonte externa no frontend.
- ❌ Guardar access/refresh token em `localStorage` ou em memória no frontend.
- ❌ Cachear respostas de `/api/**` no service worker.
- ❌ Chamar `/auth/refresh` de dentro do service worker (revoga a família de tokens).
- ❌ Persistir chaves VAPID no banco ou no repositório (só ambiente).
- ❌ Subir Vite 8/Rolldown: quebra o build em CPUs AVX-only.

---

## 15. Fluxo de trabalho do agente

1. Leia `AGENTS.md` e `docs/PLAN.md`.
2. Verifique a fase atual e o Definition of Done.
3. Inspecione o código existente antes de editar.
4. Faça mudanças pequenas e coesas; preserve o estilo.
5. Rode `deno fmt`, `deno lint`, `deno check` e `deno test`; no frontend,
   `npm run check` e `npm run build` (em `web/`).
6. Atualize OpenAPI, `CHANGELOG.md` e docs quando aplicável.
7. Se a tarefa exigir uma decisão de arquitetura não documentada, **pare e pergunte**.
8. Commit com Conventional Commits.

### Definition of Done (por fase)

- `deno fmt --check`, `deno lint`, `deno check`, `deno test` verdes.
- `npm run check` (0 erros e 0 warnings) e `npm run build` verdes em `web/`.
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
| 9 | Hardening: segurança, E2E, cobertura, índices, backups, docs, deploy | ✅ `0.10.0` |
| 10 | Frontend Svelte 5 + Vite/PWA | ✅ `0.11.0` (auth, painel, contas, transações, categorias, orçamentos, metas, hábitos, investimentos, conquistas, PWA, deploy) |
| 11 | Worker independente: entry point próprio, lease, dead letter e replay | ✅ `0.12.0` |
| 12 | Congelamento da API v1: contrato estável, idempotência de escritas, fila offline | ✅ `1.0.0` |

Detalhes, estimativas e critérios de aceite: [`docs/PLAN.md`](docs/PLAN.md).

---

## 17. Arquivos-chave

| Arquivo | Papel |
|---|---|
| `docs/PLAN.md` | Plano completo aprovado |
| `docs/erDiagram.mmd` | ERD de referência |
| `docs/FRONTEND.md` | Arquitetura, rotas, auth, PWA e deploy do frontend |
| `web/src/App.svelte` | Guards de rota e composição das páginas |
| `web/src/lib/api.ts` | Cliente HTTP, CSRF, refresh e erros |
| `web/src/lib/auth.svelte.ts` | Store de sessão |
| `web/src/lib/router.svelte.ts` | Hash router |
| `web/src/pages/Transactions.svelte` | Lista, filtros e ações de transações |
| `web/src/pages/Budgets.svelte` | Status por mês, progresso e ativação de orçamentos |
| `web/src/pages/Goals.svelte` | Abas por status, progresso, pausa, cancelamento e contribuições |
| `web/src/components/GoalFormModal.svelte` | Criação/edição de metas (moeda travada após contribuições) |
| `web/src/components/GoalDetailModal.svelte` | Progresso e histórico de contribuições |
| `web/src/pages/Habits.svelte` | Abas de hábitos e gatilhos, check-in e sequências |
| `web/src/components/HabitFormModal.svelte` | Criação/edição de hábitos (tipo, frequência, dias e pai) |
| `web/src/components/HabitDetailModal.svelte` | Streak, calendário mensal e registros |
| `web/src/components/TriggerFormModal.svelte` | Criação/edição de gatilhos de substituição |
| `web/src/pages/Investments.svelte` | Carteira, posições e ativos |
| `web/src/components/InvestmentFormModal.svelte` | Criação/edição de ativos (moeda travada) |
| `web/src/components/InvestmentDetailModal.svelte` | Performance, operações e cotações |
| `web/src/pages/Achievements.svelte` | Catálogo, progresso, abas por status e busca |
| `web/src/pages/Recurring.svelte` | Recorrências ativas/pausadas, projeção e run-now |
| `web/src/components/RecurringFormModal.svelte` | Criação/edição de recorrências |
| `web/src/pages/Notifications.svelte` | Central de notificações com abas e paginação |
| `web/src/components/NotificationBell.svelte` | Botão do sino com badge de não lidas |
| `web/src/components/NotificationPanel.svelte` | Painel/bottom sheet das notificações recentes |
| `web/src/lib/notifications.svelte.ts` | Store do sino, polling e tradução de links |
| `web/src/lib/push.svelte.ts` | Opt-in de push, assinatura, reconciliação e revogação |
| `web/src/lib/offline-queue.ts` | Fila de mutações em IndexedDB com snapshot de CSRF |
| `web/src/sw.ts` | Service worker: precache, push, Background/Periodic Sync e badge |
| `web/tsconfig.sw.json` | Typecheck do service worker (lib `webworker`) |
| `web/src/pages/Insights.svelte` | Insights, filtros, busca, leitura e feedback |
| `web/src/pages/Data.svelte` | Importação CSV/OFX (prévia/commit) e exportação |
| `web/src/pages/Family.svelte` | Convites, vínculo ativo e resumo do parceiro |
| `web/src/components/FamilyInviteModal.svelte` | Convite familiar por e-mail |
| `web/src/components/BudgetFormModal.svelte` | Criação/edição de orçamentos |
| `web/src/components/TransactionFormModal.svelte` | Criação/edição de transações e transferências |
| `web/src/app.css` | Design system, tema e responsividade |
| `web/nginx.conf` | SPA fallback, proxy da API, CSP e cache |
| `web/Dockerfile` | Build do SPA + runtime Nginx não-root |
| `compose.yaml` | API + frontend com volumes, healthchecks e rede |
| `CHANGELOG.md` | Histórico de mudanças (Keep a Changelog) |
| `deno.json` | Runtime, imports, tasks, versão (SemVer) |
| `src/config.ts` | Configuração validada com Zod |
| `src/db/client.ts` | Conexão SQLite + extensão vetorial |
| `src/db/migrate.ts` | Runner de migrações forward-only |
| `src/db/maintenance.ts` | Limpeza operacional (sessões, outbox, IPs, embeddings, push revogado) |
| `src/db/backup.ts` | Backup consistente com `VACUUM INTO` |
| `src/db/backup-cli.ts` | CLI `deno task db:backup` |
| `src/app.ts` | Factory do Hono |
| `src/main.ts` | Bootstrap da aplicação |
| `src/shared/crypto/vapid.ts` | Parse do JWK VAPID e `applicationServerKey` |
| `scripts/generate-vapid.ts` | CLI `deno task push:keys` |
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
| `src/modules/notifications/notifications.push.repository.ts` | Assinaturas e claim/lease da entrega push |
| `src/modules/notifications/notifications.push.dispatcher.ts` | Loop de entrega, retry e revogação em 404/410 |
| `src/modules/notifications/notifications.push.sender.ts` | Wrapper de `jsr:@negrel/webpush` |
| `src/modules/notifications/notifications.push.service.ts` | Regras de inscrição e aviso de teste |
| `src/modules/notifications/notifications.push.controller.ts` | Rotas `/notifications/push` |
| `src/modules/insights/` | Insights da IA, leitura, contagem, busca e feedback |
| `src/modules/import/` | Parsers CSV/OFX, preview, dedupe e commit idempotente |
| `src/modules/export/` | Bundle JSON completo e CSV de transações |
| `src/modules/family/` | Convites, vínculo familiar e resumo agregado do parceiro |
| `src/modules/security/` | Bloqueio de IP acionado pelas tools |
| `src/events/event-publisher.ts` | Publicação no outbox (opt-in e IA ligada) |
| `src/events/event-registry.ts` | Catálogo de tipos, pipeline e validação de payload |
| `src/events/outbox.repository.ts` | Claim com lease, rename, replay e estatísticas |
| `src/events/replay-cli.ts` | CLI `deno task outbox:replay` |
| `src/worker/main.ts` | Entry point do worker independente |
| `src/worker/runtime.ts` | Polling, lease/heartbeat, concorrência e shutdown |
| `src/worker/backoff.ts` | Backoff exponencial com jitter |
| `src/worker/errors.ts` | Classificação de falhas transitórias x permanentes |
| `src/ai/ai.processor.ts` | Orquestração de contexto, provider, parser e executor |
| `src/ai/ai.runtime.ts` | Factories de embeddings e do pipeline de IA |
| `src/ai/ai.executor.ts` | Validação, confiança, cooldown, dedupe e auditoria |
| `src/ai/ai.redaction.ts` | Redação de PII antes do provider |
| `src/ai/embeddings.service.ts` | Indexação assíncrona e busca vetorial |
| `src/ai/ai.correlation.ts` | Padrões cross-domain e scheduler |
| `src/http/middleware/ip-blocklist.ts` | Enforcement da blocklist de IP |
| `src/http/middleware/achievement-evaluation.ts` | Avaliação após mutações autenticadas |
| `src/db/migrations/` | Migrações SQL numeradas |
| `bin/sqlite-vector/` | Binários de fallback da extensão vetorial |
| `compose.yaml` | Deploy local/host em um comando (build, volumes, healthcheck) |
| `Dockerfile` | Imagem multi-stage não-root |
| `.github/workflows/ci.yml` | CI (qualidade, cobertura + build Docker) |
| `tests/helpers/server.ts` | Servidor real em porta aleatória + cliente com cookie jar |
| `tests/e2e/` | Fluxo completo e reuso de refresh token |
| `docs/API.md` | Convenções, auth, erros e grupos de rotas |
| `docs/DEPLOY.md` | Deploy, backup, restore, manutenção e checklist |
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
