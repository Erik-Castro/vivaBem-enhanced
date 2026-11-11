import type { AiProcessor } from "../ai/ai.processor.ts";
import type { CorrelationScheduler } from "../ai/ai.correlation.ts";
import type { WorkerConfig } from "../config.ts";
import type { AppDatabase } from "../db/client.ts";
import type { ClaimedEvent } from "../events/events.types.ts";
import { isInternalEvent } from "../events/event-registry.ts";
import { OutboxRepository } from "../events/outbox.repository.ts";
import type { Logger } from "../shared/logger/index.ts";
import { uuidv7 } from "../shared/utils/uuid.ts";
import { jitteredBackoffMs } from "./backoff.ts";
import { classifyEventError } from "./errors.ts";

export interface WorkerRuntimeDependencies {
  readonly db: AppDatabase;
  readonly config: WorkerConfig;
  readonly logger: Logger;
  readonly processor: AiProcessor;
  readonly correlations: CorrelationScheduler;
  readonly repository?: OutboxRepository;
  /** Sobrescreve `WORKER_ID`; sem valor, gera `worker-<uuidv7>`. */
  readonly workerId?: string;
  readonly now?: () => Date;
  readonly random?: () => number;
}

/** Intervalo do log periódico de backlog e contadores. */
const STATS_INTERVAL_MS = 60_000;

function isSqliteBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("SQLITE_BUSY") || message.includes("database is locked");
}

/**
 * Ciclo de vida do processo de consumo da outbox.
 *
 * Responsabilidades: recuperar leases vencidos, adquirir eventos com claim
 * atômico, executar o processor fora de transação, renovar leases enquanto o
 * processamento está em andamento e confirmar apenas a concessão corrente.
 *
 * A entrega é *pelo menos uma vez*: handlers precisam ser idempotentes. Um
 * lease perdido nunca confirma o evento nem agenda correlação.
 */
export class WorkerRuntime {
  readonly #config: WorkerConfig;
  readonly #logger: Logger;
  readonly #processor: AiProcessor;
  readonly #correlations: CorrelationScheduler;
  readonly #repository: OutboxRepository;
  readonly #workerId: string;
  readonly #now: () => Date;
  readonly #random: () => number;
  readonly #inFlight = new Map<string, ClaimedEvent>();
  readonly #lostLeases = new Set<string>();
  readonly #active = new Set<Promise<void>>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  #cycleRunning = false;
  #started = false;
  #stopping = false;
  /** Após o prazo de shutdown, o processo não pode mais tocar no banco. */
  #abandoned = false;
  #leaseRecoveries = 0;
  #lastStatsAt = 0;

  constructor(dependencies: WorkerRuntimeDependencies) {
    this.#config = dependencies.config;
    this.#logger = dependencies.logger;
    this.#processor = dependencies.processor;
    this.#correlations = dependencies.correlations;
    this.#repository = dependencies.repository ?? new OutboxRepository(dependencies.db);
    this.#workerId = dependencies.workerId ?? dependencies.config.worker.id ??
      `worker-${uuidv7()}`;
    this.#now = dependencies.now ?? (() => new Date());
    this.#random = dependencies.random ?? Math.random;
  }

  get workerId(): string {
    return this.#workerId;
  }

  /** `true` enquanto o loop foi iniciado e ainda não foi encerrado. */
  get running(): boolean {
    return this.#started && !this.#stopping;
  }

  /** Liga o loop de polling sem manter o processo vivo por si só. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#stopping = false;
    this.#lastStatsAt = this.#now().getTime();

    this.#logger.info("worker_started", {
      workerId: this.#workerId,
      pollIntervalMs: this.#config.worker.pollIntervalMs,
      leaseMs: this.#config.worker.leaseMs,
      heartbeatMs: this.#config.worker.heartbeatMs,
      concurrency: this.#config.worker.concurrency,
      maxAttempts: this.#config.worker.maxAttempts,
      maxEventsPerBatch: this.#config.worker.maxEventsPerBatch,
    });

    this.#logStats();
    void this.#tick();
  }

  /**
   * Processa até `maxEventsPerBatch` eventos, distribuídos em `concurrency`
   * lanes. Cada lane adquire e processa um evento por vez; o claim atômico é a
   * barreira entre processos.
   */
  async runOnce(): Promise<number> {
    if (this.#cycleRunning || this.#stopping) return 0;
    this.#cycleRunning = true;

    try {
      this.#recoverExpired();

      let processed = 0;
      const lane = async (): Promise<void> => {
        while (!this.#stopping && processed < this.#config.worker.maxEventsPerBatch) {
          const event = this.#claim();
          if (event === null) return;
          processed++;
          await this.#track(this.#process(event));
        }
      };

      const lanes = Array.from(
        { length: Math.max(1, this.#config.worker.concurrency) },
        () => lane(),
      );
      const results = await Promise.allSettled(lanes);

      for (const result of results) {
        if (result.status === "rejected") {
          this.#logger.error("worker_cycle_failed", {
            workerId: this.#workerId,
            message: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      }

      return processed;
    } finally {
      this.#cycleRunning = false;
    }
  }

  /**
   * Encerramento gracioso.
   *
   * Para de adquirir, aguarda as tarefas em andamento até
   * `WORKER_SHUTDOWN_GRACE_MS` e mantém a renovação de leases durante a espera.
   * Eventos que não terminarem ficam com o lease intacto para recuperação.
   */
  async stop(): Promise<void> {
    if (this.#stopping) return;
    this.#stopping = true;

    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }

    const pending = [...this.#active];
    if (pending.length > 0) {
      this.#logger.info("worker_shutdown_waiting", {
        workerId: this.#workerId,
        inFlight: pending.length,
        graceMs: this.#config.worker.shutdownGraceMs,
      });

      await Promise.race([
        Promise.allSettled(pending).then(() => undefined),
        new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, this.#config.worker.shutdownGraceMs);
          Deno.unrefTimer(timeout);
        }),
      ]);
    }

    if (this.#active.size > 0) {
      // Sem abort no provider, o handler pode continuar rodando. A partir
      // daqui ele não pode mais confirmar nem falhar o evento.
      this.#abandoned = true;
      this.#logger.warn("worker_shutdown_timeout", {
        workerId: this.#workerId,
        inFlight: this.#active.size,
        eventIds: [...this.#inFlight.keys()],
      });
    }

    if (this.#heartbeatTimer !== undefined) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }

    this.#logger.info("worker_stopped", { workerId: this.#workerId });
  }

  async #tick(): Promise<void> {
    if (this.#stopping) return;

    try {
      const processed = await this.runOnce();
      if (processed > 0) {
        this.#logger.debug("worker_cycle_complete", {
          workerId: this.#workerId,
          processed,
        });
      }
    } catch (error) {
      this.#logger.error("worker_cycle_failed", {
        workerId: this.#workerId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (this.#stopping) return;

    const now = this.#now().getTime();
    if (now - this.#lastStatsAt >= STATS_INTERVAL_MS) {
      this.#logStats();
      this.#lastStatsAt = now;
    }

    this.#timer = setTimeout(() => void this.#tick(), this.#config.worker.pollIntervalMs);
    Deno.unrefTimer(this.#timer);
  }

  #claim(): ClaimedEvent | null {
    try {
      return this.#repository.claimNext({
        workerId: this.#workerId,
        now: this.#now().toISOString(),
        leaseMs: this.#config.worker.leaseMs,
      });
    } catch (error) {
      // Banco ocupado por outro processo é transitório: o próximo tick tenta de
      // novo e nenhum evento é perdido, porque o claim é uma única instrução.
      if (isSqliteBusy(error)) {
        this.#logger.warn("worker_claim_busy", { workerId: this.#workerId });
        return null;
      }
      throw error;
    }
  }

  async #track(task: Promise<void>): Promise<void> {
    this.#active.add(task);
    try {
      await task;
    } finally {
      this.#active.delete(task);
    }
  }

  async #process(event: ClaimedEvent): Promise<void> {
    const startedAt = this.#now().getTime();
    this.#inFlight.set(event.id, event);
    this.#ensureHeartbeat();

    try {
      const result = await this.#processor.process(event);

      if (this.#lostLeases.has(event.id) || this.#abandoned) {
        this.#logger.warn("worker_lease_lost", {
          workerId: this.#workerId,
          eventId: event.id,
          type: event.type,
          phase: "complete",
        });
        return;
      }

      const completed = this.#repository.complete(
        event.id,
        this.#workerId,
        event.leaseToken,
        this.#now().toISOString(),
      );

      if (!completed) {
        this.#logger.warn("worker_lease_lost", {
          workerId: this.#workerId,
          eventId: event.id,
          type: event.type,
          phase: "complete",
        });
        return;
      }

      this.#logger.info("ai_event_completed", {
        workerId: this.#workerId,
        eventId: event.id,
        type: event.type,
        attempts: event.attempts,
        elapsedMs: Math.max(0, this.#now().getTime() - startedAt),
        toolCalls: result.toolCalls,
        executed: result.executed,
      });

      // A correlação é analisada só depois do commit do evento e nunca para
      // eventos internos, que poderiam gerar um ciclo de agendamento.
      if (!isInternalEvent(event.type)) {
        try {
          this.#correlations.maybeSchedule(event.userId);
        } catch (error) {
          this.#logger.warn("ai_correlation_schedule_failed", {
            workerId: this.#workerId,
            userId: event.userId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      this.#handleFailure(event, error, startedAt);
    } finally {
      this.#inFlight.delete(event.id);
      this.#lostLeases.delete(event.id);
      this.#maybeStopHeartbeat();
    }
  }

  #handleFailure(
    event: ClaimedEvent,
    error: unknown,
    startedAt: number,
  ): void {
    const message = error instanceof Error ? error.message : String(error);

    if (this.#lostLeases.has(event.id) || this.#abandoned) {
      this.#logger.warn("worker_lease_lost", {
        workerId: this.#workerId,
        eventId: event.id,
        type: event.type,
        phase: "fail",
        message,
      });
      return;
    }

    const classification = classifyEventError(error);
    const now = this.#now();
    const nextAvailableAt = new Date(
      now.getTime() + jitteredBackoffMs(event.attempts, { random: this.#random }),
    ).toISOString();

    let outcome: "retry" | "dead_letter" | "lost";
    try {
      outcome = this.#repository.fail(event, {
        error: message,
        now: now.toISOString(),
        nextAvailableAt,
        maxAttempts: this.#config.worker.maxAttempts,
        permanent: classification === "permanent",
      });
    } catch (failError) {
      // Não conseguir registrar a falha mantém o lease: a recuperação por
      // expiração devolve o evento à fila depois.
      this.#logger.error("worker_fail_persist_failed", {
        workerId: this.#workerId,
        eventId: event.id,
        message: failError instanceof Error ? failError.message : String(failError),
      });
      return;
    }

    if (outcome === "lost") {
      this.#logger.warn("worker_lease_lost", {
        workerId: this.#workerId,
        eventId: event.id,
        type: event.type,
        phase: "fail",
        message,
      });
      return;
    }

    this.#logger.warn(
      outcome === "retry" ? "ai_event_retry_scheduled" : "ai_event_dead_letter",
      {
        workerId: this.#workerId,
        eventId: event.id,
        type: event.type,
        userId: event.userId,
        attempts: event.attempts,
        classification,
        elapsedMs: Math.max(0, this.#now().getTime() - startedAt),
        nextAvailableAt: outcome === "retry" ? nextAvailableAt : null,
        message,
      },
    );
  }

  #recoverExpired(): void {
    try {
      const result = this.#repository.recoverExpired({
        now: this.#now().toISOString(),
        maxAttempts: this.#config.worker.maxAttempts,
        leaseMs: this.#config.worker.leaseMs,
      });

      const total = result.retried + result.deadLettered;
      if (total === 0) return;

      this.#leaseRecoveries += total;
      this.#logger.warn("worker_leases_recovered", {
        workerId: this.#workerId,
        retried: result.retried,
        deadLettered: result.deadLettered,
      });
    } catch (error) {
      this.#logger.error("worker_recovery_failed", {
        workerId: this.#workerId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #ensureHeartbeat(): void {
    if (this.#heartbeatTimer !== undefined) return;
    this.#heartbeatTimer = setInterval(
      () => this.#renewLeases(),
      this.#config.worker.heartbeatMs,
    );
    Deno.unrefTimer(this.#heartbeatTimer);
  }

  #maybeStopHeartbeat(): void {
    // Fora do modo `start()`, encerra o timer quando não há nada em voo para
    // não manter um intervalo vivo em testes e execuções pontuais.
    if (this.#started || this.#inFlight.size > 0) return;
    if (this.#heartbeatTimer === undefined) return;
    clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = undefined;
  }

  #renewLeases(): void {
    if (this.#inFlight.size === 0) return;

    const now = this.#now().toISOString();
    for (const event of this.#inFlight.values()) {
      if (this.#lostLeases.has(event.id)) continue;
      try {
        const renewed = this.#repository.renewLease(
          event.id,
          this.#workerId,
          event.leaseToken,
          now,
          this.#config.worker.leaseMs,
        );
        if (!renewed) {
          this.#lostLeases.add(event.id);
          this.#logger.warn("worker_lease_lost", {
            workerId: this.#workerId,
            eventId: event.id,
            type: event.type,
            phase: "renew",
          });
        }
      } catch (error) {
        // Falha de banco na renovação não prova perda de posse; o próximo
        // heartbeat tenta de novo antes do vencimento.
        this.#logger.warn("worker_lease_renew_failed", {
          workerId: this.#workerId,
          eventId: event.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  #logStats(): void {
    try {
      const stats = this.#repository.stats();
      const now = this.#now().toISOString();
      this.#logger.info("worker_stats", {
        workerId: this.#workerId,
        ...stats,
        oldestPendingAgeSeconds: this.#repository.oldestPendingAgeSeconds(now),
        // Pendentes que já falharam e a distribuição do dead letter: é o que o
        // operador precisa para decidir se o problema é de provider ou de payload.
        retrying: this.#repository.retryingCount(),
        deadLetterByType: this.#repository.statsByType("dead_letter"),
        processingInThisWorker: this.#inFlight.size,
        leaseRecoveries: this.#leaseRecoveries,
      });
    } catch (error) {
      this.#logger.warn("worker_stats_failed", {
        workerId: this.#workerId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
