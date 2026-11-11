import { createMiddleware } from "@hono/hono/factory";
import type { AppDatabase } from "../../db/client.ts";
import { AppError } from "../errors.ts";
import type { AppEnv } from "../types.ts";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Middleware de idempotência para escritas.
 *
 * Quando o cabeçalho `Idempotency-Key` está presente em uma requisição
 * mutável, o middleware verifica se essa chave já foi processada para o
 * usuário corrente. Se sim, devolve a resposta em cache em vez de reexecutar
 * a operação. Se não, processa normalmente e armazena a resposta para
 * reutilização futura.
 *
 * A chave é escopada por `user_id` + `method` + `path`, então dois usuários
 * podem usar a mesma chave sem colidir, e o mesmo usuário pode reutilizar uma
 * chave para endpoints diferentes.
 *
 * As entradas expiram após 24h e são removidas pela manutenção operacional.
 *
 * Requer que `requireAuth` já tenha sido executado (o `userId` precisa estar
 * no contexto).
 */
export function idempotency(db: AppDatabase) {
  return createMiddleware<AppEnv, "*">(async (c, next) => {
    const method = c.req.method;

    if (!MUTATING_METHODS.has(method)) {
      await next();
      return;
    }

    const idempotencyKey = c.req.header("Idempotency-Key");
    if (idempotencyKey === undefined || idempotencyKey === "") {
      await next();
      return;
    }

    const userId = c.get("userId");
    if (userId === undefined || userId === "") {
      throw new AppError("UNAUTHORIZED", "Autenticação necessária");
    }

    const path = c.req.path;
    const now = new Date().toISOString();

    // Verifica se já existe uma entrada válida para esta chave.
    const existing = db
      .prepare<[string, string, string, string, string], {
        status: number;
        response_body: string;
        response_headers: string | null;
      }>(
        `SELECT status, response_body, response_headers FROM idempotency_keys
         WHERE key = ? AND user_id = ? AND method = ? AND path = ?
           AND expires_at > ?`,
      )
      .get(idempotencyKey, userId, method, path, now);

    if (existing !== undefined) {
      const headers = existing.response_headers ? JSON.parse(existing.response_headers) : {};
      return new Response(existing.response_body, {
        status: existing.status,
        headers: { "content-type": "application/json", ...headers },
      });
    }

    // Remove entradas expiradas desta chave (limpeza pontual).
    db.prepare<[string, string]>(
      "DELETE FROM idempotency_keys WHERE key = ? AND expires_at <= ?",
    ).run(idempotencyKey, now);

    // Processa a requisição normalmente.
    await next();

    // Captura a resposta para armazenar no cache de idempotência.
    const res = c.res.clone();
    const status = res.status;
    const headers = Object.fromEntries(res.headers.entries());
    const body = await res.text();

    const expiresAt = new Date(Date.now() + TTL_MS).toISOString();

    db.prepare<[string, string, string, string, number, string, string | null, string, string]>(
      `INSERT INTO idempotency_keys
         (key, user_id, method, path, status, response_body, response_headers, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      idempotencyKey,
      userId,
      method,
      path,
      status,
      body,
      JSON.stringify(headers),
      now,
      expiresAt,
    );

    return new Response(body, { status, headers });
  });
}
