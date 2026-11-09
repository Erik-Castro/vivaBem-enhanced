import { createApp } from "../../src/app.ts";
import { type AppConfig, loadConfig } from "../../src/config.ts";
import { createLogger } from "../../src/shared/logger/index.ts";
import { seedAchievements } from "../../src/modules/achievements/achievements.seed.ts";
import { createTestDatabase, type TestDatabase } from "./db.ts";

export interface TestServer {
  readonly baseUrl: string;
  readonly origin: string;
  readonly database: TestDatabase;
  readonly config: AppConfig;
  close(): Promise<void>;
}

/**
 * Sobe a app em uma porta aleatória de verdade.
 *
 * Diferente de `app.request`, este helper exercita a pilha HTTP completa:
 * sockets, parsing de cookies, headers e shutdown. O banco é temporário e a
 * porta é liberada no `close()`.
 */
export async function startTestServer(): Promise<TestServer> {
  const config = loadConfig({
    ENV: "test",
    APP_ORIGIN: "http://localhost:3000",
    DATABASE_PATH: ":memory:",
    RATE_LIMIT_AUTH_MAX: "1000",
    RATE_LIMIT_DATA_MAX: "1000",
  });
  const logger = createLogger({ level: "error", silent: true });
  const database = await createTestDatabase();
  seedAchievements(database.db);
  const app = createApp({ db: database.db, config, logger });

  const server = Deno.serve(
    { port: 0, hostname: "127.0.0.1", onListen: () => {} },
    app.fetch,
  );

  return {
    baseUrl: `http://127.0.0.1:${server.addr.port}`,
    origin: config.appOrigin,
    database,
    config,
    close: async () => {
      await server.shutdown();
      database.cleanup();
    },
  };
}

export interface HttpRequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/**
 * Cliente HTTP com cookie jar mínimo, para testar o fluxo como um browser.
 *
 * O `Origin` é enviado em métodos mutáveis e o `X-CSRF-Token` sai do cookie
 * `vb_csrf`, reproduzindo o double-submit real.
 */
export class HttpTestClient {
  readonly cookies = new Map<string, string>();
  csrfToken = "";
  readonly #baseUrl: string;
  readonly #origin: string;

  constructor(server: TestServer) {
    this.#baseUrl = server.baseUrl;
    this.#origin = server.origin;
  }

  async request(path: string, options: HttpRequestOptions = {}): Promise<Response> {
    const method = options.method ?? "GET";
    const headers: Record<string, string> = { ...options.headers };

    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (cookie !== "") headers.cookie = cookie;

    const isSafe = method === "GET" || method === "HEAD" || method === "OPTIONS";
    if (!isSafe) {
      headers.origin = this.#origin;
      headers["x-csrf-token"] = this.csrfToken;
    }

    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const response = await fetch(`${this.#baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    this.#absorb(response);
    return response;
  }

  async bootstrapCsrf(): Promise<void> {
    const response = await this.request("/api/v1/auth/csrf");
    if (!response.ok) {
      throw new Error(`Falha ao obter CSRF: ${response.status}`);
    }
  }

  #absorb(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";")[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    this.csrfToken = this.cookies.get("vb_csrf") ?? "";
  }
}
