/** Backoff exponencial base: 5s, 10s, 20s… limitado a 5 minutos. */
export const BASE_BACKOFF_MS = 5_000;
export const MAX_BACKOFF_MS = 5 * 60_000;
/** Fração do atraso usada como jitter adicional. */
export const DEFAULT_JITTER_RATIO = 0.25;

export interface JitterOptions {
  readonly baseMs?: number;
  readonly maxMs?: number;
  readonly jitterRatio?: number;
  /** Injetável para testes determinísticos. */
  readonly random?: () => number;
}

/**
 * Atraso exponencial puro (sem jitter) para `attempts` tentativas já feitas.
 *
 * @example backoffMs(1) === 5_000; backoffMs(2) === 10_000
 */
export function backoffMs(
  attempts: number,
  baseMs: number = BASE_BACKOFF_MS,
  maxMs: number = MAX_BACKOFF_MS,
): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(maxMs, baseMs * 2 ** exponent);
}

/**
 * Atraso com jitter: `min(base * 2^attempt, max) + random * delay * ratio`.
 *
 * O jitter evita que vários workers reagendem eventos no mesmo instante após
 * uma indisponibilidade do provedor (thundering herd).
 */
export function jitteredBackoffMs(attempts: number, options: JitterOptions = {}): number {
  const baseMs = options.baseMs ?? BASE_BACKOFF_MS;
  const maxMs = options.maxMs ?? MAX_BACKOFF_MS;
  const ratio = options.jitterRatio ?? DEFAULT_JITTER_RATIO;
  const random = options.random ?? Math.random;

  const delay = backoffMs(attempts, baseMs, maxMs);
  const jitter = Math.max(0, Math.min(1, random())) * delay * ratio;
  return Math.round(delay + jitter);
}
