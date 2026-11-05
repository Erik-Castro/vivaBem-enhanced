import { createApp } from "../../src/app.ts";
import { type AppConfig, loadConfig } from "../../src/config.ts";
import { createLogger, type Logger } from "../../src/shared/logger/index.ts";
import { createTestDatabase, type TestDatabase } from "./db.ts";

export interface TestApp {
  readonly app: ReturnType<typeof createApp>;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly database: TestDatabase;
  cleanup(): void;
}

export interface TestAppOptions {
  readonly env?: Record<string, string | undefined>;
  readonly migrate?: boolean;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const config = loadConfig({
    ENV: "test",
    APP_ORIGIN: "http://localhost:3000",
    DATABASE_PATH: ":memory:",
    RATE_LIMIT_AUTH_MAX: "1000",
    ...options.env,
  });
  const logger = createLogger({ level: "error", silent: true });
  const database = await createTestDatabase({ migrate: options.migrate ?? true });
  const app = createApp({ db: database.db, config, logger });

  return {
    app,
    config,
    logger,
    database,
    cleanup: () => database.cleanup(),
  };
}
