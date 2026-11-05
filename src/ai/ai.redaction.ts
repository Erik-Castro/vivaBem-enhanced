const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/gi;
const CPF_PATTERN = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const PHONE_PATTERN = /(\+?55\s?)?(\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}\b/g;
const LONG_DIGITS_PATTERN = /\b\d{13,19}\b/g;

const SENSITIVE_KEYS =
  /(password|passwd|senha|token|secret|segredo|authorization|cookie|api[-_]?key)/i;
const MAX_DEPTH = 6;
const MAX_STRING = 4_000;

function redactString(value: string): string {
  return value
    .slice(0, MAX_STRING)
    .replace(EMAIL_PATTERN, "[EMAIL]")
    .replace(CPF_PATTERN, "[CPF]")
    .replace(LONG_DIGITS_PATTERN, "[NÚMERO]")
    .replace(PHONE_PATTERN, "[TELEFONE]");
}

/**
 * Remove PII óbvia antes de enviar contexto a um provider externo.
 *
 * IPs e user agents são mantidos de propósito: sem eles o contexto de segurança
 * não consegue analisar tentativas de login. O modo Ollama (local) também passa
 * por aqui, porque a redação é barata e evita vazamento por configuração errada.
 */
export function redactForProvider(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCADO]";
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") return redactString(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactForProvider(item, depth + 1));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SENSITIVE_KEYS.test(key) ? "[REMOVIDO]" : redactForProvider(entry, depth + 1);
    }
    return output;
  }

  return null;
}
