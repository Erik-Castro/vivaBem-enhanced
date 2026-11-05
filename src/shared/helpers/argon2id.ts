import Argon2id from "@rabbit-company/argon2id";

// A lib tenta usar um Web Worker e, para isso, faz `fetch("argon2id_worker.js")`.
// No Deno isso exigiria rede a cada hash. Sem `Worker`, ela usa o fallback WASM
// síncrono, que não faz I/O.
Object.defineProperty(globalThis, "Worker", {
  value: undefined,
  configurable: true,
  writable: true,
});

export interface Argon2idOptions {
  /** Memória em KiB (o padrão da lib, 16, é interpretado como 2^16 KiB). */
  readonly memoryKiB?: number;
  readonly iterations?: number;
  readonly parallelism?: number;
  readonly hashLength?: number;
}

const DEFAULTS: Required<Argon2idOptions> = {
  memoryKiB: 65_536,
  iterations: 3,
  parallelism: 4,
  hashLength: 32,
};

/**
 * Gera um hash Argon2id no formato PHC (`$argon2id$v=19$m=...`).
 * Os parâmetros ficam embutidos no hash, permitindo verificação futura.
 */
export function hashPassword(
  password: string,
  options: Argon2idOptions = {},
): Promise<string> {
  const memoryKiB = options.memoryKiB ?? DEFAULTS.memoryKiB;
  const iterations = options.iterations ?? DEFAULTS.iterations;
  const parallelism = options.parallelism ?? DEFAULTS.parallelism;
  const hashLength = options.hashLength ?? DEFAULTS.hashLength;

  if (!Number.isInteger(memoryKiB) || memoryKiB < 8) {
    throw new RangeError("memoryKiB deve ser um inteiro >= 8");
  }

  return Argon2id.hashEncoded(
    password,
    undefined,
    parallelism,
    memoryKiB,
    iterations,
    hashLength,
  );
}

/** Verifica uma senha contra um hash Argon2id PHC. */
export function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  return Argon2id.verify(encodedHash, password);
}
