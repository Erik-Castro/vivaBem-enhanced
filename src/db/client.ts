// @ts-types="npm:@types/better-sqlite3@^7.6.13"
import Database from "better-sqlite3";
import { dirname } from "node:path";
import { resolveVectorExtensionPath } from "./vector-extension.ts";

export interface DatabaseOptions {
  /** Caminho do arquivo SQLite ou `:memory:`. */
  readonly path: string;
  /** Sobrescreve a resolução automática do binário do sqlite-vector. */
  readonly vectorExtensionPath?: string;
  /** Use `false` apenas em ferramentas que não precisam de vetores. */
  readonly loadVectorExtension?: boolean;
}

export interface AppDatabase {
  readonly raw: Database.Database;
  readonly path: string;
  readonly isMemory: boolean;
  readonly vectorEnabled: boolean;
  prepare<BindParameters extends unknown[] = unknown[], Result = unknown>(
    sql: string,
  ): Database.Statement<BindParameters, Result>;
  exec(sql: string): void;
  /** Executa `fn` dentro de uma transação (BEGIN/COMMIT/ROLLBACK). */
  transaction<T>(fn: () => T): T;
  close(): void;
  [Symbol.dispose](): void;
}

/**
 * Abre uma conexão SQLite já configurada.
 *
 * A conexão é sempre criada por esta factory e injetada nos módulos — não
 * existe singleton global. Em `:memory:` não criamos diretório nem usamos WAL.
 */
export function createDatabase(options: DatabaseOptions): AppDatabase {
  const path = options.path;
  const isMemory = path === ":memory:" || path.startsWith("file::memory:");

  if (!isMemory) {
    const directory = dirname(path);
    if (directory !== "." && directory !== "") {
      Deno.mkdirSync(directory, { recursive: true });
    }
  }

  const raw = new Database(path);

  raw.pragma("foreign_keys = ON");
  raw.pragma("busy_timeout = 5000");
  raw.pragma("synchronous = NORMAL");

  if (!isMemory) {
    raw.pragma("journal_mode = WAL");
  }

  let vectorEnabled = false;
  if (options.loadVectorExtension !== false) {
    const extensionPath = options.vectorExtensionPath ?? resolveVectorExtensionPath();
    raw.loadExtension(extensionPath);
    vectorEnabled = true;
  }

  let closed = false;

  function prepare<BindParameters extends unknown[] = unknown[], Result = unknown>(
    sql: string,
  ): Database.Statement<BindParameters, Result> {
    return raw.prepare(sql) as unknown as Database.Statement<BindParameters, Result>;
  }

  const database: AppDatabase = {
    raw,
    path,
    isMemory,
    vectorEnabled,
    prepare,
    exec: (sql) => raw.exec(sql),
    transaction: <T>(fn: () => T): T => raw.transaction(fn)(),
    close: () => {
      if (closed) return;
      closed = true;
      if (!isMemory) {
        try {
          raw.pragma("wal_checkpoint(TRUNCATE)");
        } catch {
          // Melhor esforço: o checkpoint pode falhar se outra conexão estiver ativa.
        }
      }
      raw.close();
    },
    [Symbol.dispose]: () => database.close(),
  };

  return database;
}
