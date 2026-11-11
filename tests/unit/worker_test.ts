import { assertEquals, assertThrows } from "@std/assert";
import { AiResponseParseError } from "../../src/ai/ai.parser.ts";
import { AiProviderError } from "../../src/ai/ai.types.ts";
import {
  EventPayloadError,
  PermanentEventError,
  TransientEventError,
} from "../../src/events/errors.ts";
import {
  findEventDescriptor,
  isInternalEvent,
  requireEventDescriptor,
  validateEventPayload,
} from "../../src/events/event-registry.ts";
import type { OutboxEvent } from "../../src/events/events.types.ts";
import { backoffMs, jitteredBackoffMs } from "../../src/worker/backoff.ts";
import { classifyEventError } from "../../src/worker/errors.ts";

function event(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: "0192f0c4-0000-7000-8000-000000000000",
    type: "finance.transaction.created",
    aggregateType: "transaction",
    aggregateId: null,
    userId: "0192f0c4-0000-7000-8000-000000000001",
    payload: {},
    status: "processing",
    priority: 0,
    attempts: 1,
    availableAt: "2026-11-11T00:00:00.000Z",
    lockedAt: "2026-11-11T00:00:00.000Z",
    workerId: "worker-test",
    leaseToken: "token",
    leaseExpiresAt: "2026-11-11T00:01:00.000Z",
    lastError: null,
    createdAt: "2026-11-11T00:00:00.000Z",
    processedAt: null,
    replayCount: 0,
    replayedAt: null,
    ...overrides,
  };
}

Deno.test("backoff cresce exponencialmente e para em 5 minutos", () => {
  assertEquals(backoffMs(1), 5_000);
  assertEquals(backoffMs(2), 10_000);
  assertEquals(backoffMs(3), 20_000);
  assertEquals(backoffMs(20), 5 * 60_000);
});

Deno.test("backoff com jitter é determinístico quando o random é injetado", () => {
  assertEquals(jitteredBackoffMs(1, { random: () => 0 }), 5_000);
  assertEquals(jitteredBackoffMs(1, { random: () => 1 }), 6_250);
  assertEquals(jitteredBackoffMs(2, { random: () => 0.5, jitterRatio: 0.5 }), 12_500);
});

Deno.test("classificação separa falhas permanentes de transitórias", () => {
  assertEquals(classifyEventError(new EventPayloadError("payload")), "permanent");
  assertEquals(classifyEventError(new PermanentEventError("regra")), "permanent");
  assertEquals(classifyEventError(new TransientEventError("rede")), "transient");
  assertEquals(classifyEventError(new AiResponseParseError("json")), "transient");
  assertEquals(classifyEventError(new Error("genérico")), "transient");
});

Deno.test("classificação usa o status HTTP do provedor", () => {
  assertEquals(classifyEventError(new AiProviderError("sem resposta")), "transient");
  assertEquals(classifyEventError(new AiProviderError("rate limit", 429)), "transient");
  assertEquals(classifyEventError(new AiProviderError("timeout", 408)), "transient");
  assertEquals(classifyEventError(new AiProviderError("overloaded", 503)), "transient");
  assertEquals(classifyEventError(new AiProviderError("payload inválido", 400)), "permanent");
  assertEquals(classifyEventError(new AiProviderError("não autorizado", 401)), "permanent");
});

Deno.test("registry cobre todos os tipos conhecidos", () => {
  const descriptor = requireEventDescriptor("embedding.requested");
  assertEquals(descriptor.pipeline, "embedding");
  assertEquals(isInternalEvent("embedding.requested"), true);
  assertEquals(isInternalEvent("correlation.check"), true);
  assertEquals(isInternalEvent("finance.transaction.created"), false);
  assertEquals(findEventDescriptor("evento.inexistente"), null);
});

Deno.test("tipo não registrado é falha permanente", () => {
  assertThrows(
    () => requireEventDescriptor("evento.inexistente"),
    PermanentEventError,
    "não suportado",
  );
});

Deno.test("registry valida o payload do evento de embedding", () => {
  const valid = validateEventPayload(event({
    type: "embedding.requested",
    payload: { sourceType: "insight", sourceId: "abc", content: "texto" },
  }));
  assertEquals(valid.sourceId, "abc");

  assertThrows(
    () => validateEventPayload(event({ type: "embedding.requested", payload: {} })),
    EventPayloadError,
    "Payload inválido",
  );

  // Payload informativo aceita campos livres, mas não deixa de ser objeto.
  assertEquals(validateEventPayload(event({ payload: { amountMinor: 100 } })), {
    amountMinor: 100,
  });
});
