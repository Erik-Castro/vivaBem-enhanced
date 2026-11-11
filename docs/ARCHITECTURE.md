# Arquitetura

## Camadas

```text
HTTP (Hono)
  └─ controller  → valida Zod, documenta OpenAPI, define cookies/status
       └─ service → regras de negócio, transações, eventos
            └─ repository → SQL preparado, mapeia snake_case ↔ camelCase
```

- Controller não conhece SQL.
- Service não conhece `Request`/`Response`.
- Repository não conhece HTTP.

## Injeção de dependências

Não existe `getDb()` global. A aplicação é criada por uma factory:

```ts
const app = createApp({ db, config, logger });
```

- `src/config.ts` é o único lugar que lê `Deno.env`.
- Testes criam um SQLite temporário por teste (`tests/helpers/db.ts`).
- `createApp` não abre banco, não roda migração e não escuta porta.

## Processos

A aplicação tem dois entry points independentes que compartilham apenas o
arquivo SQLite:

```text
src/main.ts          API HTTP (Hono) — dona do schema
src/worker/main.ts   worker do outbox — sem porta HTTP
```

- A API roda migrações, seed, catch-up de recorrências, manutenção e o servidor.
  Ela publica eventos no outbox, mas não os consome.
- O worker abre a própria conexão (`WAL` + `busy_timeout`) e consome apenas
  `event_outbox`. Ele não migra: `assertSchemaCurrent` falha no boot se a API
  ainda não aplicou o schema, evitando processar eventos com colunas ausentes.
- Com `AI_ENABLED=false` o worker registra `worker_disabled` e encerra com
  código 0; a API continua funcionando sem ele.
- Nem toda chamada de IA está fora da transação de escrita: o worker processa
  eventos **depois** do commit da regra de negócio, nunca dentro dela.

### Ciclo de vida do worker

1. `recoverExpired` devolve eventos cujo lease venceu para `pending` (ou
   `dead_letter` quando as tentativas acabaram) antes de cada ciclo.
2. `claimNext` faz um único `UPDATE ... RETURNING`, grava `lease_token`,
   `lease_expires_at` e incrementa `attempts`.
3. O processamento renova o lease por heartbeat. Se o processo perder a posse
   (token diferente), `complete`/`fail` retornam sem efeito e o evento será
   recuperado pelo próximo worker.
4. Falha transitória volta para `pending` com backoff exponencial (5s até
   5min) e jitter; falha permanente ou tentativas esgotadas vão para
   `dead_letter`.
5. `SIGINT`/`SIGTERM` param o loop e aguardam até `WORKER_SHUTDOWN_GRACE_MS`;
   o que não terminar a tempo é abandonado e recuperado por lease.
6. `deno task outbox:replay` lista e reenfileira eventos terminais de forma
   auditável (`replay_count`/`replayed_at`).

A entrega é **pelo menos uma vez**. Nenhum handler assume execução única:
insights e notificações deduplicam por `dedupe_key`, e a outbox garante que o
evento só nasce depois do commit da regra de negócio.

## Banco

- SQLite com `better-sqlite3` (síncrono) e `sqlite-vector`.
- Pragmas por conexão: `foreign_keys=ON`, `busy_timeout=5000`,
  `synchronous=NORMAL`, `journal_mode=WAL` (arquivo).
- Migrações em `src/db/migrations/NNN_nome.sql`, forward-only, com checksum
  SHA-256 e transação por migração.
- Dinheiro em inteiro de menor unidade (`amount_minor`) + `currency_code`.
- IDs UUIDv7; timestamps UTC ISO-8601; datas de negócio `YYYY-MM-DD`.

## Vetores

O binário do `sqlite-vector` é resolvido em três níveis
(`src/db/vector-extension.ts`):

1. `VECTOR_EXTENSION_PATH`;
2. pacote npm da plataforma;
3. fallback embutido em `bin/sqlite-vector/`.

`vector_init(...)` é chamado de forma preguiçosa quando o runtime de IA está
habilitado e a tabela `embedding_items` existe (Fase 7).

## Erros

- `AppError` + taxonomia em `src/http/errors.ts`.
- Resposta: `{ error: { code, message, details?, requestId } }`.
- Erros 5xx nunca expõem stack ou detalhes internos.
- `requestId` vem de `X-Request-Id` (validado) ou é gerado como UUIDv7.

## Observabilidade

- Logs JSON em stdout/stderr, com redação de senhas, tokens, cookies e chaves.
- `GET /health` (liveness) e `GET /ready` (banco + migrações).
- Shutdown gracioso em `SIGINT`/`SIGTERM`: para o servidor, checkpoint do WAL e
  fecha o banco.
- Manutenção operacional no boot e a cada 24h: sessões expiradas, eventos de
  outbox concluídos com mais de 30 dias, bloqueios de IP vencidos e embeddings
  órfãos. Nunca remove dados de domínio do usuário.

## Segurança HTTP

- Security headers em todas as respostas:
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`, `Cross-Origin-Resource-Policy`,
  `Cross-Origin-Opener-Policy` e `X-Permitted-Cross-Domain-Policies`.
- CSP `default-src 'none'` nas respostas de API; `/api/docs` fica sem CSP para o
  Swagger UI funcionar.
- `Cache-Control: no-store` em respostas de API.
- HSTS em produção (atrás de HTTPS).
- CORS restrito a `APP_ORIGIN` com `credentials: true`.
- Limite de corpo: 1 MB.
- Cookies `HttpOnly`, `SameSite=Lax`, `Secure` em produção.
- CSRF double-submit + validação de Origin.
- Rate limit por IP, por e-mail e limites próprios para importação/exportação.

## Eventos e IA (Fase 7 + Fase 11)

O evento nasce no **outbox** dentro da mesma transação da regra de negócio. O
consumidor é o **worker independente** (`src/worker/`), que faz claim atômico
com lease, aplica backoff com jitter e move para dead letter após
`WORKER_MAX_ATTEMPTS` (falhas permanentes vão direto). O LLM não consulta o
banco: métricas são calculadas em SQL e enviadas como contexto; o modelo só
sugere tool calls, que passam pelo executor com validação, autorização e
auditoria.

```text
API (transação) → event_outbox ──→ worker (claim/lease)
                                      ├─ registry (tipo + payload)
                                      ├─ context builder (SQL)
                                      ├─ provider + parser (Zod)
                                      ├─ executor (tools + audit)
                                      └─ insights / notifications (dedupe)
```

Separar os processos permite escalar/reiniciar o consumidor sem derrubar a API
e impede que um provider lento bloqueie requisições HTTP. O custo é um segundo
processo no deploy e a exigência de que ambos usem o mesmo arquivo SQLite —
`SQLite` continua single-writer e o worker não substitui a API como dona do
schema.
