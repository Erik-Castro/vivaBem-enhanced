import { AiResponseParseError } from "../ai/ai.parser.ts";
import { AiProviderError } from "../ai/ai.types.ts";
import { EventPayloadError, PermanentEventError, TransientEventError } from "../events/errors.ts";

/**
 * Classificação operacional de uma falha de processamento.
 *
 * - `transient`: repetir a entrega pode funcionar (rede, 429, 5xx, banco ocupado).
 * - `permanent`: repetir não muda o resultado (payload inválido, tipo
 *   desconhecido, 4xx de contrato) → dead letter imediata.
 */
export type FailureClassification = "transient" | "permanent";

/** Status HTTP do provedor que indicam "tente de novo". */
const TRANSIENT_STATUSES = new Set([408, 425, 429]);
/** Fallback transitório: nunca descartar um evento por erro de rede genérico. */
const DEFAULT_CLASSIFICATION: FailureClassification = "transient";

/**
 * Decide a política de retry a partir do erro lançado pelo processor.
 *
 * A resposta do LLM fora do contrato (`AiResponseParseError`) é transitória:
 * outro sorteio do modelo pode produzir JSON válido.
 */
export function classifyEventError(error: unknown): FailureClassification {
  if (error instanceof EventPayloadError || error instanceof PermanentEventError) {
    return "permanent";
  }
  if (error instanceof TransientEventError || error instanceof AiResponseParseError) {
    return "transient";
  }

  if (error instanceof AiProviderError) {
    // `undefined` significa falha de rede/sem resposta: vale repetir.
    if (error.status === undefined) return "transient";
    if (TRANSIENT_STATUSES.has(error.status)) return "transient";
    return error.status >= 500 ? "transient" : "permanent";
  }

  return DEFAULT_CLASSIFICATION;
}
