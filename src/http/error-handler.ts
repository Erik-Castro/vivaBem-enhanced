import type { Context } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { ZodError } from "zod";
import { AppError, codeFromStatus, isAppError } from "./errors.ts";
import type { AppEnv } from "./types.ts";
import { uuidv7 } from "../shared/utils/uuid.ts";

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: readonly unknown[];
    requestId: string;
  };
}

/**
 * Resposta de erro padronizada. Nunca vaza stack trace ou detalhes internos
 * em erros 5xx.
 */
export function toErrorResponse(error: unknown, c: Context<AppEnv>): Response {
  const requestId = c.get("requestId") ?? uuidv7();
  const logger = c.get("logger");

  const appError = normalizeError(error);

  if (appError.status >= 500) {
    logger?.error("request_failed", {
      requestId,
      code: appError.code,
      error,
      method: c.req.method,
      path: c.req.path,
    });
  } else {
    logger?.warn("request_rejected", {
      requestId,
      code: appError.code,
      method: c.req.method,
      path: c.req.path,
      details: appError.details,
    });
  }

  const body: ErrorBody = {
    error: {
      code: appError.code,
      message: appError.expose ? appError.message : "Erro interno do servidor",
      requestId,
    },
  };

  if (appError.details && appError.details.length > 0) {
    body.error.details = appError.details;
  }

  return new Response(JSON.stringify(body), {
    status: appError.status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function normalizeError(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof ZodError) {
    return new AppError("VALIDATION_ERROR", "Dados inválidos", {
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  if (error instanceof HTTPException) {
    return new AppError(codeFromStatus(error.status), error.message, {
      cause: error,
      expose: error.status < 500,
    });
  }

  return new AppError("INTERNAL_ERROR", "Erro interno do servidor", {
    cause: error,
    expose: false,
  });
}
