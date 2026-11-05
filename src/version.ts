import denoJson from "../deno.json" with { type: "json" };

/**
 * Versão do pacote, lida diretamente do `deno.json` (fonte da verdade).
 * Nunca declare a versão em outro lugar: o CI valida a sincronia.
 */
export const APP_VERSION: string = denoJson.version;

/** Versão do contrato HTTP público. Só muda com quebra de contrato. */
export const API_VERSION = "v1";
