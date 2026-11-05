import type { AppDatabase } from "../../db/client.ts";

export interface IpBlock {
  readonly id: string;
  readonly ipAddress: string;
  readonly reason: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface BlockIpRecord {
  readonly id: string;
  readonly ipAddress: string;
  readonly reason: string;
  readonly expiresAt: string;
  readonly now: string;
}

interface IpBlockRow {
  id: string;
  ip_address: string;
  reason: string;
  expires_at: string;
  created_at: string;
}

/**
 * Lista de bloqueio de IP acionada pelas tools de segurança.
 *
 * O bloqueio é sempre temporário: `expires_at` é obrigatório, então nenhum
 * endereço fica banido para sempre por um falso positivo da IA.
 */
export class IpBlocklistRepository {
  readonly #db: AppDatabase;

  constructor(db: AppDatabase) {
    this.#db = db;
  }

  block(record: BlockIpRecord): void {
    this.#db
      .prepare<[string, string, string, string, string]>(
        `INSERT INTO ip_blocklist (id, ip_address, reason, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (ip_address) DO UPDATE SET
           reason = excluded.reason,
           expires_at = excluded.expires_at,
           created_at = excluded.created_at`,
      )
      .run(
        record.id,
        record.ipAddress,
        record.reason,
        record.expiresAt,
        record.now,
      );
  }

  isBlocked(ipAddress: string, now: string): boolean {
    const row = this.#db
      .prepare<[string, string], { id: string }>(
        `SELECT id FROM ip_blocklist
         WHERE ip_address = ? AND expires_at > ?
         LIMIT 1`,
      )
      .get(ipAddress, now);
    return row !== undefined;
  }

  findActive(ipAddress: string, now: string): IpBlock | null {
    const row = this.#db
      .prepare<[string, string], IpBlockRow>(
        `SELECT * FROM ip_blocklist
         WHERE ip_address = ? AND expires_at > ?
         LIMIT 1`,
      )
      .get(ipAddress, now);
    return row === undefined ? null : {
      id: row.id,
      ipAddress: row.ip_address,
      reason: row.reason,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  prune(now: string): number {
    return this.#db
      .prepare<[string]>("DELETE FROM ip_blocklist WHERE expires_at <= ?")
      .run(now).changes;
  }
}
