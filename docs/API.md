# API

Base: `/api/v1`. A especificação completa e sempre atualizada está em
`GET /api/v1/openapi.json` (OpenAPI 3.1); a interface interativa em `/api/docs`.

## Convenções

- Sucesso: `{ "data": ..., "meta": ... }`.
- Erro: `{ "error": { "code", "message", "details", "requestId" } }`.
- Paginação: `?limit=50&offset=0` (máximo 100) com `meta.hasMore`.
- Datas de negócio: `YYYY-MM-DD`; timestamps: ISO-8601 UTC.
- Dinheiro: inteiro em minor units (`amountMinor`) + `currencyCode`, nunca
  `float`.
- IDs: UUIDv7 em texto.
- `X-Request-Id` é devolvido em toda resposta (gerado quando ausente).
- Respostas de API usam `Cache-Control: no-store` e CSP restritiva; o Swagger
  UI em `/api/docs` fica fora da CSP para funcionar.

## Códigos de erro

`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`,
`RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `AI_DISABLED`, `PUSH_DISABLED`,
`INTERNAL_ERROR`.

`AI_DISABLED` e `PUSH_DISABLED` são `503`: a instalação desligou o recurso, não
é erro de contrato nem de cliente.

## Autenticação

Fluxo por cookies, sem tokens no corpo:

1. `GET /api/v1/auth/csrf` define `vb_csrf` (legível pelo JS).
2. `POST /api/v1/auth/register` ou `/login` define `vb_access` (JWT, 15 min) e
   `vb_refresh` (opaco, 30 dias), ambos `HttpOnly`.
3. Requisições mutáveis enviam `X-CSRF-Token` com o valor de `vb_csrf` e são
   validadas também por `Origin`/`Sec-Fetch-Site`.
4. `POST /api/v1/auth/refresh` rotaciona o refresh token. Reutilizar um token já
   rotacionado revoga a família inteira e registra `auth_events`.
5. `POST /api/v1/auth/logout` revoga a sessão, limpa cookies e responde `204`.

Rate limit: autenticação usa `RATE_LIMIT_AUTH_MAX` (5/min por IP e por e-mail);
importação/exportação usam `RATE_LIMIT_DATA_MAX` (30/min por IP). Respostas
limitadas trazem `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `Retry-After`.

## Grupos de rotas

| Grupo | Prefixo | Exemplos |
| --- | --- | --- |
| Identidade | `/auth`, `/me` | registro, login, refresh, perfil, sessões |
| Finanças | `/accounts`, `/categories`, `/transactions` | contas, cartões, extrato, resumo, transferência |
| Planejamento | `/recurring`, `/budgets`, `/goals` | recorrências, orçamentos, metas |
| Hábitos | `/habits`, `/habit-triggers` | logs, streaks, calendário, gatilhos |
| Investimentos | `/investments` | ativos, operações, cotações, carteira |
| Engajamento | `/achievements`, `/notifications` | catálogo, progresso, leitura |
| IA | `/insights` | leitura, busca e feedback de insights |
| Dados | `/import`, `/export` | CSV/OFX e bundle JSON/CSV |
| Colaboração | `/family` | convites e resumo agregado |
| Push | `/notifications/push` | chave VAPID, dispositivos e aviso de teste |

A análise de IA é assíncrona: a escrita responde sem esperar o provider e o
evento é consumido pelo worker independente (`src/worker/`). Por isso um insight
pode aparecer alguns segundos depois da transação; `AI_ENABLED=false` ou o
opt-out do usuário simplesmente não gera evento.

A lista completa de endpoints e schemas está em `/api/v1/openapi.json` e no
[`README`](../README.md).

## Importação e exportação

- `POST /api/v1/import/preview` e `/commit` recebem `multipart/form-data` com
  `accountId` e `file` (CSV ou OFX, até 1 MB e 5.000 linhas).
- O formato é detectado pelo conteúdo, nunca pela extensão.
- Reimportar o mesmo arquivo é idempotente (`import_hash` por conta).
- `GET /api/v1/export?format=json|csv` devolve os dados do usuário autenticado;
  hashes de senha/refresh e vetores de embedding nunca entram no bundle.

## Push

- `GET /api/v1/notifications/push/key` devolve `{ enabled, publicKey }`; a chave
  é o ponto P-256 não comprimido em base64url para
  `PushManager.subscribe({ applicationServerKey })`.
- `POST /api/v1/notifications/push/subscriptions` registra o dispositivo
  (`endpoint` + `keys.p256dh`/`keys.auth`). O índice único é parcial no
  `endpoint` entre linhas vivas, então o mesmo navegador que troca de conta
  reatribui a assinatura em vez de duplicá-la.
- `GET` lista os dispositivos vivos; `DELETE` (com `endpoint` no corpo) revoga.
  Endpoint de outro usuário responde `404`, nunca `403`.
- `POST /api/v1/notifications/push/test` grava uma notificação normal e responde
  `202`; a entrega é feita pelo worker, não pela API.
- Com `PUSH_ENABLED=false` as rotas de escrita respondem `PUSH_DISABLED` (503) e
  a chave vem `disabled` com `publicKey: null`.
- A entrega é at-least-once com claim/lease na própria linha de `notifications`
  (`push_state`); `404`/`410` do serviço de push revogam a assinatura, falhas
  transitórias tentam de novo até `PUSH_MAX_ATTEMPTS`.

## Saúde

- `GET /health`: liveness com versão e uptime.
- `GET /ready`: banco acessível e schema atual; responde 503 quando o banco está
  inacessível ou atrás das migrações do código (`checks.schema`).

## Versionamento

Adições opcionais e retrocompatíveis podem entrar em `/api/v1`. Remoções,
renomeações ou quebras de contrato exigem `/api/v2` e release MAJOR.
