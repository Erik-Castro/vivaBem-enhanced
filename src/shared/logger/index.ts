export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogBindings = Record<string, unknown>;

export interface Logger {
  readonly level: LogLevel;
  debug(message: string, context?: LogBindings): void;
  info(message: string, context?: LogBindings): void;
  warn(message: string, context?: LogBindings): void;
  error(message: string, context?: LogBindings): void;
  /** Cria um logger derivado com campos fixos (ex.: `requestId`). */
  child(bindings: LogBindings): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  bindings?: LogBindings;
  /** Destino das linhas JSON. Útil em testes para capturar a saída. */
  sink?: (line: string, level: LogLevel) => void;
  /** Desliga a saída mantendo a mesma interface. */
  silent?: boolean;
}

const SENSITIVE_KEY =
  /(password|passwd|senha|token|secret|segredo|authorization|cookie|api[-_]?key|refresh)/i;

const MAX_STRING_LENGTH = 2_000;
const MAX_DEPTH = 4;

/**
 * Remove dados sensíveis antes de serializar. Logs nunca devem conter
 * senhas, tokens, cookies ou chaves de API.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCATED]";

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(entry, depth + 1);
    }
    return output;
  }

  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
    return `${value.slice(0, MAX_STRING_LENGTH)}…`;
  }

  return value;
}

const encoder = new TextEncoder();

function defaultSink(line: string, level: LogLevel): void {
  const target = level === "warn" || level === "error" ? Deno.stderr : Deno.stdout;
  try {
    target.writeSync(encoder.encode(`${line}\n`));
  } catch {
    // Logar nunca deve derrubar a aplicação (ex.: stdout fechado no shutdown).
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const bindings = options.bindings ?? {};
  const sink = options.sink ?? defaultSink;
  const silent = options.silent ?? false;

  const write = (entryLevel: LogLevel, message: string, context?: LogBindings): void => {
    if (LEVEL_WEIGHT[entryLevel] < LEVEL_WEIGHT[level]) return;

    const payload = {
      time: new Date().toISOString(),
      level: entryLevel,
      msg: message,
      ...(redact(bindings) as LogBindings),
      ...(context ? (redact(context) as LogBindings) : {}),
    };

    if (!silent) sink(JSON.stringify(payload), entryLevel);
  };

  return {
    level,
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
    child: (extra) => createLogger({ level, bindings: { ...bindings, ...extra }, sink, silent }),
  };
}
