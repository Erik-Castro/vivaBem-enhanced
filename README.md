# Viva Bem

App de finanças pessoais + construção de hábitos, com análise assíncrona por IA. Este repositório é
uma reescrita greenfield, **API-first**, a partir do projeto legado em `reference_only/` (somente
leitura).

- **Plano completo:** [`docs/PLAN.md`](docs/PLAN.md)
- **Guia de contribuição/agentes:** [`AGENTS.md`](AGENTS.md)
- **Changelog:** [`CHANGELOG.md`](CHANGELOG.md)

## Stack

| Camada            | Tecnologia                                         |
| ----------------- | -------------------------------------------------- |
| Runtime           | Deno 2.9                                           |
| HTTP              | Hono 4                                             |
| Validação/OpenAPI | Zod 4 + `@hono/zod-openapi` (OpenAPI 3.1)          |
| Banco             | SQLite (`better-sqlite3`) + `sqlite-vector`        |
| Auth              | Argon2id + access JWT em cookie + refresh rotativo |
| Testes            | `Deno.test` + `@std/assert`                        |

## Requisitos

- Deno **2.9.8** ou superior
- Docker (opcional, para deploy)

`better-sqlite3` é um addon nativo: as tasks já incluem `--allow-ffi` e `--allow-sys`.

## Quick start

```bash
cp .env.example .env
deno install
deno task dev
```

Servidor em `http://localhost:3000`:

| Rota                       | Descrição                     |
| -------------------------- | ----------------------------- |
| `GET /health`              | Liveness                      |
| `GET /ready`               | Readiness (banco + migrações) |
| `GET /api/v1/openapi.json` | Documento OpenAPI 3.1         |
| `GET /api/docs`            | Swagger UI                    |

O banco é criado em `./data/app.db` e as migrações rodam no boot.

## Comandos

```bash
deno task dev            # servidor com watch
deno task start          # servidor
deno task test           # testes
deno task test:coverage  # testes com cobertura
deno task check          # typecheck
deno task lint           # lint
deno task fmt            # formatação
deno task db:migrate     # migrações
deno task db:reset       # apaga e recria o banco
deno task db:backup      # backup em backups/
deno task check:release  # valida versão x changelog
```

Ou use o `Makefile`: `make help`.

## Configuração

Todas as variáveis estão em [`.env.example`](.env.example). Destaques:

| Variável                | Padrão                  | Observação                                   |
| ----------------------- | ----------------------- | -------------------------------------------- |
| `PORT`                  | `3000`                  |                                              |
| `ENV`                   | `development`           | `development`, `test`, `production`          |
| `DATABASE_PATH`         | `./data/app.db`         | Use `/app/data/app.db` no Docker             |
| `APP_ORIGIN`            | `http://localhost:3000` | CORS/CSRF                                    |
| `JWT_SECRET`            | —                       | **Obrigatório em produção** (32+ caracteres) |
| `AI_ENABLED`            | `false`                 | IA é opt-in                                  |
| `VECTOR_EXTENSION_PATH` | —                       | Sobrescreve o binário do `sqlite-vector`     |

Nenhum segredo tem valor padrão em produção. Em dev, um segredo efêmero é gerado no boot (com aviso
no log).

## Docker

```bash
docker build --build-arg VERSION=$(grep -o '"version": *"[^"]*"' deno.json | cut -d'"' -f4) -t vivabem:local .
docker run --rm -p 3000:3000 \
  -v vivabem-data:/app/data \
  -e JWT_SECRET="$(openssl rand -base64 48)" \
  -e APP_ORIGIN="http://localhost:3000" \
  vivabem:local
```

Detalhes de Portainer, backup e restore: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Estrutura

```text
src/
  main.ts          # bootstrap: config → migrações → servidor
  app.ts           # factory do Hono (sem efeitos colaterais)
  config.ts        # env validado com Zod
  version.ts       # versão lida do deno.json
  http/            # erros, OpenAPI, middlewares
  db/              # conexão, migrações, repositórios
  modules/         # domínios (auth, transactions, habits, ...)
  events/          # outbox + worker (Fase 7)
  ai/              # providers, prompts, tools (Fase 7)
  shared/          # logger, crypto, utils
tests/             # unit, integration, e2e
bin/sqlite-vector/ # fallback do binário da extensão vetorial
```

## Versionamento

- [SemVer 2.0.0](https://semver.org/lang/pt-BR/): `MAJOR.MINOR.PATCH`.
- [Keep a Changelog 1.1.0](https://keepachangelog.com/pt-BR/1.1.0/).
- A versão do `deno.json` é a fonte da verdade e aparece em `/health`, no OpenAPI e na label Docker.
- Durante `0.y.z` o contrato ainda pode mudar; `1.0.0` marca o congelamento da API v1.

## Status

Fase 0 (fundação) concluída. Próxima: Fase 1 (identidade e autenticação). Veja o roadmap em
[`AGENTS.md`](AGENTS.md#16-roadmap).
