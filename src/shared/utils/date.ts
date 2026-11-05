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

/** Data atual em UTC no formato de negócio. */
export function todayUtc(now: Date = new Date()): string {
  return formatBusinessDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function formatBusinessDate(year: number, monthIndex: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${
    String(day).padStart(2, "0")
  }`;
}
