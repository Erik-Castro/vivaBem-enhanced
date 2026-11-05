# Changelog

Todas as mudanças notáveis deste projeto são documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Added

- Nada ainda.

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
