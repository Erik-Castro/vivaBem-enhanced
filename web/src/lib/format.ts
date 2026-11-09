const currencyFallback = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formata um valor em minor units (centavos) para a moeda informada. */
export function formatMoney(
  amountMinor: number,
  currencyCode: string,
  locale = "pt-BR",
): string {
  const value = amountMinor / 100;

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
    }).format(value);
  } catch {
    return `${currencyFallback.format(value)} ${currencyCode}`;
  }
}

/** Formata um valor em minor units sem o símbolo da moeda. */
export function formatAmount(amountMinor: number): string {
  return currencyFallback.format(amountMinor / 100);
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);

  if (year === undefined || month === undefined || day === undefined) {
    return new Date(value);
  }

  // Datas de negócio são locais; construir com UTC deslocaria o dia em fusos negativos.
  return new Date(year, month - 1, day);
}

export function formatDate(value: string, locale = "pt-BR"): string {
  const date = parseDateOnly(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatShortDate(value: string, locale = "pt-BR"): string {
  const date = parseDateOnly(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
  }).format(date);
}

export function formatDateTime(value: string, locale = "pt-BR"): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Converte a digitação brasileira ("1.234,56") ou internacional ("1234.56") em centavos. */
export function toMinorUnits(input: string): number {
  const cleaned = input
    .replace(/[^\d,.-]/g, "")
    .replace(/\s/g, "")
    .trim();

  if (cleaned === "" || cleaned === "-") return 0;

  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;

  const value = Number(normalized);

  if (!Number.isFinite(value)) return 0;

  return Math.round(value * 100);
}

/** Converte centavos para o texto usado no formulário (sem símbolo). */
export function fromMinorUnits(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2).replace(".", ",");
}

export function todayISO(): string {
  const now = new Date();
  return toISODate(now);
}

export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthRange(date = new Date()): { from: string; to: string } {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { from: toISODate(first), to: toISODate(last) };
}

export function monthLabel(date = new Date(), locale = "pt-BR"): string {
  const label = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(date);

  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Quantidade de ativos: até 8 casas, sem zeros à direita. */
export function formatQuantity(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 8 }).format(value);
}

/** Percentual já formatado em pt-BR, incluindo o sinal quando negativo. */
export function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)}%`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}
