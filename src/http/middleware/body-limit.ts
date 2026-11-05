import { bodyLimit as honoBodyLimit } from "@hono/hono/body-limit";
import { AppError } from "../errors.ts";

export const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * Limita o corpo da requisição (padrão: 1 MB). O limite existe para evitar
 * consumo de memória por payloads maliciosos ou acidentais.
 */
export function bodyLimit(maxBytes: number = DEFAULT_BODY_LIMIT_BYTES) {
  return honoBodyLimit({
    maxSize: maxBytes,
    onError: () => {
      throw new AppError("PAYLOAD_TOO_LARGE", "Corpo da requisição excede o limite permitido");
    },
  });
}
