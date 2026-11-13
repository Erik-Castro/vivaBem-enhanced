import type { User } from "./types";
import {
  enqueueMutation,
  listPending,
  pendingCount,
  removeFromQueue,
  updateCsrfSnapshot,
} from "./offline-queue";

const API_BASE = "/api/v1";
const CSRF_COOKIE = "vb_csrf";
const CSRF_HEADER = "X-CSRF-Token";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const IDEMPOTENCY_HEADER = "Idempotency-Key";
const OFFLINE_SYNC_TAG = "vivabem-flush";

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
  /** Suprime o enfileiramento offline (usa quando já está sendo tratado). */
  readonly noOfflineQueue?: boolean;
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
let isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
let replaying = false;

/** Liga o cliente HTTP ao store de autenticação sem criar dependência circular. */
export function setAuthHooks(hooks: AuthHooks): void {
  authHooks = hooks;
}

export function setCsrfToken(token: string): void {
  csrfMemory = token;
  // Mantém o snapshot da fila offline alinhado com o token atual, para o
  // service worker conseguir reproduzir mutações sem aba aberta.
  void updateCsrfSnapshot(token).catch(() => undefined);
}

export function isOffline(): boolean {
  return !isOnline;
}

export async function pendingMutationsCount(): Promise<number> {
  return pendingCount();
}

/**
 * Agenda o flush da fila offline no service worker.
 *
 * Sem a Background Sync API (Firefox/Safari) a chamada falha em silêncio: o
 * listener de `online` continua sendo o caminho de replay.
 */
async function requestBackgroundSync(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  try {
    // `ready` só resolve quando existe registro; em dev não há service worker.
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration === undefined) return;

    const sync = (
      registration as ServiceWorkerRegistration & {
        readonly sync?: { readonly register: (tag: string) => Promise<void> };
      }
    ).sync;

    await sync?.register(OFFLINE_SYNC_TAG);
  } catch {
    // API ausente, permissão negada ou contexto inseguro: não é erro de app.
  }
}

/** Enfileira a mutação e agenda a sincronização em segundo plano. */
async function queueMutation(
  key: string,
  method: string,
  path: string,
  body: unknown,
  csrf: string | undefined,
): Promise<void> {
  await enqueueMutation(key, method, path, body, csrf);
  await requestBackgroundSync();
}

/**
 * Reexecute as mutações enfileiradas enquanto estava offline.
 * Deve ser chamado quando a conexão retorna.
 */
export async function replayQueue(): Promise<void> {
  if (replaying || isOffline()) return;
  replaying = true;

  try {
    const pending = await listPending();

    for (const entry of pending) {
      try {
        const headers: Record<string, string> = {
          Accept: "application/json",
          [IDEMPOTENCY_HEADER]: entry.key,
          [CSRF_HEADER]: await ensureCsrfToken(),
        };

        if (entry.body !== null) {
          headers["Content-Type"] = "application/json";
        }

        const response = await fetch(
          `${API_BASE}${entry.path}`,
          {
            method: entry.method,
            credentials: "include",
            headers,
            body: entry.body,
          },
        );

        if (response.ok || response.status === 409) {
          // 409 pode ser "conflito" mas a operação já pode ter sido aplicada
          // (idempotência no servidor deve lidar com isso).
          await removeFromQueue(entry.id);
        } else {
          // Mantém na fila para tentar novamente depois
          break;
        }
      } catch {
        // Falha de rede durante replay: para e tenta de novo depois
        break;
      }
    }
  } finally {
    replaying = false;
  }
}

function setupOnlineListener(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("online", () => {
    isOnline = true;
    void replayQueue();
  });

  window.addEventListener("offline", () => {
    isOnline = false;
  });
}

setupOnlineListener();

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

  const isMutating = MUTATING_METHODS.has(method);
  let idempotencyKey: string | undefined;

  if (isMutating) {
    headers[CSRF_HEADER] = await ensureCsrfToken();
    idempotencyKey = crypto.randomUUID();
    headers[IDEMPOTENCY_HEADER] = idempotencyKey;
  }

  // Se estiver offline e for uma mutação, enfileira e retorna um envelope
  // simulado. A UI deve tratar isso como "pendente" e sincronizar depois.
  if (isOffline() && isMutating && idempotencyKey !== undefined && !options.noOfflineQueue) {
    await queueMutation(idempotencyKey, method, path, options.body, headers[CSRF_HEADER]);
    return {
      data: undefined as T,
      meta: { requestId: "offline-queued" },
    };
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

    // Falha de rede: se for mutação e não desabilitou fila offline, enfileira.
    if (isMutating && idempotencyKey !== undefined && !options.noOfflineQueue) {
      await queueMutation(idempotencyKey, method, path, options.body, headers[CSRF_HEADER]);
    }

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
