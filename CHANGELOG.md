# Changelog

Todas as mudanças notáveis deste projeto são documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Added

- Nada ainda.

## [0.3.0] - 2026-11-05

Terceira release: finanças (Fase 2).

### Added

- Migração `002_finance.sql` com `accounts`, `credit_card_details`,
  `categories`, `transactions` e `credit_card_transactions`, com índices e
  constraints de integridade.
- `GET/POST /api/v1/accounts`, `GET/PATCH/DELETE /api/v1/accounts/{id}`,
  `GET /api/v1/accounts/{id}/balance` e
  `GET /api/v1/accounts/{id}/transactions`.
- Contas com moeda herdada da preferência do usuário, cartão de crédito com
  fechamento, vencimento, limite e limite disponível calculado.
- `GET/POST /api/v1/categories`, `GET /api/v1/categories/tree` e
  `GET/PATCH/DELETE /api/v1/categories/{id}`.
- Árvore de categorias com validação de tipo do pai, prevenção de ciclos e
  desativação recursiva da subárvore.
- `GET/POST /api/v1/transactions`, `GET/PATCH/DELETE /api/v1/transactions/{id}`,
  `POST /api/v1/transactions/{id}/clear`, `POST /api/v1/transactions/transfer`
  e `GET /api/v1/transactions/summary`.
- Transferências atômicas com duas pernas assinadas e `transfer_group_id`.
- Parcelamentos em cartão de crédito com divisão exata de centavos, datas
  ajustadas ao fim do mês e remoção do grupo inteiro.
- Resumo por moeda e categoria, excluindo transferências.
- Soft delete de transações via `deleted_at`, com remoção em cascata de
  transferências e parcelamentos.
- Filtros e paginação (`limit`/`offset`, máximo 100) no extrato.
- Testes unitários de datas de negócio e 14 testes de integração de finanças
  (82 testes no total).
- ADRs 010–012 sobre transferências, parcelamentos e imutabilidade de moeda.

### Changed

- `src/app.ts` monta os módulos de contas, categorias e transações atrás de
  `requireAuth`.
- OpenAPI ganhou as tags `Accounts`, `Categories` e `Transactions`.
- README e `AGENTS.md` atualizados para a Fase 2.

### Security

- Toda query financeira é escopada pelo `user_id` da sessão; nenhuma rota
  aceita `userId` do cliente.
- Valores monetários são inteiros em minor units e validados na borda.

## [0.2.0] - 2026-11-05

Segunda release: identidade e autenticação (Fase 1).

### Added

- `POST /api/v1/auth/register`, `/login`, `/refresh` e `/logout`.
- `GET /api/v1/auth/csrf` para bootstrap do token CSRF.
- Access token JWT HS256 em cookie `vb_access` (HttpOnly, SameSite=Lax, 15 min).
- Refresh token opaco de 32 bytes em cookie `vb_refresh` (HttpOnly, Path
  `/api/v1/auth`, 30 dias), com rotação de uso único.
- Detecção de reuso de refresh: revoga a família inteira e registra
  `auth_events.type = reuse_detected`.
- Logout revoga a sessão, limpa cookies e invalida o access token de imediato.
- CSRF double-submit (`vb_csrf` + `X-CSRF-Token`) e validação de
  `Origin`/`Sec-Fetch-Site`.
- Rate limit de janela deslizante por IP e por e-mail, com headers
  `X-RateLimit-*` e `Retry-After`.
- Hash Argon2id com parâmetros configuráveis e hash fictício para e-mails
  inexistentes (tempo de resposta uniforme).
- `GET/PATCH /api/v1/me`, `PATCH /api/v1/me/preferences`,
  `GET /api/v1/me/sessions` e `DELETE /api/v1/me/sessions/{id}`.
- Auditoria em `auth_events` para login, falha, refresh, logout e reuso.
- Security scheme `cookieAuth` no OpenAPI e rotas protegidas documentadas.
- Testes unitários de JWT, tokens e rate limiter; testes HTTP do fluxo
  completo de autenticação (62 testes no total).

### Changed

- `RATE_LIMIT_AUTH_MAX` e `RATE_LIMIT_WINDOW` adicionados à configuração.
- README e `AGENTS.md` atualizados para a Fase 1.

### Security

- Cookies `Secure` em produção e `SameSite=Lax` em todos os ambientes.
- Respostas de login não revelam se o e-mail existe.
- Rotas mutáveis exigem CSRF mesmo para clientes não-browser.

## [0.1.0] - 2026-11-05

Primeira release: fundação da API (Fase 0).

### Added

- Bootstrap Deno 2.9 + TypeScript strict + Hono 4 + Zod 4 + `@hono/zod-openapi`.
- Configuração de ambiente validada com Zod em `src/config.ts`, única leitora de
  `Deno.env`; falha no boot em caso de valores inválidos e exige `JWT_SECRET` em
  produção.
- Logger JSON com redação de senhas, tokens, cookies e chaves de API.
- Taxonomia de erros (`AppError`) e envelope de erro
  `{ error: { code, message, details?, requestId } }`.
- Middlewares de `X-Request-Id`, log de requisição, limite de corpo (1 MB),
  headers de segurança e CORS restrito a `APP_ORIGIN`.
- Conexão SQLite com `better-sqlite3`, pragmas (`foreign_keys`, `busy_timeout`,
  `synchronous`, WAL) e transações.
- Integração com `sqlite-vector`, com resolução do binário em três níveis
  (`VECTOR_EXTENSION_PATH`, pacote npm da plataforma, fallback em `bin/`).
- Runner de migrações forward-only com checksum SHA-256, transação por migração
  e detecção de checksum divergente.
- Migração `001_core.sql`: perfis, credenciais, preferências, sessões e eventos
  de autenticação.
- Factory `createApp({ db, config, logger })` sem singleton global e sem efeitos
  colaterais de I/O.
- Rotas `GET /health`, `GET /ready`, `GET /api/v1/openapi.json` (OpenAPI 3.1) e
  `GET /api/docs` (Swagger UI).
- CLIs `db:migrate`, `db:reset` e `db:backup` (`VACUUM INTO`).
- Encerramento gracioso em `SIGINT`/`SIGTERM`, com checkpoint do WAL.
- Suíte de testes (unitários e de integração) com SQLite real em diretório
  temporário.
- Dockerfile multi-stage, não-root, com volume `/app/data` e healthcheck;
  `.dockerignore` e workflow de CI.
- Documentação: `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` e
  `docs/DEPLOY.md`.
- Binários do `sqlite-vector` 1.2.0 para Linux (x86_64/arm64, glibc/musl),
  com licença Apache-2.0.

### Changed

- Projeto reescrito do zero a partir de `reference_only/` (somente leitura),
  preservando o domínio e corrigindo as dívidas técnicas do legado.
- Dinheiro passa a usar inteiro de menor unidade (`amount_minor`) +
  `currency_code`, em vez de `REAL`.
- Banco injetado por dependência, substituindo o singleton `getDb()`.
- Importações de Hono unificadas em `npm:hono` para evitar duplicidade de tipos
  com `@hono/zod-openapi`.

### Security

- Cookies `HttpOnly`/`SameSite=Lax` e rotação de refresh com detecção de reuso
  ficam preparados no schema para a Fase 1.
- Nenhum segredo possui valor padrão em produção; em desenvolvimento um segredo
  efêmero é gerado no boot com aviso explícito.
- Erros 5xx não expõem stack trace nem detalhes internos.

<!--
Ao definir o repositório remoto, adicione os links de comparação:

[Unreleased]: https://github.com/ORG/REPO/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ORG/REPO/releases/tag/v0.1.0
-->
