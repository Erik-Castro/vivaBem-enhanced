import { assert, assertEquals, assertThrows } from "@std/assert";
import { ConfigError, loadConfig, loadWorkerConfig } from "../../src/config.ts";
import { base64UrlEncode } from "../../src/shared/crypto/tokens.ts";

Deno.test("config usa defaults de desenvolvimento", () => {
  const config = loadConfig({});

  assertEquals(config.env, "development");
  assertEquals(config.port, 3000);
  assertEquals(config.databasePath, "./data/app.db");
  assertEquals(config.cookieSecure, false);
  assertEquals(config.logLevel, "info");
  assertEquals(config.argon2.memoryKiB, 65_536);
  assertEquals(config.jwtSecretIsEphemeral, true);
  assertEquals(config.jwtSecret.length > 0, true);
});

Deno.test("config rejeita porta inválida", () => {
  assertThrows(() => loadConfig({ PORT: "abc" }), ConfigError);
  assertThrows(() => loadConfig({ PORT: "70000" }), ConfigError);
});

Deno.test("config rejeita duração inválida", () => {
  assertThrows(() => loadConfig({ ACCESS_TOKEN_TTL: "quinze minutos" }), ConfigError);
});

Deno.test("produção exige JWT_SECRET", () => {
  const error = assertThrows(() => loadConfig({ ENV: "production" }), ConfigError) as ConfigError;
  assertEquals(error.details, ["JWT_SECRET: obrigatório em produção"]);
});

Deno.test("produção rejeita segredo curto", () => {
  assertThrows(
    () => loadConfig({ ENV: "production", JWT_SECRET: "curto" }),
    ConfigError,
  );
});

Deno.test("produção com segredo válido ativa cookies Secure", () => {
  const config = loadConfig({
    ENV: "production",
    JWT_SECRET: "x".repeat(32),
    APP_ORIGIN: "https://app.vivabem.example",
  });

  assertEquals(config.isProduction, true);
  assertEquals(config.cookieSecure, true);
  assertEquals(config.jwtSecretIsEphemeral, false);
});

Deno.test("COOKIE_SECURE=false sobrepõe o padrão em produção", () => {
  const config = loadConfig({
    ENV: "production",
    JWT_SECRET: "x".repeat(32),
    COOKIE_SECURE: "false",
  });

  assertEquals(config.cookieSecure, false);
});

Deno.test("IA exige base URL e dimensões quando habilitada", () => {
  assertThrows(() => loadConfig({ AI_ENABLED: "true" }), ConfigError);
  assertThrows(
    () => loadConfig({ AI_ENABLED: "true", AI_API_BASE_URL: "http://localhost:11434/v1" }),
    ConfigError,
  );
});

Deno.test("IA habilitada com configuração completa", () => {
  const config = loadConfig({
    AI_ENABLED: "true",
    AI_API_BASE_URL: "http://localhost:11434/v1",
    AI_API_MODEL_CHAT_NAME: "gpt-4o-mini",
    AI_API_MODEL_EMBEDDINGS_NAME: "text-embedding-3-small",
    AI_EMBEDDING_DIMENSIONS: "768",
  });

  assertEquals(config.ai.enabled, true);
  assertEquals(config.ai.provider, "openai");
  assertEquals(config.ai.embeddingDimensions, 768);
});

Deno.test("worker herda AI_* e aplica defaults próprios", () => {
  const config = loadWorkerConfig({
    AI_WORKER_INTERVAL: "1500",
    AI_MAX_RETRIES: "4",
    AI_REQUEST_TIMEOUT: "30000",
  });

  assertEquals(config.worker.id, undefined);
  assertEquals(config.worker.pollIntervalMs, 1_500);
  assertEquals(config.worker.leaseMs, 60_000);
  assertEquals(config.worker.heartbeatMs, 15_000);
  assertEquals(config.worker.maxAttempts, 5);
  assertEquals(config.worker.concurrency, 1);
  assertEquals(config.worker.shutdownGraceMs, 30_000);
  assertEquals(config.worker.maxEventsPerBatch, 10);
});

Deno.test("worker aceita WORKER_* explícitos", () => {
  const config = loadWorkerConfig({
    WORKER_ID: "worker-01",
    WORKER_POLL_INTERVAL_MS: "250",
    WORKER_LEASE_MS: "90000",
    WORKER_HEARTBEAT_MS: "10000",
    WORKER_MAX_ATTEMPTS: "2",
    WORKER_CONCURRENCY: "3",
    WORKER_SHUTDOWN_GRACE_MS: "1000",
  });

  assertEquals(config.worker.id, "worker-01");
  assertEquals(config.worker.pollIntervalMs, 250);
  assertEquals(config.worker.leaseMs, 90_000);
  assertEquals(config.worker.heartbeatMs, 10_000);
  assertEquals(config.worker.maxAttempts, 2);
  assertEquals(config.worker.concurrency, 3);
  assertEquals(config.worker.shutdownGraceMs, 1_000);
});

Deno.test("worker exige heartbeat menor que o lease", () => {
  assertThrows(
    () => loadWorkerConfig({ WORKER_HEARTBEAT_MS: "60000", WORKER_LEASE_MS: "60000" }),
    ConfigError,
  );
});

Deno.test("worker rejeita concorrência fora da faixa", () => {
  assertThrows(() => loadWorkerConfig({ WORKER_CONCURRENCY: "9" }), ConfigError);
  assertThrows(() => loadWorkerConfig({ WORKER_CONCURRENCY: "0" }), ConfigError);
});

const VAPID_PUBLIC = JSON.stringify({
  kty: "EC",
  crv: "P-256",
  x: base64UrlEncode(new Uint8Array(32).fill(1)),
  y: base64UrlEncode(new Uint8Array(32).fill(2)),
});
const VAPID_PRIVATE = JSON.stringify({
  kty: "EC",
  crv: "P-256",
  x: base64UrlEncode(new Uint8Array(32).fill(1)),
  y: base64UrlEncode(new Uint8Array(32).fill(2)),
  d: base64UrlEncode(new Uint8Array(32).fill(3)),
});

const PUSH_ENV = {
  PUSH_ENABLED: "true",
  PUSH_VAPID_PUBLIC_KEY: VAPID_PUBLIC,
  PUSH_VAPID_PRIVATE_KEY: VAPID_PRIVATE,
  PUSH_VAPID_SUBJECT: "mailto:test@vivabem.local",
};

Deno.test("push vem desligado por padrão", () => {
  const config = loadConfig({});

  assertEquals(config.push.enabled, false);
  assertEquals(config.push.ttlSeconds, 86_400);
  assertEquals(config.push.maxAttempts, 3);
  assertEquals(config.push.batchSize, 20);
});

Deno.test("push habilitado exige as três variáveis VAPID", () => {
  const error = assertThrows(
    () => loadConfig({ PUSH_ENABLED: "true" }),
    ConfigError,
  ) as ConfigError;

  assertEquals(error.details.length, 3);
  assert(error.details.some((detail) => detail.startsWith("PUSH_VAPID_PUBLIC_KEY:")));
});

Deno.test("push exige sujeito mailto ou https", () => {
  assertThrows(
    () => loadConfig({ ...PUSH_ENV, PUSH_VAPID_SUBJECT: "test@vivabem.local" }),
    ConfigError,
  );
});

Deno.test("push rejeita JWK fora do padrão EC P-256", () => {
  assertThrows(
    () => loadConfig({ ...PUSH_ENV, PUSH_VAPID_PUBLIC_KEY: JSON.stringify({ kty: "RSA" }) }),
    ConfigError,
  );

  assertThrows(
    () =>
      loadConfig({
        ...PUSH_ENV,
        PUSH_VAPID_PRIVATE_KEY: JSON.stringify({
          kty: "EC",
          crv: "P-256",
          x: base64UrlEncode(new Uint8Array(32).fill(1)),
          y: base64UrlEncode(new Uint8Array(32).fill(2)),
        }),
      }),
    ConfigError,
  );
});

Deno.test("push habilitado com configuração completa", () => {
  const config = loadConfig({
    ...PUSH_ENV,
    PUSH_TTL_SECONDS: "3600",
    PUSH_DISPATCH_INTERVAL: "5000",
    PUSH_MAX_ATTEMPTS: "5",
  });

  assertEquals(config.push.enabled, true);
  assertEquals(config.push.subject, "mailto:test@vivabem.local");
  assertEquals(config.push.ttlSeconds, 3_600);
  assertEquals(config.push.dispatchIntervalMs, 5_000);
  assertEquals(config.push.maxAttempts, 5);
  assertEquals(config.push.vapidPublicKey, VAPID_PUBLIC);
});

Deno.test("worker carrega a configuração de push", () => {
  const config = loadWorkerConfig(PUSH_ENV);
  assertEquals(config.push.enabled, true);
  assertEquals(config.push.vapidPrivateKey, VAPID_PRIVATE);
});
