import type { createApp } from "../../src/app.ts";

type TestApp = ReturnType<typeof createApp>;

/**
 * Env de conexão para `app.request`: simula o Nginx como peer confiável, para
 * que os testes possam variar `X-Forwarded-For` como o proxy faria.
 */
export const TEST_CONN_ENV = {
  remoteAddr: { hostname: "127.0.0.1", port: 1234 },
} as const;

/** Lê todos os `Set-Cookie` e devolve nome → valor (vazio quando removido). */
export function parseSetCookies(headers: Headers): Map<string, string> {
  const cookies = new Map<string, string>();

  for (const header of headers.getSetCookie()) {
    const pair = header.split(";")[0];
    if (pair === undefined) continue;
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    cookies.set(name, value);
  }

  return cookies;
}

export function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies.entries()]
    .filter(([, value]) => value !== "")
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

/**
 * Cliente de teste com jar de cookies e token CSRF. Simula o navegador:
 * absorve `Set-Cookie` e reenvia o double-submit automaticamente.
 */
export class AuthTestClient {
  readonly cookies = new Map<string, string>();
  csrfToken = "";
  readonly #app: TestApp;

  constructor(app: TestApp) {
    this.#app = app;
  }

  async bootstrapCsrf(): Promise<void> {
    const response = await this.#app.request("/api/v1/auth/csrf", {}, TEST_CONN_ENV);
    this.#absorb(response);
  }

  /**
   * Envia `multipart/form-data` com cookies e CSRF do jar. O `content-type`
   * (com boundary) é definido pelo próprio `FormData`.
   */
  async requestForm(path: string, form: FormData, method = "POST"): Promise<Response> {
    const headers: Record<string, string> = {};

    const cookie = cookieHeader(this.cookies);
    if (cookie !== "") headers.cookie = cookie;
    headers["x-csrf-token"] = this.csrfToken;

    const response = await this.#app.request(path, { method, headers, body: form }, TEST_CONN_ENV);
    this.#absorb(response);
    return response;
  }

  async request(
    path: string,
    options: {
      readonly method?: string;
      readonly body?: unknown;
      readonly headers?: Record<string, string>;
      readonly useCsrf?: boolean;
    } = {},
  ): Promise<Response> {
    const method = options.method ?? "GET";
    const headers: Record<string, string> = { ...options.headers };

    const cookie = cookieHeader(this.cookies);
    if (cookie !== "") headers.cookie = cookie;

    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const isSafe = method === "GET" || method === "HEAD" || method === "OPTIONS";
    if (!isSafe && options.useCsrf !== false) {
      headers["x-csrf-token"] = this.csrfToken;
    }

    const response = await this.#app.request(
      path,
      {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      TEST_CONN_ENV,
    );

    this.#absorb(response);
    return response;
  }

  #absorb(response: Response): void {
    for (const [name, value] of parseSetCookies(response.headers)) {
      if (value === "") {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }

    const csrf = this.cookies.get("vb_csrf");
    if (csrf !== undefined) this.csrfToken = csrf;
  }
}
