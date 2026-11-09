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

## Eventos e IA (Fase 7)

O evento nasce no **outbox** dentro da mesma transação da regra de negócio. Um
worker faz claim atômico com lease, aplica backoff e move para dead-letter após
`AI_MAX_RETRIES`. O LLM não consulta o banco: métricas são calculadas em SQL e
enviadas como contexto; o modelo só sugere tool calls, que passam pelo executor
com validação, autorização e auditoria.
