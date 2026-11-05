import { createMiddleware } from "@hono/hono/factory";
import type { AppEnv } from "../types.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";

export const REQUEST_ID_HEADER = "X-Request-Id";

// Aceita apenas IDs simples vindos de proxies; qualquer coisa estranha é
// substituída para não poluir logs nem headers.
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export const requestId = createMiddleware<AppEnv, "*">(async (c, next) => {
  const incoming = c.req.header(REQUEST_ID_HEADER);
  const id = incoming !== undefined && VALID_REQUEST_ID.test(incoming) ? incoming : uuidv7();

  c.set("requestId", id);
  c.header(REQUEST_ID_HEADER, id);

  await next();
});
