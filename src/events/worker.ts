import type { AppConfig } from "../config.ts";
import type { AppDatabase } from "../db/client.ts";
import type { Logger } from "../shared/logger/index.ts";
import type { CorrelationScheduler } from "../ai/ai.correlation.ts";
import type { AiProcessor } from "../ai/ai.processor.ts";
import { uuidv7 } from "../shared/utils/uuid.ts";
import type { OutboxEvent } from "./events.types.ts";
import { OutboxRepository } from "./outbox.repository.ts";

export interface EventWorkerDependencies {
  readonly db: AppDatabase;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly processor: AiProcessor;
  readonly correlations: CorrelationScheduler;
  readonly now?: () => Date;
  readonly repository?: OutboxRepository;
  readonly workerId?: string;
}

/** Backoff exponencial: 5s, 10s, 20s… limitado a 5 minutos. */
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/** Lease mínimo usado para considerar um evento travado. */
const MIN_LEASE_MS = 60_000;

/**
 * Worker do outbox.
 *
 * O processamento é deliberadamente sequencial dentro de cada lote: a IA pode
 * demorar e abrir várias chamadas simultâneas ao provider só aumentaria custo e
 * risco de rate limit. Várias instâncias continuam seguras porque o claim é
 * atômico.
 */
export class EventWorker {
  readonly #config: AppConfig;
  readonly #logger: Logger;
  readonly #processor: AiProcessor;
  readonly #correlations: CorrelationScheduler;
  readonly #now: () => Date;
  readonly #repository: OutboxRepository;
  readonly #workerId: string;
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;

  constructor(dependencies: EventWorkerDependencies) {
    this.#config = dependencies.config;
    this.#logger = dependencies.logger;
    this.#processor = dependencies.processor;
    this.#correlations = dependencies.correlations;
    this.#now = dependencies.now ?? (() => new Date());
    this.#repository = dependencies.repository ?? new OutboxRepository(dependencies.db);
    this.#workerId = dependencies.workerId ?? `worker-${uuidv7()}`;
  }

  get workerId(): string {
    return this.#workerId;
  }

  /** Liga o loop periódico sem manter o processo vivo (timer unref). */
  start(): void {
    if (this.#timer !== undefined) return;

    const timer = setInterval(() => {
      void this.runOnce();
    }, this.#config.ai.workerIntervalMs);

    this.#timer = timer;
    Deno.unrefTimer(timer);
    this.#logger.info("ai_worker_started", {
      workerId: this.#workerId,
      intervalMs: this.#config.ai.workerIntervalMs,
      batchSize: this.#config.ai.maxEventsPerBatch,
    });
  }

  stop(): void {
    if (this.#timer === undefined) return;
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#logger.info("ai_worker_stopped", { workerId: this.#workerId });
  }

  /**
   * Processa até `maxEventsPerBatch` eventos disponíveis.
   *
   * Retorna a quantidade processada (com sucesso ou falha), útil nos testes.
   * Chamadas concorrentes são ignoradas para não duplicar trabalho no mesmo
   * processo — o claim atômico continua sendo a barreira entre instâncias.
   */
  async runOnce(): Promise<number> {
    if (this.#running) return 0;
    this.#running = true;
    const maxAttempts = this.#config.ai.maxRetries + 1;

    try {
      this.#recoverStuck(maxAttempts);

      let processed = 0;
      while (processed < this.#config.ai.maxEventsPerBatch) {
        const now = this.#now().toISOString();
        const event = this.#repository.claimNext(this.#workerId, now);
        if (event === null) break;

        await this.#process(event, maxAttempts);
        processed++;
      }

      return processed;
    } catch (error) {
      this.#logger.error("ai_worker_cycle_failed", {
        workerId: this.#workerId,
        message: error instanceof Error ? error.message : String(error),
      });
      return 0;
    } finally {
      this.#running = false;
    }
  }

  async #process(event: OutboxEvent, maxAttempts: number): Promise<void> {
    const startedAt = this.#now().getTime();

    try {
      const result = await this.#processor.process(event);
      const finishedAt = this.#now().toISOString();
      this.#repository.complete(event.id, finishedAt);

      this.#logger.info("ai_event_completed", {
        eventId: event.id,
        type: event.type,
        attempts: event.attempts,
        elapsedMs: Math.max(0, this.#now().getTime() - startedAt),
        toolCalls: result.toolCalls,
        executed: result.executed,
      });

      // Correção é analisada depois do sucesso, nunca durante: um padrão novo
      // pode gerar mais eventos, e o worker já está fora da transação da regra.
      if (event.type !== "correlation.check" && event.type !== "embedding.requested") {
        try {
          this.#correlations.maybeSchedule(event.userId);
        } catch (error) {
          this.#logger.warn("ai_correlation_schedule_failed", {
            userId: event.userId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      const now = this.#now();
      const nowIso = now.toISOString();
      const message = error instanceof Error ? error.message : String(error);
      const nextAvailable = new Date(now.getTime() + backoffMs(event.attempts)).toISOString();

      const willRetry = this.#repository.fail(
        event,
        message,
        nowIso,
        nextAvailable,
        maxAttempts,
      );

      this.#logger.warn(willRetry ? "ai_event_retry_scheduled" : "ai_event_dead_letter", {
        eventId: event.id,
        type: event.type,
        userId: event.userId,
        attempts: event.attempts,
        nextAvailableAt: willRetry ? nextAvailable : null,
        message,
      });
    }
  }

  #recoverStuck(maxAttempts: number): void {
    const now = this.#now();
    const leaseMs = Math.max(MIN_LEASE_MS, this.#config.ai.requestTimeoutMs * 2);
    const cutoff = new Date(now.getTime() - leaseMs).toISOString();

    const recovered = this.#repository.recoverStuck(cutoff, now.toISOString(), maxAttempts);
    if (recovered > 0) {
      this.#logger.warn("ai_events_recovered", { count: recovered });
    }
  }
}

/** Backoff exponencial a partir do número de tentativas já realizadas. */
export function backoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** exponent);
}
