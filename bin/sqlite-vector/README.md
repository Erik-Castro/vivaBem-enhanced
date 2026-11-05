# Binários de extensões SQLite

Estes binários são o fallback do `sqlite-vector` quando o pacote opcional da
plataforma não é instalado pelo Deno (ver `src/db/vector-extension.ts`).

| Diretório | Origem |
|---|---|
| `linux-x86_64/` | `@sqliteai/sqlite-vector-linux-x86_64@1.2.0` |
| `linux-x86_64-musl/` | `@sqliteai/sqlite-vector-linux-x86_64-musl@1.2.0` |
| `linux-arm64/` | `@sqliteai/sqlite-vector-linux-arm64@1.2.0` |
| `linux-arm64-musl/` | `@sqliteai/sqlite-vector-linux-arm64-musl@1.2.0` |

- Projeto: <https://github.com/sqliteai/sqlite-vector>
- Licença: Apache-2.0 (ver `LICENSE.md`)
- Versão: 1.2.0

Para atualizar, copie o `vector.so` da versão correspondente do pacote npm.
Defina `VECTOR_EXTENSION_PATH` para usar outro binário sem alterar o repositório.
