import { dirname, join } from "node:path";
import type { AppDatabase } from "./client.ts";

export interface BackupOptions {
  /** Diretório de destino; criado se não existir. */
  readonly directory?: string;
  readonly now?: Date;
}

/**
 * Cria um backup consistente usando `VACUUM INTO`.
 *
 * Diferente de copiar o arquivo, `VACUUM INTO` lê um snapshot consistente do
 * banco, o que funciona mesmo com o WAL ativo e com a aplicação escrevendo.
 */
export function backupDatabase(db: AppDatabase, options: BackupOptions = {}): string {
  const timestamp = (options.now ?? new Date())
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
  const target = join(options.directory ?? "backups", `app-${timestamp}.db`);

  Deno.mkdirSync(dirname(target), { recursive: true });
  // O caminho do SQLite não aceita bind em `VACUUM INTO`; escapamos aspas.
  db.raw.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);

  return target;
}
