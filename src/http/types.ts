import type { Logger } from "../shared/logger/index.ts";

/** Variáveis disponíveis no contexto Hono de toda requisição. */
export interface AppEnv {
  Variables: {
    requestId: string;
    logger: Logger;
    userId?: string;
  };
}
