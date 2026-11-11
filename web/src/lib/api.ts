import type { User } from "./types";

const API_BASE = "/api/v1";
const CSRF_COOKIE = "vb_csrf";
const CSRF_HEADER = "X-CSRF-Token";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface ApiMeta {
  readonly requestId?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly hasMore?: boolean;
}

export interface ApiEnvelope<T> {
  readonly data: T;
  readonly meta: ApiMeta;
}

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  /** Envia `multipart/form-data`; o `Content-Type` é definido pelo navegador. */
  readonly form?: FormData;
  readonly query?: Record<string, QueryValue>;
  /** `false` impede a tentativa automática de refresh em respostas 401. */
  readonly retry?: boolean;
  readonly signal?: AbortSignal;
}

interface ErrorShape {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly details?: unknown;
    readonly requestId?: string;
  };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(status: number, payload: unknown) {
    const shape = (payload ?? {}) as ErrorShape;
    const message = shape.error?.message ?? `Falha na requisição (${status})`;

    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = shape.error?.code ?? "UNKNOWN_ERROR";
    this.details = shape.error?.details ?? null;
    this.requestId = shape.error?.requestId;
  }
}

interface AuthHooks {
  readonly refreshed?: (user: User) => void;
  readonly expired?: () => void;
}

let authHooks: AuthHooks = {};
let csrfMemory: string | null = null;
let csrfPromise: Promise<string> | null = null;
let refreshPromise: Promise<boolean> | null = null;

/** Liga o cliente HTTP ao store de autenticação sem criar dependência circular. */
export function setAuthHooks(hooks: AuthHooks): void {
  authHooks = hooks;
}

export function setCsrfToken(token: string): void {
  csrfMemory = token;
}

function getCookie(name: string): string | null {
  const prefix = `${name}=`;

  for (const part of document.cookie.split(";")) {
    const entry = part.trim();

    if (entry.startsWith(prefix)) {
      return decodeURIComponent(entry.slice(prefix.length));
    }
  }

  return null;
}

async function fetchCsrfToken(): Promise<string> {
  const response = await fetch(`${API_BASE}/auth/csrf`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new ApiError(response.status, {
      error: { code: "CSRF_ERROR", message: "Não foi possível iniciar a proteção CSRF" },
    });
  }

  const payload = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;
  csrfMemory = payload.data.csrfToken;
  return payload.data.csrfToken;
}

export function ensureCsrfToken(): Promise<string> {
  const cookie = getCookie(CSRF_COOKIE);

  if (cookie) return Promise.resolve(cookie);
  if (csrfMemory) return Promise.resolve(csrfMemory);

  csrfPromise ??= fetchCsrfToken().finally(() => {
    csrfPromise = null;
  });

  return csrfPromise;
}

async function refreshSession(): Promise<boolean> {
  try {
    const token = await ensureCsrfToken();
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", [CSRF_HEADER]: token },
    });

    if (!response.ok) {
      authHooks.expired?.();
      return false;
    }

    const payload = (await response.json()) as ApiEnvelope<{ user: User; csrfToken: string }>;
    csrfMemory = payload.data.csrfToken;
    authHooks.refreshed?.(payload.data.user);
    return true;
  } catch {
    authHooks.expired?.();
    return false;
  }
}

/** Rotaciona a sessão uma única vez mesmo com várias requisições concorrentes em 401. */
export function refreshSessionOnce(): Promise<boolean> {
  refreshPromise ??= refreshSession().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }

  return `${url.pathname}${url.search}`;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiEnvelope<T>> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };

  if (options.form === undefined && options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (MUTATING_METHODS.has(method)) {
    headers[CSRF_HEADER] = await ensureCsrfToken();
  }

  let response: Response;

  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      credentials: "include",
      headers,
      body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;

    throw new ApiError(0, {
      error: { code: "NETWORK_ERROR", message: "Sem conexão com o servidor" },
    });
  }

  if (response.status === 401 && options.retry !== false && !path.startsWith("/auth/")) {
    const refreshed = await refreshSessionOnce();

    if (refreshed) {
      return apiRequest<T>(path, { ...options, retry: false });
    }
  }

  if (response.status === 204) {
    return { data: undefined as T, meta: {} };
  }

  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, payload);
  }

  if (payload === null || typeof payload !== "object" || !("data" in payload)) {
    throw new ApiError(response.status, {
      error: { code: "INVALID_RESPONSE", message: "Resposta inválida do servidor" },
    });
  }

  return payload as ApiEnvelope<T>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const envelope = await apiRequest<T>(path, options);
  return envelope.data;
}

export interface DownloadResult {
  readonly blob: Blob;
  readonly fileName: string | null;
}

/**
 * Baixa um recurso autenticado por cookie (ex.: export CSV).
 * Diferente de `api`, não espera um envelope JSON.
 */
export async function download(
  path: string,
  query?: Record<string, QueryValue>,
  retry = true,
): Promise<DownloadResult> {
  let response: Response;

  try {
    response = await fetch(buildUrl(path, query), {
      credentials: "include",
      headers: { Accept: "*/*" },
    });
  } catch {
    throw new ApiError(0, {
      error: { code: "NETWORK_ERROR", message: "Sem conexão com o servidor" },
    });
  }

  if (response.status === 401 && retry) {
    const refreshed = await refreshSessionOnce();

    if (refreshed) return download(path, query, false);
  }

  if (!response.ok) {
    let payload: unknown = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    throw new ApiError(response.status, payload);
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);

  return { blob: await response.blob(), fileName: match?.[1] ?? null };
}

/** Traduz erros da API em uma mensagem curta para a interface. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "VALIDATION_ERROR" && Array.isArray(error.details)) {
      const first = error.details[0] as { message?: unknown } | undefined;

      if (first && typeof first.message === "string") {
        return first.message;
      }
    }

    if (error.code === "RATE_LIMITED") {
      return "Muitas tentativas. Aguarde um instante e tente novamente.";
    }

    return error.message;
  }

  if (error instanceof Error) return error.message;

  return "Algo deu errado. Tente novamente.";
}
