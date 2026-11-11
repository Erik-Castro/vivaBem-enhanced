import type { AppDatabase } from "./client.ts";
import type { Logger } from "../shared/logger/index.ts";

export interface MigrationFile {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface MigrationResult {
  readonly applied: readonly MigrationFile[];
  readonly total: number;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

const DEFAULT_MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);
const MIGRATION_FILE_PATTERN = /^(\d{3,})_(.+)\.sql$/;

interface AppliedMigrationRow {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

/**
 * Carrega e ordena as migrações. O nome do arquivo define a ordem:
 * `001_core.sql`, `002_finance.sql`, ...
 */
export async function loadMigrations(
  directory: URL = DEFAULT_MIGRATIONS_DIR,
): Promise<MigrationFile[]> {
  const entries: { version: number; name: string }[] = [];

  for await (const entry of Deno.readDir(directory)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const match = MIGRATION_FILE_PATTERN.exec(entry.name);
    if (!match) {
      throw new MigrationError(
        `Nome de migração inválido: ${entry.name} (esperado NNN_nome.sql)`,
      );
    }
    entries.push({ version: Number(match[1]), name: entry.name });
  }

  entries.sort((a, b) => a.version - b.version);

  const seen = new Set<number>();
  for (const entry of entries) {
    if (seen.has(entry.version)) {
      throw new MigrationError(`Versão de migração duplicada: ${entry.version}`);
    }
    seen.add(entry.version);
  }

  const migrations: MigrationFile[] = [];
  for (const entry of entries) {
    const sql = await Deno.readTextFile(new URL(entry.name, directory));
    migrations.push({
      version: entry.version,
      name: entry.name,
      sql,
      checksum: await sha256Hex(sql),
    });
  }

  return migrations;
}

/**
 * Aplica as migrações pendentes. É idempotente: rodar duas vezes não reaplica
 * nada. Checksums divergentes indicam que uma migração já aplicada foi editada
 * — isso é sempre um erro.
 */
export function migrate(
  db: AppDatabase,
  migrations: readonly MigrationFile[],
  logger?: Logger,
): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      execution_time_ms INTEGER NOT NULL
    ) STRICT;
  `);

  const applied = db
    .prepare<[], AppliedMigrationRow>(
      "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
    )
    .all();

  const available = new Map(migrations.map((migration) => [migration.version, migration]));

  for (const row of applied) {
    const file = available.get(row.version);
    if (!file) {
      throw new MigrationError(
        `Migração ${row.version} está aplicada no banco, mas o arquivo não existe mais`,
      );
    }
    if (file.checksum !== row.checksum) {
      throw new MigrationError(
        `Checksum divergente na migração ${row.version} (${row.name}). ` +
          `Migrações já aplicadas são imutáveis; crie uma nova migração.`,
      );
    }
  }

  const appliedVersions = new Set(applied.map((row) => row.version));
  const pending = migrations.filter((migration) => !appliedVersions.has(migration.version));

  const insert = db.prepare<[number, string, string, string, number]>(
    `INSERT INTO schema_migrations (version, name, checksum, applied_at, execution_time_ms)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const executed: MigrationFile[] = [];

  for (const migration of pending) {
    const startedAt = performance.now();

    db.transaction(() => {
      db.exec(migration.sql);
      insert.run(
        migration.version,
        migration.name,
        migration.checksum,
        new Date().toISOString(),
        Math.round(performance.now() - startedAt),
      );
    });

    executed.push(migration);
    logger?.info("migration_applied", {
      version: migration.version,
      name: migration.name,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }

  return { applied: executed, total: migrations.length };
}

export interface SchemaStatus {
  /** `true` quando o banco tem exatamente as migrações fornecidas, com checksums iguais. */
  readonly current: boolean;
  /** Quantas migrações estão aplicadas no banco. */
  readonly applied: number;
  /** Migrações que existem em arquivo mas ainda não foram aplicadas. */
  readonly pending: readonly string[];
  /** Problemas encontrados, na ordem em que bloqueiam o worker. */
  readonly issues: readonly string[];
}

/**
 * Diagnostica o schema sem aplicar nada.
 *
 * Mesma regra de `assertSchemaCurrent`, mas devolve o resultado em vez de
 * lançar — a API usa isso no `/ready` para responder 503 quando o banco está
 * atrás do código em vez de se declarar pronta.
 */
export function inspectSchema(
  db: AppDatabase,
  migrations: readonly MigrationFile[],
): SchemaStatus {
  const schemaTable = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .get();

  if (schemaTable === undefined) {
    return {
      current: false,
      applied: 0,
      pending: migrations.map((migration) => migration.name),
      issues: [
        "Banco não migrado: inicie a API (`deno task db:migrate`) antes do worker",
      ],
    };
  }

  const applied = db
    .prepare<[], AppliedMigrationRow>(
      "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
    )
    .all();
  const available = new Map(migrations.map((migration) => [migration.version, migration]));
  const appliedVersions = new Set(applied.map((row) => row.version));
  const issues: string[] = [];

  for (const row of applied) {
    const file = available.get(row.version);
    if (!file) {
      issues.push(
        `Migração ${row.version} está aplicada no banco, mas o arquivo não existe mais`,
      );
    } else if (file.checksum !== row.checksum) {
      issues.push(`Checksum divergente na migração ${row.version} (${row.name})`);
    }
  }

  const pending = migrations
    .filter((migration) => !appliedVersions.has(migration.version))
    .map((migration) => migration.name);

  if (pending.length > 0) {
    issues.push(
      `Schema desatualizado: inicie a API para aplicar ${pending.join(", ")} antes do worker`,
    );
  }

  return { current: issues.length === 0, applied: applied.length, pending, issues };
}

/**
 * Verifica se o banco está exatamente no schema esperado, sem aplicar nada.
 *
 * O worker não migra: dono das migrações é a API. Se a API ainda não subiu com a
 * versão atual, o worker falha no boot com uma mensagem acionável em vez de
 * processar eventos com colunas ausentes.
 *
 * @throws {MigrationError} quando falta migração, sobra migração ou o checksum
 * diverge.
 */
export function assertSchemaCurrent(
  db: AppDatabase,
  migrations: readonly MigrationFile[],
): void {
  const status = inspectSchema(db, migrations);

  if (!status.current) {
    throw new MigrationError(status.issues[0] ?? "Schema inválido");
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
