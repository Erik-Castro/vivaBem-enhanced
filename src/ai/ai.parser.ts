import { z } from "zod";
import type { AiResponse, AiRisk, AiToolCall } from "./ai.types.ts";

export class AiResponseParseError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "AiResponseParseError";
  }
}

const AiResponseSchema = z.object({
  confidence: z.number().min(0).max(1),
  analysis: z.object({
    risk: z.enum(["low", "medium", "high"]),
    summary: z.string(),
  }),
  toolCalls: z.array(
    z.object({
      name: z.string().min(1),
      arguments: z.record(z.string(), z.unknown()),
    }),
  ),
});

/**
 * Extrai o primeiro objeto JSON equilibrado, ignorando prosa, blocos
 * ` thinking` e cercas markdown. O LLM não é confiável para responder JSON puro.
 */
export function extractJsonObject(raw: string): string | null {
  let cleaned = raw
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  cleaned = cleaned.slice(start);

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < cleaned.length; index++) {
    const char = cleaned[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return cleaned.slice(0, index + 1);
    }
  }

  return null;
}

function clampConfidence(value: unknown): number {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string"
    ? Number.parseFloat(value)
    : Number.NaN;

  if (!Number.isFinite(numeric)) return 0.5;
  return Math.min(1, Math.max(0, numeric));
}

function normalizeRisk(value: unknown): AiRisk {
  return value === "medium" || value === "high" ? value : "low";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeToolCall(value: unknown): AiToolCall | null {
  const record = asRecord(value);
  if (!record) return null;

  const name = record.name ?? record.tool;
  if (typeof name !== "string" || name.trim() === "") return null;

  const args = asRecord(record.arguments) ?? asRecord(record.params) ??
    asRecord(record.args) ?? {};

  return { name: name.trim(), arguments: args };
}

function normalizeToolCalls(parsed: Record<string, unknown>): AiToolCall[] {
  const candidates: unknown[] = [];

  if (Array.isArray(parsed.tool_calls)) candidates.push(...parsed.tool_calls);
  if (Array.isArray(parsed.tools)) candidates.push(...parsed.tools);
  if (parsed.tool_call !== undefined) candidates.push(parsed.tool_call);

  if (parsed.action !== undefined && parsed.action !== null) {
    candidates.push({
      name: parsed.action,
      arguments: parsed.arguments ?? parsed.params ?? {},
    });
  }

  return candidates
    .map(normalizeToolCall)
    .filter((call): call is AiToolCall => call !== null);
}

/**
 * Normaliza e valida a resposta do LLM. Formatos alternativos (`tools`,
 * `tool_call`, `action`) são aceitos porque modelos diferentes divergem no
 * nome do campo.
 */
export function parseAiResponse(raw: string): AiResponse {
  const json = extractJsonObject(raw);
  if (json === null) {
    throw new AiResponseParseError("Resposta do LLM sem objeto JSON");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new AiResponseParseError("JSON inválido na resposta do LLM", { cause: error });
  }

  const record = asRecord(parsed);
  if (!record) {
    throw new AiResponseParseError("Resposta do LLM não é um objeto");
  }

  const analysisRecord = asRecord(record.analysis) ?? {};
  const summary = analysisRecord.summary ?? analysisRecord.description ??
    record.summary ?? record.message ?? "";

  const normalized = {
    confidence: clampConfidence(record.confidence),
    analysis: {
      risk: normalizeRisk(analysisRecord.risk ?? record.risk),
      summary: typeof summary === "string" ? summary : String(summary),
    },
    toolCalls: normalizeToolCalls(record),
  };

  const result = AiResponseSchema.safeParse(normalized);
  if (!result.success) {
    throw new AiResponseParseError("Resposta do LLM fora do contrato", {
      cause: result.error,
    });
  }

  return result.data;
}
