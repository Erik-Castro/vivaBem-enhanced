import { assertEquals, assertThrows } from "@std/assert";
import { ConfigError, loadConfig } from "../../src/config.ts";

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
