export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

/**
 * Rate limiter de janela deslizante em memória.
 *
 * Adequado a uma única instância (o deploy do SQLite já assume uma). Para
 * múltiplas instâncias, trocar por um backend compartilhado.
 */
export class SlidingWindowRateLimiter {
  readonly #buckets = new Map<string, number[]>();
  readonly #now: () => number;
  #consumes = 0;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  consume(key: string, max: number, windowMs: number): RateLimitResult {
    const now = this.#now();
    const cutoff = now - windowMs;
    const hits = (this.#buckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

    if (hits.length >= max) {
      const oldest = hits[0] ?? now;
      const retryAfterMs = oldest + windowMs - now;
      this.#buckets.set(key, hits);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)),
      };
    }

    hits.push(now);
    this.#buckets.set(key, hits);

    this.#consumes++;
    if (this.#consumes % 1_000 === 0) this.#prune(windowMs);

    return {
      allowed: true,
      remaining: max - hits.length,
      retryAfterSeconds: 0,
    };
  }

  /** Limpa todo o estado. Útil em testes e no shutdown. */
  reset(): void {
    this.#buckets.clear();
    this.#consumes = 0;
  }

  /** Remove chaves cuja última tentativa já saiu da janela. */
  #prune(windowMs: number): void {
    const cutoff = this.#now() - windowMs;
    for (const [key, hits] of this.#buckets) {
      const last = hits[hits.length - 1];
      if (last === undefined || last <= cutoff) this.#buckets.delete(key);
    }
  }
}
