import { z } from "zod";
import { isValidDuration } from "./shared/utils/duration.ts";
import type { LogLevel } from "./shared/logger/index.ts";

export const APP_ENVS = ["development", "test", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export interface Argon2Config {
  readonly memoryKiB: number;
  readonly iterations: number;
  readonly parallelism: number;
}

export interface AiConfig {
  readonly enabled: boolean;
  readonly apiBaseUrl?: string;
  readonly apiKey?: string;
  readonly chatModel?: string;
  readonly embeddingsModel?: string;
  readonly embeddingDimensions?: number;
  readonly workerIntervalMs: number;
  readonly maxRetries: number;
  readonly confidenceThreshold: number;
  readonly maxEventsPerBatch: number;
  readonly correlationThreshold: number;
  readonly ollamaUrl: string;
  readonly ollamaModel?: string;
}

export interface AppConfig {
  readonly env: AppEnv;
  readonly isProduction: boolean;
  readonly port: number;
  readonly databasePath: string;
  readonly appOrigin: string;
  readonly cookieSecure: boolean;
  readonly jwtSecret: string;
  /** `true` quando o segredo foi gerado em memória (apenas dev/test). */
  readonly jwtSecretIsEphemeral: boolean;
  readonly accessTokenTtl: string;
  readonly refreshTokenTtl: string;
  readonly argon2: Argon2Config;
  readonly logLevel: LogLevel;
  readonly vectorExtensionPath?: string;
  readonly ai: AiConfig;
}

export class ConfigError extends Error {
  readonly details: readonly string[];

  constructor(message: string, details: readonly string[] = []) {
    super(message);
    this.name = "ConfigError";
    this.details = details;
  }
}

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const envBoolean = (fallback: boolean) =>
  z.preprocess((value) => {
    const normalized = emptyToUndefined(value);
    if (normalized === undefined) return fallback;
    if (typeof normalized === "boolean") return normalized;
    if (typeof normalized === "string") {
      const lowered = normalized.toLowerCase();
      if (["true", "1", "yes", "on"].includes(lowered)) return true;
      if (["false", "0", "no", "off"].includes(lowered)) return false;
    }
    return normalized;
  }, z.boolean());

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalPositiveInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().positive().optional(),
);

const duration = z
  .string()
  .refine(isValidDuration, "Use um formato de duração como 15m, 30d ou 3600s");

const rawConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  ENV: z.enum(APP_ENVS).default("development"),
  DATABASE_PATH: z.string().min(1).default("./data/app.db"),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  COOKIE_SECURE: z.enum(["auto", "true", "false"]).default("auto"),
  JWT_SECRET: optionalString,
  ACCESS_TOKEN_TTL: duration.default("15m"),
  REFRESH_TOKEN_TTL: duration.default("30d"),
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(8).default(65_536),
  ARGON2_ITERATIONS: z.coerce.number().int().min(1).max(20).default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(4),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  VECTOR_EXTENSION_PATH: optionalString,
  AI_ENABLED: envBoolean(false),
  AI_API_BASE_URL: optionalUrl,
  AI_API_KEY: optionalString,
  AI_API_MODEL_CHAT_NAME: optionalString,
  AI_API_MODEL_EMBEDDINGS_NAME: optionalString,
  AI_EMBEDDING_DIMENSIONS: optionalPositiveInt,
  AI_WORKER_INTERVAL: z.coerce.number().int().min(100).default(5000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(20).default(3),
  AI_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  AI_MAX_EVENTS_PER_BATCH: z.coerce.number().int().min(1).max(100).default(10),
  AI_CORRELATION_THRESHOLD: z.coerce.number().int().min(1).default(50),
  AI_OLLAMA_URL: z.string().url().default("http://localhost:11434"),
  AI_MODEL: optionalString,
});

/**
 * Lê e valida toda a configuração de ambiente.
 *
 * `Deno.env` só pode ser acessado aqui: o resto da aplicação recebe `AppConfig`
 * por injeção de dependência. Falhar no boot é preferível a rodar com valores
 * inválidos.
 */
export function loadConfig(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): AppConfig {
  const parsed = rawConfigSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => {
      const path = issue.path.join(".") || "env";
      return `${path}: ${issue.message}`;
    });
    throw new ConfigError("Configuração de ambiente inválida", details);
  }

  const raw = parsed.data;
  const isProduction = raw.ENV === "production";

  if (isProduction && !raw.JWT_SECRET) {
    throw new ConfigError("Configuração de ambiente inválida", [
      "JWT_SECRET: obrigatório em produção",
    ]);
  }

  if (isProduction && raw.JWT_SECRET !== undefined && raw.JWT_SECRET.length < 32) {
    throw new ConfigError("Configuração de ambiente inválida", [
      "JWT_SECRET: deve ter pelo menos 32 caracteres",
    ]);
  }

  if (raw.AI_ENABLED && !raw.AI_API_BASE_URL) {
    throw new ConfigError("Configuração de ambiente inválida", [
      "AI_API_BASE_URL: obrigatório quando AI_ENABLED=true",
    ]);
  }

  if (raw.AI_ENABLED && raw.AI_EMBEDDING_DIMENSIONS === undefined) {
    throw new ConfigError("Configuração de ambiente inválida", [
      "AI_EMBEDDING_DIMENSIONS: obrigatório quando AI_ENABLED=true",
    ]);
  }

  const cookieSecure = raw.COOKIE_SECURE === "auto" ? isProduction : raw.COOKIE_SECURE === "true";
  const jwtSecretIsEphemeral = raw.JWT_SECRET === undefined;

  return {
    env: raw.ENV,
    isProduction,
    port: raw.PORT,
    databasePath: raw.DATABASE_PATH,
    appOrigin: raw.APP_ORIGIN,
    cookieSecure,
    jwtSecret: raw.JWT_SECRET ?? generateEphemeralSecret(),
    jwtSecretIsEphemeral,
    accessTokenTtl: raw.ACCESS_TOKEN_TTL,
    refreshTokenTtl: raw.REFRESH_TOKEN_TTL,
    argon2: {
      memoryKiB: raw.ARGON2_MEMORY_KIB,
      iterations: raw.ARGON2_ITERATIONS,
      parallelism: raw.ARGON2_PARALLELISM,
    },
    logLevel: raw.LOG_LEVEL,
    vectorExtensionPath: raw.VECTOR_EXTENSION_PATH,
    ai: {
      enabled: raw.AI_ENABLED,
      apiBaseUrl: raw.AI_API_BASE_URL,
      apiKey: raw.AI_API_KEY,
      chatModel: raw.AI_API_MODEL_CHAT_NAME,
      embeddingsModel: raw.AI_API_MODEL_EMBEDDINGS_NAME,
      embeddingDimensions: raw.AI_EMBEDDING_DIMENSIONS,
      workerIntervalMs: raw.AI_WORKER_INTERVAL,
      maxRetries: raw.AI_MAX_RETRIES,
      confidenceThreshold: raw.AI_CONFIDENCE_THRESHOLD,
      maxEventsPerBatch: raw.AI_MAX_EVENTS_PER_BATCH,
      correlationThreshold: raw.AI_CORRELATION_THRESHOLD,
      ollamaUrl: raw.AI_OLLAMA_URL,
      ollamaModel: raw.AI_MODEL,
    },
  };
}

function generateEphemeralSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll("=", "");
}
