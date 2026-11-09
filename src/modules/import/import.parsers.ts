import { isValidBusinessDate } from "../../shared/utils/date.ts";

/**
 * Limite por arquivo. O corpo HTTP já é limitado a 1 MB, mas um CSV compacto
 * pode conter muitas linhas; o teto evita commits gigantes em uma única
 * transação do SQLite.
 */
export const MAX_IMPORT_ROWS = 5_000;

export const IMPORT_FORMATS = ["csv", "ofx"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export type ImportTransactionType = "income" | "expense";

export interface ParsedImportRow {
  readonly line: number;
  readonly externalId: string | null;
  readonly transactionDate: string;
  readonly amountMinor: number;
  readonly type: ImportTransactionType;
  readonly description: string | null;
}

export interface ImportRowError {
  readonly line: number;
  readonly message: string;
}

export interface ParsedImport {
  readonly format: ImportFormat;
  readonly rows: ParsedImportRow[];
  readonly errors: ImportRowError[];
}

interface CsvRecord {
  readonly line: number;
  readonly fields: string[];
}

interface HeaderIndexes {
  readonly date: number;
  readonly amount: number;
  readonly description: number | null;
  readonly type: number | null;
  readonly externalId: number | null;
}

const DATE_ALIASES = [
  "date",
  "data",
  "dt",
  "data transacao",
  "data da transacao",
  "transaction date",
  "posted date",
  "posting date",
];
const AMOUNT_ALIASES = [
  "amount",
  "valor",
  "value",
  "montante",
  "valor lancamento",
  "transaction amount",
];
const DESCRIPTION_ALIASES = [
  "description",
  "descricao",
  "historico",
  "lancamento",
  "memo",
  "name",
  "nome",
  "details",
  "detalhes",
];
const TYPE_ALIASES = ["type", "tipo", "natureza", "transaction type"];
const EXTERNAL_ID_ALIASES = [
  "id",
  "fitid",
  "externalid",
  "external id",
  "identificador",
  "transaction id",
  "id transacao",
];

/** Remove acentos e normaliza um cabeçalho para comparação. */
export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Detecta o formato pelo conteúdo, não pela extensão: exportações de banco
 * costumam mentir no nome do arquivo.
 */
export function detectImportFormat(content: string): ImportFormat | null {
  const head = content.slice(0, 8_192).toUpperCase();
  if (head.includes("OFXHEADER") || head.includes("<OFX>")) return "ofx";
  if (content.trim() === "") return null;
  return "csv";
}

export function parseImport(content: string, accountType: string): ParsedImport {
  const format = detectImportFormat(content);
  if (format === null) {
    return { format: "csv", rows: [], errors: [{ line: 1, message: "Arquivo vazio" }] };
  }

  return format === "ofx" ? parseOfx(content, accountType) : parseCsv(content, accountType);
}

/* ------------------------------------------------------------------------- */
/* CSV                                                                        */
/* ------------------------------------------------------------------------- */

export function parseCsv(content: string, accountType: string): ParsedImport {
  const clean = content.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(clean);
  const records = parseDelimited(clean, delimiter).filter((record) =>
    record.fields.some((field) => field.trim() !== "")
  );

  if (records.length === 0) {
    return { format: "csv", rows: [], errors: [{ line: 1, message: "Arquivo vazio" }] };
  }

  const header = records[0];
  if (header === undefined) {
    return { format: "csv", rows: [], errors: [{ line: 1, message: "Arquivo vazio" }] };
  }

  const indexes = mapHeader(header.fields);
  if (indexes === null) {
    return {
      format: "csv",
      rows: [],
      errors: [{
        line: header.line,
        message: "Cabeçalho inválido: informe ao menos as colunas de data e valor",
      }],
    };
  }

  const rows: ParsedImportRow[] = [];
  const errors: ImportRowError[] = [];

  for (const record of records.slice(1)) {
    if (rows.length >= MAX_IMPORT_ROWS) {
      errors.push({
        line: record.line,
        message: `Limite de ${MAX_IMPORT_ROWS} linhas por arquivo excedido`,
      });
      break;
    }

    const result = parseCsvRecord(record, indexes, accountType);
    if ("error" in result) {
      errors.push({ line: record.line, message: result.error });
    } else {
      rows.push(result.row);
    }
  }

  return { format: "csv", rows, errors };
}

function detectDelimiter(content: string): string {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = -1;

  for (const candidate of candidates) {
    const count = countOutsideQuotes(firstLine, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

function countOutsideQuotes(line: string, char: string): number {
  let count = 0;
  let inQuotes = false;

  for (const current of line) {
    if (current === '"') inQuotes = !inQuotes;
    else if (!inQuotes && current === char) count++;
  }

  return count;
}

function parseDelimited(content: string, delimiter: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let physicalLine = 1;
  let recordLine = 1;
  let started = false;

  for (let index = 0; index < content.length; index++) {
    const char = content[index] as string;

    if (!started) {
      recordLine = physicalLine;
      started = true;
    }

    if (inQuotes) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") physicalLine++;
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(field);
      field = "";
    } else if (char === "\n") {
      fields.push(field);
      records.push({ line: recordLine, fields });
      fields = [];
      field = "";
      started = false;
      physicalLine++;
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (started || field !== "" || fields.length > 0) {
    fields.push(field);
    records.push({ line: recordLine, fields });
  }

  return records;
}

function mapHeader(fields: readonly string[]): HeaderIndexes | null {
  const headers = fields.map(normalizeHeader);

  const date = findHeader(headers, DATE_ALIASES);
  const amount = findHeader(headers, AMOUNT_ALIASES);
  if (date === -1 || amount === -1) return null;

  return {
    date,
    amount,
    description: findHeader(headers, DESCRIPTION_ALIASES),
    type: findHeader(headers, TYPE_ALIASES),
    externalId: findHeader(headers, EXTERNAL_ID_ALIASES),
  };
}

function findHeader(headers: readonly string[], aliases: readonly string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

function parseCsvRecord(
  record: CsvRecord,
  indexes: HeaderIndexes,
  accountType: string,
): { row: ParsedImportRow } | { error: string } {
  const dateText = record.fields[indexes.date] ?? "";
  const amountText = record.fields[indexes.amount] ?? "";
  const transactionDate = parseBusinessDate(dateText);
  if (transactionDate === null) {
    return { error: `Data inválida: "${dateText.trim()}"` };
  }

  const signedMinor = parseAmountToMinor(amountText);
  if (signedMinor === null || signedMinor === 0) {
    return { error: `Valor inválido: "${amountText.trim()}"` };
  }

  const explicitType = indexes.type === null ? null : parseType(record.fields[indexes.type] ?? "");
  const type = resolveType(signedMinor, explicitType, accountType);

  const description = indexes.description === null
    ? null
    : normalizeDescription(record.fields[indexes.description] ?? "");
  const externalId = indexes.externalId === null
    ? null
    : normalizeExternalId(record.fields[indexes.externalId] ?? "");

  return {
    row: {
      line: record.line,
      externalId,
      transactionDate,
      amountMinor: Math.abs(signedMinor),
      type,
      description,
    },
  };
}

/* ------------------------------------------------------------------------- */
/* OFX                                                                        */
/* ------------------------------------------------------------------------- */

export function parseOfx(content: string, accountType: string): ParsedImport {
  const blocks = extractOfxTransactions(content);
  if (blocks === null) {
    return {
      format: "ofx",
      rows: [],
      errors: [{ line: 1, message: "Arquivo OFX sem bloco de transações (STMTTRN)" }],
    };
  }

  const rows: ParsedImportRow[] = [];
  const errors: ImportRowError[] = [];

  blocks.forEach((block, index) => {
    const line = index + 1;
    if (rows.length >= MAX_IMPORT_ROWS) {
      errors.push({
        line,
        message: `Limite de ${MAX_IMPORT_ROWS} transações por arquivo excedido`,
      });
      return;
    }

    const amountText = ofxTag(block, "TRNAMT");
    const dateText = ofxTag(block, "DTPOSTED");
    const signedMinor = parseAmountToMinor(amountText);
    const transactionDate = parseOfxDate(dateText);

    if (signedMinor === null || signedMinor === 0) {
      errors.push({ line, message: `Valor inválido: "${amountText}"` });
      return;
    }
    if (transactionDate === null) {
      errors.push({ line, message: `Data inválida: "${dateText}"` });
      return;
    }

    const explicitType = parseType(ofxTag(block, "TRNTYPE"));
    const description = normalizeDescription(
      ofxTag(block, "MEMO") || ofxTag(block, "NAME"),
    );
    const externalId = normalizeExternalId(ofxTag(block, "FITID"));

    rows.push({
      line,
      externalId,
      transactionDate,
      amountMinor: Math.abs(signedMinor),
      type: resolveType(signedMinor, explicitType, accountType),
      description,
    });
  });

  return { format: "ofx", rows, errors };
}

function extractOfxTransactions(content: string): string[] | null {
  const xmlBlocks = [...content.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)];
  if (xmlBlocks.length > 0) {
    return xmlBlocks.map((match) => match[1] ?? "");
  }

  // OFX 1.x é SGML: as tags não são fechadas. O próximo `<STMTTRN>` encerra o
  // bloco anterior.
  const parts = content.split(/<STMTTRN>/gi);
  if (parts.length <= 1) return null;

  return parts.slice(1).map((part) => part.split(/<\/STMTTRN>/i)[0] ?? part);
}

function ofxTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>\\s*([^<\\r\\n]*)`, "i"));
  return match?.[1]?.trim() ?? "";
}

function parseOfxDate(value: string): string | null {
  const digits = value.trim().replace(/\D/g, "");
  if (digits.length < 8) return null;

  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return isValidBusinessDate(iso) ? iso : null;
}

/* ------------------------------------------------------------------------- */
/* Valores, datas e tipos                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Converte um valor monetário textual em minor units sem passar por float.
 *
 * Aceita `1234.56`, `1.234,56`, `R$ 1.234,56`, `(123,45)` e `-123.45`. Um único
 * separador com exatamente três dígitos à direita é tratado como agrupamento
 * de milhar (convenção pt-BR), não como decimal.
 */
export function parseAmountToMinor(input: string): number | null {
  let text = input.trim();
  if (text === "") return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }

  text = text.replace(/[^\d.,-]/g, "");
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  }
  if (!/\d/.test(text)) return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let decimalSeparator: string | null = null;

  if (lastComma >= 0 && lastDot >= 0) {
    decimalSeparator = lastComma > lastDot ? "," : ".";
  } else {
    const separator = lastComma >= 0 ? "," : lastDot >= 0 ? "." : null;
    if (separator !== null) {
      const position = Math.max(lastComma, lastDot);
      const digitsAfter = text.length - position - 1;
      const totalDigits = text.replace(/[.,]/g, "").length;
      const digitsBefore = totalDigits - digitsAfter;
      decimalSeparator = digitsAfter === 3 && digitsBefore > 3 ? null : separator;
    }
  }

  let integerDigits: string;
  let fractionDigits = "";

  if (decimalSeparator === null) {
    integerDigits = text.replace(/[.,]/g, "");
  } else {
    const position = text.lastIndexOf(decimalSeparator);
    integerDigits = text.slice(0, position).replace(/[.,]/g, "");
    fractionDigits = text.slice(position + 1).replace(/[.,]/g, "");
  }

  if (integerDigits === "") integerDigits = "0";

  const integer = Number(integerDigits);
  if (!Number.isSafeInteger(integer)) return null;

  let minor = integer * 100;
  if (fractionDigits !== "") {
    const padded = fractionDigits.padEnd(3, "0");
    const cents = Number(padded.slice(0, 2));
    const remainder = Number(padded.slice(2, 3));
    minor += cents + (remainder >= 5 ? 1 : 0);
  }

  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

export function parseBusinessDate(input: string): string | null {
  const text = input.trim();
  let year: number;
  let month: number;
  let day: number;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const ymdSlash = text.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  const dmySlash = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const dmySlashShort = text.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  const dmyDash = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);

  if (iso !== null) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (ymdSlash !== null) {
    year = Number(ymdSlash[1]);
    month = Number(ymdSlash[2]);
    day = Number(ymdSlash[3]);
  } else if (dmySlash !== null) {
    day = Number(dmySlash[1]);
    month = Number(dmySlash[2]);
    year = Number(dmySlash[3]);
  } else if (dmySlashShort !== null) {
    day = Number(dmySlashShort[1]);
    month = Number(dmySlashShort[2]);
    year = 2_000 + Number(dmySlashShort[3]);
  } else if (dmyDash !== null) {
    day = Number(dmyDash[1]);
    month = Number(dmyDash[2]);
    year = Number(dmyDash[3]);
  } else {
    return null;
  }

  const isoDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${
    String(day).padStart(2, "0")
  }`;
  return isValidBusinessDate(isoDate) ? isoDate : null;
}

export function parseType(value: string): ImportTransactionType | null {
  const normalized = normalizeHeader(value);
  if (normalized === "") return null;

  if (
    ["income", "entrada", "receita", "credito", "credit", "deposit", "deposito"].includes(
      normalized,
    )
  ) {
    return "income";
  }
  if (
    [
      "expense",
      "saida",
      "despesa",
      "debito",
      "debit",
      "withdrawal",
      "saque",
      "pagamento",
      "payment",
      "pos",
      "fee",
      "tarifa",
    ].includes(normalized)
  ) {
    return "expense";
  }

  return null;
}

/**
 * Em cartão de crédito, toda linha do extrato é uma despesa (a fatura não é
 * receita). Nas demais contas, o sinal manda; a coluna `type` explícita vence
 * quando o banco exporta valores sem sinal.
 */
function resolveType(
  signedMinor: number,
  explicitType: ImportTransactionType | null,
  accountType: string,
): ImportTransactionType {
  if (accountType === "credit_card") return "expense";
  if (explicitType !== null) return explicitType;
  return signedMinor < 0 ? "expense" : "income";
}

function normalizeDescription(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized === "" ? null : normalized.slice(0, 500);
}

function normalizeExternalId(value: string): string | null {
  const normalized = value.trim();
  return normalized === "" ? null : normalized.slice(0, 200);
}
