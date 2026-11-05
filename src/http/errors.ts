/**
 * Taxonomia única de erros da API. Todo erro de negócio deve ser um `AppError`
 * com um destes códigos — nunca `throw new Error("texto")` genérico.
 */
export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  AI_DISABLED: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ErrorDetail {
  readonly path?: string;
  readonly message: string;
  readonly [key: string]: unknown;
}

export interface AppErrorOptions {
  readonly details?: readonly ErrorDetail[];
  readonly cause?: unknown;
  /** Quando `false`, a mensagem real é substituída por uma genérica na resposta. */
  readonly expose?: boolean;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: readonly ErrorDetail[];
  readonly expose: boolean;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = options.details;
    this.expose = options.expose ?? this.status < 500;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Converte um status HTTP arbitrário no código de erro mais próximo. */
export function codeFromStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return "VALIDATION_ERROR";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 413:
      return "PAYLOAD_TOO_LARGE";
    case 429:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_ERROR";
  }
}
