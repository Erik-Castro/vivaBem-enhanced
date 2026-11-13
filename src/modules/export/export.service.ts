import { AppError } from "../../http/errors.ts";
import type {
  ExportRecord,
  ExportRepository,
  ExportTransactionCsvRow,
} from "./export.repository.ts";

export interface ExportBundle {
  readonly exportedAt: string;
  readonly user: ExportRecord;
  readonly credentials: ExportRecord | null;
  readonly preferences: ExportRecord | null;
  readonly sessions: ExportRecord[];
  readonly accounts: ExportRecord[];
  readonly categories: ExportRecord[];
  readonly transactions: ExportRecord[];
  readonly recurringTransactions: ExportRecord[];
  readonly recurringOccurrences: ExportRecord[];
  readonly budgets: ExportRecord[];
  readonly goals: ExportRecord[];
  readonly goalContributions: ExportRecord[];
  readonly habits: ExportRecord[];
  readonly habitTriggers: ExportRecord[];
  readonly habitLogs: ExportRecord[];
  readonly investments: ExportRecord[];
  readonly investmentTransactions: ExportRecord[];
  readonly investmentQuotes: ExportRecord[];
  readonly achievements: ExportRecord[];
  readonly notifications: ExportRecord[];
  readonly insights: ExportRecord[];
  readonly insightFeedback: ExportRecord[];
  readonly familyLinks: ExportRecord[];
}

const CSV_HEADER = [
  "transaction_date",
  "type",
  "amount",
  "amount_minor",
  "currency",
  "account",
  "category",
  "description",
  "is_cleared",
  "external_id",
  "transfer_group_id",
  "created_at",
] as const;

export class ExportService {
  constructor(
    private readonly repository: ExportRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  exportJson(userId: string): ExportBundle {
    const user = this.repository.user(userId);
    if (user === null) {
      throw new AppError("NOT_FOUND", "Usuário não encontrado");
    }

    return {
      exportedAt: this.now().toISOString(),
      user,
      credentials: this.repository.credentials(userId),
      preferences: this.repository.preferences(userId),
      sessions: this.repository.sessions(userId),
      accounts: this.repository.accounts(userId),
      categories: this.repository.categories(userId),
      transactions: this.repository.transactions(userId),
      recurringTransactions: this.repository.recurringTransactions(userId),
      recurringOccurrences: this.repository.recurringOccurrences(userId),
      budgets: this.repository.budgets(userId),
      goals: this.repository.goals(userId),
      goalContributions: this.repository.goalContributions(userId),
      habits: this.repository.habits(userId),
      habitTriggers: this.repository.habitTriggers(userId),
      habitLogs: this.repository.habitLogs(userId),
      investments: this.repository.investments(userId),
      investmentTransactions: this.repository.investmentTransactions(userId),
      investmentQuotes: this.repository.investmentQuotes(userId),
      achievements: this.repository.achievements(userId),
      notifications: this.repository.notifications(userId),
      insights: this.repository.insights(userId),
      insightFeedback: this.repository.insightFeedback(userId),
      familyLinks: this.repository.familyLinks(userId),
    };
  }

  exportTransactionsCsv(userId: string): string {
    const rows = this.repository.transactionCsvRows(userId);
    const lines = [CSV_HEADER.join(",")];

    for (const row of rows) {
      lines.push(
        [
          row.transactionDate,
          row.type,
          formatMinor(row.amountMinor),
          String(row.amountMinor),
          row.currencyCode,
          row.accountName,
          row.categoryName ?? "",
          row.description ?? "",
          row.isCleared ? "true" : "false",
          row.externalId ?? "",
          row.transferGroupId ?? "",
          row.createdAt,
        ].map(escapeCsv).join(","),
      );
    }

    // Linha final obrigatória para ferramentas que ignoram o último registro
    // sem quebra de linha.
    return `${lines.join("\n")}\n`;
  }

  /** Nome de arquivo estável por dia, sem caracteres que quebrem headers HTTP. */
  fileName(format: "json" | "csv"): string {
    const day = this.now().toISOString().slice(0, 10);
    return format === "csv" ? `vivabem-transactions-${day}.csv` : `vivabem-export-${day}.json`;
  }
}

/**
 * Formata minor units como decimal sem usar ponto flutuante.
 * `-123456` → `-1234.56`.
 */
export function formatMinor(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor);
  const integer = Math.trunc(absolute / 100);
  const cents = String(absolute % 100).padStart(2, "0");
  return `${sign}${integer}.${cents}`;
}

/**
 * Escapa um campo CSV contra fórmula (CSV injection) e separadores.
 *
 * Valores iniciados por `=`, `+`, `-`, `@`, tab ou CR são interpretados como
 * fórmula pelo Excel/Sheets. Prefixar com apóstrofo neutraliza a execução; a
 * exceção são números puros (inclusive negativos), que precisam continuar
 * numéricos nas colunas de valor.
 */
export function escapeCsv(value: string): string {
  const plainNumber = /^[+-]?\d+(?:\.\d+)?$/.test(value);
  // Primeiro, trata fórmulas: prefixa com apóstrofo se não for número puro
  const withPrefix = !plainNumber && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

  // Depois, envolve em aspas se contém separadores
  if (!/[",\n\r]/.test(withPrefix)) return withPrefix;
  return `"${withPrefix.replaceAll('"', '""')}"`;
}

export type { ExportTransactionCsvRow };
