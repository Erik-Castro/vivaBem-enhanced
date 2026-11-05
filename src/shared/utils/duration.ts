export type DurationUnit = "s" | "m" | "h" | "d";

const UNIT_SECONDS: Record<DurationUnit, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
};

const DURATION_PATTERN = /^(\d+)(s|m|h|d)$/;

/**
 * Converte uma duração textual (`15m`, `30d`) em segundos.
 * Retorna `undefined` quando o formato é inválido.
 */
export function parseDurationSeconds(value: string): number | undefined {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2] as DurationUnit;
  return amount * UNIT_SECONDS[unit];
}

/** Valida o formato de duração usado nas variáveis de ambiente. */
export function isValidDuration(value: string): boolean {
  return parseDurationSeconds(value) !== undefined;
}
