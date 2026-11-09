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
`RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `AI_DISABLED`, `INTERNAL_ERROR`.

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

A lista completa de endpoints e schemas está em `/api/v1/openapi.json` e no
[`README`](../README.md).

## Importação e exportação

- `POST /api/v1/import/preview` e `/commit` recebem `multipart/form-data` com
  `accountId` e `file` (CSV ou OFX, até 1 MB e 5.000 linhas).
- O formato é detectado pelo conteúdo, nunca pela extensão.
- Reimportar o mesmo arquivo é idempotente (`import_hash` por conta).
- `GET /api/v1/export?format=json|csv` devolve os dados do usuário autenticado;
  hashes de senha/refresh e vetores de embedding nunca entram no bundle.

## Saúde

- `GET /health`: liveness com versão e uptime.
- `GET /ready`: banco acessível e contagem de migrações aplicadas.

## Versionamento

Adições opcionais e retrocompatíveis podem entrar em `/api/v1`. Remoções,
renomeações ou quebras de contrato exigem `/api/v2` e release MAJOR.
