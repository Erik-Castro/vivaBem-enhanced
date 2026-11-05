import type { AppConfig } from "../config.ts";
import type { AppDatabase } from "../db/client.ts";
import type { Logger } from "../shared/logger/index.ts";
import type { EventPublisher } from "../events/event-publisher.ts";
import { uuidv7 } from "../shared/utils/uuid.ts";
import type { AiResponse, AiToolContext } from "./ai.types.ts";
import type { AiToolRegistry } from "./ai.registry.ts";

export interface AiExecutionSummary {
  readonly attempted: number;
  readonly executed: number;
  readonly skipped: number;
}

export interface AiToolExecutorDependencies {
  readonly db: AppDatabase;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly registry: AiToolRegistry;
  readonly publisher: EventPublisher;
  readonly now?: () => Date;
}

interface AuditInput {
  readonly eventId: string;
  readonly userId: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly confidence: number;
  readonly executed: boolean;
  readonly executionTimeMs: number;
  readonly error: string | null;
  readonly now: string;
}

/** Deduplicação de execuções idênticas (mesma tool + argumentos). */
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1_000;
const HIGH_RISK_MIN_CONFIDENCE = 0.9;

/**
 * Executa as tool calls sugeridas pelo LLM.
 *
 * O modelo não tem permissão de execução: cada chamada passa por validação de
 * schema, limiar de confiança, cooldown, deduplicação e auditoria. Nada é
 * executado em nome do usuário sem esses filtros.
 */
export class AiToolExecutor {
  readonly #db: AppDatabase;
  readonly #config: AppConfig;
  readonly #logger: Logger;
  readonly #registry: AiToolRegistry;
  readonly #publisher: EventPublisher;
  readonly #now: () => Date;

  constructor(dependencies: AiToolExecutorDependencies) {
    this.#db = dependencies.db;
    this.#config = dependencies.config;
    this.#logger = dependencies.logger;
    this.#registry = dependencies.registry;
    this.#publisher = dependencies.publisher;
    this.#now = dependencies.now ?? (() => new Date());
  }

  async execute(
    response: AiResponse,
    context: AiToolContext,
  ): Promise<AiExecutionSummary> {
    let executed = 0;
    let skipped = 0;

    for (const call of response.toolCalls) {
      const startedAt = this.#now().getTime();
      const tool = this.#registry.get(call.name);

      if (tool === undefined) {
        skipped++;
        this.#audit({
          eventId: context.eventId,
          userId: context.userId,
          tool: call.name,
          args: call.arguments,
          confidence: response.confidence,
          executed: false,
          executionTimeMs: 0,
          error: "tool_desconhecida",
          now: context.now,
        });
        continue;
      }

      const minimumConfidence = tool.risk === "high"
        ? Math.max(this.#config.ai.confidenceThreshold, HIGH_RISK_MIN_CONFIDENCE)
        : this.#config.ai.confidenceThreshold;

      if (response.confidence < minimumConfidence) {
        skipped++;
        this.#audit({
          eventId: context.eventId,
          userId: context.userId,
          tool: call.name,
          args: call.arguments,
          confidence: response.confidence,
          executed: false,
          executionTimeMs: 0,
          error: "confianca_abaixo_do_limiar",
          now: context.now,
        });
        continue;
      }

      const parsed = tool.parameters.safeParse(call.arguments);
      if (!parsed.success) {
        skipped++;
        this.#audit({
          eventId: context.eventId,
          userId: context.userId,
          tool: call.name,
          args: call.arguments,
          confidence: response.confidence,
          executed: false,
          executionTimeMs: 0,
          error: "argumentos_invalidos",
          now: context.now,
        });
        continue;
      }

      const args = parsed.data;
      const serialized = stableStringify(args);

      if (this.#isInCooldown(context.userId, tool.name, tool.cooldownSeconds, context.now)) {
        skipped++;
        this.#audit({
          eventId: context.eventId,
          userId: context.userId,
          tool: tool.name,
          args,
          confidence: response.confidence,
          executed: false,
          executionTimeMs: 0,
          error: "cooldown_ativo",
          now: context.now,
        });
        continue;
      }

      if (this.#isDuplicate(context.userId, tool.name, serialized, context.now)) {
        skipped++;
        this.#audit({
          eventId: context.eventId,
          userId: context.userId,
          tool: tool.name,
          args,
          confidence: response.confidence,
          executed: false,
          executionTimeMs: 0,
          error: "duplicado",
          now: context.now,
        });
        continue;
      }

      try {
        const result = await tool.executor(args, context);
        const elapsed = Math.max(0, this.#now().getTime() - startedAt);

        this.#audit({
          eventId: context.eventId,
          userId: context.userId,
          tool: tool.name,
          args,
          confidence: response.confidence,
          executed: result.success,
          executionTimeMs: elapsed,
          error: result.success ? null : result.message,
          now: context.now,
        });

        if (result.success) {
          executed++;
          if (result.embedding !== undefined) {
            this.#publisher.requestEmbedding(
              context.userId,
              result.embedding.sourceType,
              result.embedding.sourceId,
              result.embedding.content,
            );
          }
        } else {
          skipped++;
        }
      } catch (error) {
        const elapsed = Math.max(0, this.#now().getTime() - startedAt);
        this.#logger.error("ai_tool_execution_failed", {
          eventId: context.eventId,
          userId: context.userId,
          tool: tool.name,
          message: error instanceof Error ? error.message : String(error),
        });

        this.#audit({
          eventId: context.eventId,
          userId: context.userId,
          tool: tool.name,
          args,
          confidence: response.confidence,
          executed: false,
          executionTimeMs: elapsed,
          error: error instanceof Error ? error.message.slice(0, 500) : "erro_desconhecido",
          now: context.now,
        });
        skipped++;
      }
    }

    return { attempted: response.toolCalls.length, executed, skipped };
  }

  #isInCooldown(
    userId: string,
    tool: string,
    cooldownSeconds: number,
    now: string,
  ): boolean {
    if (cooldownSeconds <= 0) return false;

    const cutoff = new Date(new Date(now).getTime() - cooldownSeconds * 1_000)
      .toISOString();

    const row = this.#db
      .prepare<[string, string, string], { id: string }>(
        `SELECT id FROM ai_action_logs
         WHERE user_id = ? AND tool = ? AND executed = 1 AND created_at >= ?
         LIMIT 1`,
      )
      .get(userId, tool, cutoff);

    return row !== undefined;
  }

  #isDuplicate(
    userId: string,
    tool: string,
    serializedArgs: string,
    now: string,
  ): boolean {
    const cutoff = new Date(new Date(now).getTime() - DEDUPE_WINDOW_MS).toISOString();

    const row = this.#db
      .prepare<[string, string, string, string], { id: string }>(
        `SELECT id FROM ai_action_logs
         WHERE user_id = ? AND tool = ? AND arguments = ? AND executed = 1
           AND created_at >= ?
         LIMIT 1`,
      )
      .get(userId, tool, serializedArgs, cutoff);

    return row !== undefined;
  }

  #audit(input: AuditInput): void {
    try {
      this.#db
        .prepare<
          [
            string,
            string,
            string,
            string,
            string,
            number,
            number,
            number,
            string | null,
            string,
          ]
        >(
          `INSERT INTO ai_action_logs (
             id, event_id, user_id, tool, arguments, confidence,
             executed, execution_time_ms, error, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          uuidv7(this.#now().getTime()),
          input.eventId,
          input.userId,
          input.tool,
          stableStringify(input.args),
          clampConfidence(input.confidence),
          input.executed ? 1 : 0,
          input.executionTimeMs,
          input.error,
          input.now,
        );
    } catch (error) {
      // Auditoria nunca deve derrubar o processamento do evento.
      this.#logger.error("ai_audit_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Serialização estável para comparar argumentos independentemente da ordem. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);

  return `{${entries.join(",")}}`;
}
