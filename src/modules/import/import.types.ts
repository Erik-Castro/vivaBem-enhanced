import type { ImportFormat, ImportRowError } from "./import.parsers.ts";

export interface ImportUpload {
  readonly accountId: string;
  readonly fileName: string | null;
  readonly content: string;
}

export interface ImportPreviewRow {
  readonly line: number;
  readonly transactionDate: string;
  readonly type: "income" | "expense";
  readonly amountMinor: number;
  readonly description: string | null;
  readonly externalId: string | null;
  readonly importHash: string;
  readonly duplicate: boolean;
}

export interface ImportPreview {
  readonly accountId: string;
  readonly currencyCode: string;
  readonly fileName: string | null;
  readonly format: ImportFormat;
  readonly totalRows: number;
  readonly validRows: number;
  readonly newRows: number;
  readonly duplicateRows: number;
  readonly rows: ImportPreviewRow[];
  readonly errors: ImportRowError[];
}

export interface ImportCommitResult {
  readonly accountId: string;
  readonly currencyCode: string;
  readonly fileName: string | null;
  readonly format: ImportFormat;
  readonly imported: number;
  readonly skipped: number;
  readonly transactionIds: string[];
  readonly errors: ImportRowError[];
}
