import type { AppDatabase } from "../../db/client.ts";
import { AppError } from "../../http/errors.ts";
import { sha256Hex } from "../../shared/crypto/tokens.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";
import type { EventPublisher } from "../../events/event-publisher.ts";
import type { Account, AccountsRepository } from "../accounts/accounts.repository.ts";
import type { ParsedImportRow } from "./import.parsers.ts";
import { MAX_IMPORT_ROWS, parseImport } from "./import.parsers.ts";
import type {
  ImportCommitResult,
  ImportPreview,
  ImportPreviewRow,
  ImportUpload,
} from "./import.types.ts";
import type { TransactionsRepository } from "../transactions/transactions.repository.ts";

/** O preview não devolve milhares de linhas; os totais continuam completos. */
const MAX_PREVIEW_ROWS = 500;
const MAX_FILE_BYTES = 1024 * 1024;

export interface ImportServiceDependencies {
  readonly db: AppDatabase;
  readonly accounts: AccountsRepository;
  readonly transactions: TransactionsRepository;
  readonly events?: EventPublisher;
  readonly now?: () => Date;
}

export class ImportService {
  readonly #db: AppDatabase;
  readonly #accounts: AccountsRepository;
  readonly #transactions: TransactionsRepository;
  readonly #events: EventPublisher | null;
  readonly #now: () => Date;

  constructor(dependencies: ImportServiceDependencies) {
    this.#db = dependencies.db;
    this.#accounts = dependencies.accounts;
    this.#transactions = dependencies.transactions;
    this.#events = dependencies.events ?? null;
    this.#now = dependencies.now ?? (() => new Date());
  }

  async preview(userId: string, upload: ImportUpload): Promise<ImportPreview> {
    const account = this.#requireAccount(userId, upload.accountId);
    const content = assertContent(upload.content);
    const parsed = parseImport(content, account.type);
    const hashes = await hashRows(account.id, parsed.rows);
    const existing = this.#transactions.existingImportHashes(account.id);

    const seen = new Set<string>();
    let newRows = 0;
    const rows: ImportPreviewRow[] = [];

    parsed.rows.forEach((row, index) => {
      const importHash = hashes[index] as string;
      const duplicate = existing.has(importHash) || seen.has(importHash);
      seen.add(importHash);
      if (!duplicate) newRows++;

      if (rows.length < MAX_PREVIEW_ROWS) {
        rows.push({ ...row, importHash, duplicate });
      }
    });

    return {
      accountId: account.id,
      currencyCode: account.currencyCode,
      fileName: upload.fileName,
      format: parsed.format,
      totalRows: parsed.rows.length + parsed.errors.length,
      validRows: parsed.rows.length,
      newRows,
      duplicateRows: parsed.rows.length - newRows,
      rows,
      errors: parsed.errors,
    };
  }

  async commit(userId: string, upload: ImportUpload): Promise<ImportCommitResult> {
    const account = this.#requireAccount(userId, upload.accountId);
    const content = assertContent(upload.content);
    const parsed = parseImport(content, account.type);
    const hashes = await hashRows(account.id, parsed.rows);
    const existing = this.#transactions.existingImportHashes(account.id);

    const now = this.#now().toISOString();
    const importId = uuidv7();
    const transactionIds: string[] = [];
    let skipped = 0;

    this.#db.transaction(() => {
      parsed.rows.forEach((row, index) => {
        const importHash = hashes[index] as string;
        if (existing.has(importHash)) {
          skipped++;
          return;
        }

        const transactionId = uuidv7();
        const inserted = this.#transactions.insertImported({
          id: transactionId,
          accountId: account.id,
          categoryId: null,
          transferGroupId: null,
          type: row.type,
          amountMinor: row.amountMinor,
          currencyCode: account.currencyCode,
          description: row.description,
          transactionDate: row.transactionDate,
          isCleared: false,
          externalId: row.externalId,
          importHash,
          now,
        });

        if (inserted) {
          transactionIds.push(transactionId);
        } else {
          skipped++;
        }
      });

      if (transactionIds.length > 0) {
        this.#events?.publish({
          type: "finance.transaction.imported",
          aggregateType: "import",
          aggregateId: importId,
          userId,
          payload: {
            importId,
            accountId: account.id,
            fileName: upload.fileName,
            format: parsed.format,
            imported: transactionIds.length,
            skipped,
            currencyCode: account.currencyCode,
            transactionIds: transactionIds.slice(0, 200),
          },
        });
      }
    });

    return {
      accountId: account.id,
      currencyCode: account.currencyCode,
      fileName: upload.fileName,
      format: parsed.format,
      imported: transactionIds.length,
      skipped,
      transactionIds,
      errors: parsed.errors,
    };
  }

  #requireAccount(userId: string, accountId: string): Account {
    const account = this.#accounts.findById(userId, accountId);
    if (!account) {
      throw new AppError("NOT_FOUND", "Conta não encontrada");
    }
    if (!account.isActive) {
      throw new AppError("CONFLICT", "Conta inativa não aceita importação");
    }
    return account;
  }
}

function assertContent(content: string): string {
  if (content.length > MAX_FILE_BYTES) {
    throw new AppError("PAYLOAD_TOO_LARGE", "Arquivo de importação excede 1 MB");
  }
  if (content.trim() === "") {
    throw new AppError("VALIDATION_ERROR", "Arquivo de importação vazio");
  }
  return content;
}

async function hashRows(accountId: string, rows: readonly ParsedImportRow[]): Promise<string[]> {
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new AppError("VALIDATION_ERROR", `Limite de ${MAX_IMPORT_ROWS} linhas por arquivo`);
  }

  return await Promise.all(rows.map((row) => {
    // O FITID é único por conta/arquivo; sem ele, a identidade é o conteúdo
    // normalizado da linha. Incluir a conta impede deduplicar entre contas.
    const key = row.externalId !== null
      ? `external|${accountId}|${row.externalId}`
      : `content|${accountId}|${row.transactionDate}|${row.type}|${row.amountMinor}|${
        normalizeKey(row.description)
      }`;
    return sha256Hex(key);
  }));
}

function normalizeKey(description: string | null): string {
  return (description ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
