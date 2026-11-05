const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Valida `YYYY-MM-DD` como data real no calendário gregoriano (UTC). */
export function isValidBusinessDate(value: string): boolean {
  if (!BUSINESS_DATE_PATTERN.test(value)) return false;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));

  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

/**
 * Soma meses a uma data de negócio, ajustando o dia para o último dia do mês
 * de destino. Ex.: `2026-01-31 + 1 mês` → `2026-02-28`.
 */
export function addMonthsClamped(date: string, months: number): string {
  if (!isValidBusinessDate(date)) {
    throw new RangeError(`Data inválida: ${date}`);
  }
  if (!Number.isInteger(months)) {
    throw new RangeError("O deslocamento em meses precisa ser inteiro");
  }

  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));

  const targetMonthIndex = monthIndex + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = lastDayOfMonth(targetYear, normalizedMonth);
  const targetDay = Math.min(day, lastDay);

  return formatBusinessDate(targetYear, normalizedMonth, targetDay);
}

/**
 * Soma meses mantendo um dia-alvo fixo (ex.: todo dia 31). O dia é ajustado
 * para o último dia do mês quando necessário, mas não "encolhe" nos meses
 * seguintes: `2026-01-31` com dia-alvo 31 → `2026-02-28` → `2026-03-31`.
 */
export function addMonthsWithDay(date: string, months: number, dayOfMonth: number): string {
  assertBusinessDate(date);
  if (!Number.isInteger(months)) {
    throw new RangeError("O deslocamento em meses precisa ser inteiro");
  }
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    throw new RangeError("O dia do mês precisa estar entre 1 e 31");
  }

  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(5, 7)) - 1;

  const targetMonthIndex = monthIndex + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(dayOfMonth, lastDayOfMonth(targetYear, normalizedMonth));

  return formatBusinessDate(targetYear, normalizedMonth, targetDay);
}

/** Soma dias a uma data de negócio (UTC, sem DST). */
export function addDays(date: string, days: number): string {
  assertBusinessDate(date);
  if (!Number.isInteger(days)) {
    throw new RangeError("O deslocamento em dias precisa ser inteiro");
  }

  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));
  const target = new Date(Date.UTC(year, monthIndex, day + days));

  return formatBusinessDate(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
  );
}

/** Primeiro e último dia do mês de `date`. */
export function monthBounds(date: string): { from: string; to: string } {
  assertBusinessDate(date);
  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(5, 7)) - 1;

  return {
    from: formatBusinessDate(year, monthIndex, 1),
    to: formatBusinessDate(year, monthIndex, lastDayOfMonth(year, monthIndex)),
  };
}

/** Primeiro e último dia do ano de `date`. */
export function yearBounds(date: string): { from: string; to: string } {
  assertBusinessDate(date);
  const year = Number(date.slice(0, 4));
  return {
    from: `${String(year).padStart(4, "0")}-01-01`,
    to: `${String(year).padStart(4, "0")}-12-31`,
  };
}

/** Diferença inteira em dias entre duas datas de negócio (`to - from`). */
export function daysBetween(from: string, to: string): number {
  assertBusinessDate(from);
  assertBusinessDate(to);
  return Math.round((businessDateToEpoch(to) - businessDateToEpoch(from)) / 86_400_000);
}

/** Dia do mês (1–31) de uma data de negócio. */
export function dayOfMonth(date: string): number {
  assertBusinessDate(date);
  return Number(date.slice(8, 10));
}

/** Data atual em UTC no formato de negócio. */
export function todayUtc(now: Date = new Date()): string {
  return formatBusinessDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * Dia da semana ISO-8601 de uma data de negócio: segunda = 1 … domingo = 7.
 *
 * O cálculo é feito em UTC para que fusos e horário de verão nunca desloquem
 * o dia — as datas de negócio do domínio são sempre independentes de fuso.
 */
export function isoWeekday(date: string): number {
  assertBusinessDate(date);

  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));
  const weekday = new Date(Date.UTC(year, monthIndex, day)).getUTCDay();

  return weekday === 0 ? 7 : weekday;
}

function assertBusinessDate(date: string): void {
  if (!isValidBusinessDate(date)) {
    throw new RangeError(`Data inválida: ${date}`);
  }
}

function businessDateToEpoch(date: string): number {
  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));
  return Date.UTC(year, monthIndex, day);
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function formatBusinessDate(year: number, monthIndex: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${
    String(day).padStart(2, "0")
  }`;
}
