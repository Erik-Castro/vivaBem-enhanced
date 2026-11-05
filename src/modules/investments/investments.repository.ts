import type { AppDatabase } from "../../db/client.ts";
import type { InvestmentOperationType } from "./investments.performance.ts";

export interface Investment {
  readonly id: string;
  readonly userId: string;
  readonly ticker: string;
  readonly name: string;
  readonly assetClass: string;
  readonly currencyCode: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface InvestmentRow {
  id: string;
  user_id: string;
  ticker: string;
  name: string;
  asset_class: string;
  currency_code: string;
  created_at: string;
  updated_at: string;
}

export interface InvestmentTransaction {
  readonly id: string;
  readonly investmentId: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly operationType: InvestmentOperationType;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly feesMinor: number;
  readonly operationDate: string;
  readonly createdAt: string;
}

interface InvestmentTransactionRow {
  id: string;
  investment_id: string;
  account_id: string;
  operation_type: InvestmentOperationType;
  quantity: number;
  unit_price_minor: number;
  fees_minor: number;
  operation_date: string;
  created_at: string;
  account_name: string;
}

export interface InvestmentQuote {
  readonly id: string;
  readonly investmentId: string;
  readonly priceMinor: number;
  readonly quotedAt: string;
  readonly source: string | null;
  readonly createdAt: string;
}

interface InvestmentQuoteRow {
  id: string;
  investment_id: string;
  price_minor: number;
  quoted_at: string;
  source: string | null;
  created_at: string;
}

export interface CreateInvestmentRecord {
  readonly id: string;
  readonly userId: string;
  readonly ticker: string;
  readonly name: string;
  readonly assetClass: string;
  readonly currencyCode: string;
  readonly now: string;
}

export interface UpdateInvestmentRecord {
  readonly id: string;
  readonly ticker: string;
  readonly name: string;
  readonly assetClass: string;
  readonly currencyCode: string;
  readonly now: string;
}

export interface CreateInvestmentTransactionRecord {
  readonly id: string;
  readonly investmentId: string;
  readonly accountId: string;
  readonly operationType: InvestmentOperationType;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly feesMinor: number;
  readonly operationDate: string;
  readonly now: string;
}

export interface CreateInvestmentQuoteRecord {
  readonly id: string;
  readonly investmentId: string;
  readonly priceMinor: number;
  readonly quotedAt: string;
  readonly source: string | null;
  readonly now: string;
}

export interface ListInvestmentsOptions {
  readonly assetClass?: string;
}

export interface ListQuotesOptions {
  readonly limit: number;
  readonly offset: number;
}

const SELECT_TRANSACTION = `
  SELECT it.*, a.name AS account_name
  FROM investment_transactions it
  JOIN accounts a ON a.id = it.account_id
`;

/** Acesso a ativos, operações e cotações, sempre escopado pelo usuário. */
export class InvestmentsRepository {
  constructor(private readonly db: AppDatabase) {}

  list(userId: string, options: ListInvestmentsOptions = {}): Investment[] {
    const params: unknown[] = [userId];
    let sql = "SELECT * FROM investments WHERE user_id = ? AND deleted_at IS NULL";

    if (options.assetClass !== undefined) {
      sql += " AND asset_class = ? COLLATE NOCASE";
      params.push(options.assetClass);
    }

    sql += " ORDER BY ticker COLLATE NOCASE ASC, created_at ASC";

    return this.db
      .prepare<unknown[], InvestmentRow>(sql)
      .all(...params)
      .map(mapInvestment);
  }

  findById(userId: string, investmentId: string): Investment | undefined {
    const row = this.db
      .prepare<[string, string], InvestmentRow>(
        "SELECT * FROM investments WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
      )
      .get(investmentId, userId);
    return row ? mapInvestment(row) : undefined;
  }

  findByTicker(userId: string, ticker: string, excludeId?: string): Investment | undefined {
    const params: unknown[] = [userId, ticker];
    let sql =
      "SELECT * FROM investments WHERE user_id = ? AND ticker = ? COLLATE NOCASE AND deleted_at IS NULL";

    if (excludeId !== undefined) {
      sql += " AND id <> ?";
      params.push(excludeId);
    }

    const row = this.db
      .prepare<unknown[], InvestmentRow>(`${sql} LIMIT 1`)
      .get(...params);
    return row ? mapInvestment(row) : undefined;
  }

  create(record: CreateInvestmentRecord): void {
    this.db
      .prepare<[string, string, string, string, string, string, string, string]>(
        `INSERT INTO investments
           (id, user_id, ticker, name, asset_class, currency_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.userId,
        record.ticker,
        record.name,
        record.assetClass,
        record.currencyCode,
        record.now,
        record.now,
      );
  }

  update(record: UpdateInvestmentRecord): void {
    this.db
      .prepare<[string, string, string, string, string, string]>(
        `UPDATE investments
         SET ticker = ?, name = ?, asset_class = ?, currency_code = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        record.ticker,
        record.name,
        record.assetClass,
        record.currencyCode,
        record.now,
        record.id,
      );
  }

  softDelete(investmentId: string, now: string): void {
    this.db
      .prepare<[string, string, string]>(
        "UPDATE investments SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      )
      .run(now, now, investmentId);
  }

  hasTransactions(investmentId: string): boolean {
    const row = this.db
      .prepare<[string], { found: number }>(
        "SELECT EXISTS(SELECT 1 FROM investment_transactions WHERE investment_id = ?) AS found",
      )
      .get(investmentId);
    return row?.found === 1;
  }

  /** Operações em ordem cronológica, usadas no cálculo de posição. */
  listTransactions(investmentId: string): InvestmentTransaction[] {
    return this.db
      .prepare<[string], InvestmentTransactionRow>(
        `${SELECT_TRANSACTION}
         WHERE it.investment_id = ?
         ORDER BY it.operation_date ASC, it.created_at ASC, it.rowid ASC`,
      )
      .all(investmentId)
      .map(mapTransaction);
  }

  /** Operações em ordem decrescente para a API paginada. */
  listTransactionsPage(
    investmentId: string,
    limit: number,
    offset: number,
  ): InvestmentTransaction[] {
    return this.db
      .prepare<[string, number, number], InvestmentTransactionRow>(
        `${SELECT_TRANSACTION}
         WHERE it.investment_id = ?
         ORDER BY it.operation_date DESC, it.created_at DESC, it.rowid DESC
         LIMIT ? OFFSET ?`,
      )
      .all(investmentId, limit, offset)
      .map(mapTransaction);
  }

  findTransactionById(
    investmentId: string,
    transactionId: string,
  ): InvestmentTransaction | undefined {
    const row = this.db
      .prepare<[string, string], InvestmentTransactionRow>(
        `${SELECT_TRANSACTION} WHERE it.id = ? AND it.investment_id = ?`,
      )
      .get(transactionId, investmentId);
    return row ? mapTransaction(row) : undefined;
  }

  insertTransaction(record: CreateInvestmentTransactionRecord): void {
    this.db
      .prepare<
        [
          string,
          string,
          string,
          InvestmentOperationType,
          number,
          number,
          number,
          string,
          string,
        ]
      >(
        `INSERT INTO investment_transactions
           (id, investment_id, account_id, operation_type, quantity,
            unit_price_minor, fees_minor, operation_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.investmentId,
        record.accountId,
        record.operationType,
        record.quantity,
        record.unitPriceMinor,
        record.feesMinor,
        record.operationDate,
        record.now,
      );
  }

  latestQuote(investmentId: string): InvestmentQuote | undefined {
    const row = this.db
      .prepare<[string], InvestmentQuoteRow>(
        `SELECT * FROM investment_quotes
         WHERE investment_id = ?
         ORDER BY quoted_at DESC, created_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(investmentId);
    return row ? mapQuote(row) : undefined;
  }

  listQuotes(investmentId: string, options: ListQuotesOptions): InvestmentQuote[] {
    return this.db
      .prepare<[string, number, number], InvestmentQuoteRow>(
        `SELECT * FROM investment_quotes
         WHERE investment_id = ?
         ORDER BY quoted_at DESC, created_at DESC, rowid DESC
         LIMIT ? OFFSET ?`,
      )
      .all(investmentId, options.limit, options.offset)
      .map(mapQuote);
  }

  insertQuote(record: CreateInvestmentQuoteRecord): void {
    this.db
      .prepare<[string, string, number, string, string | null, string]>(
        `INSERT INTO investment_quotes
           (id, investment_id, price_minor, quoted_at, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.investmentId,
        record.priceMinor,
        record.quotedAt,
        record.source,
        record.now,
      );
  }
}

function mapInvestment(row: InvestmentRow): Investment {
  return {
    id: row.id,
    userId: row.user_id,
    ticker: row.ticker,
    name: row.name,
    assetClass: row.asset_class,
    currencyCode: row.currency_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTransaction(row: InvestmentTransactionRow): InvestmentTransaction {
  return {
    id: row.id,
    investmentId: row.investment_id,
    accountId: row.account_id,
    accountName: row.account_name,
    operationType: row.operation_type,
    quantity: row.quantity,
    unitPriceMinor: row.unit_price_minor,
    feesMinor: row.fees_minor,
    operationDate: row.operation_date,
    createdAt: row.created_at,
  };
}

function mapQuote(row: InvestmentQuoteRow): InvestmentQuote {
  return {
    id: row.id,
    investmentId: row.investment_id,
    priceMinor: row.price_minor,
    quotedAt: row.quoted_at,
    source: row.source,
    createdAt: row.created_at,
  };
}
