import { getExtensionPath } from "@sqliteai/sqlite-vector";
import { fileURLToPath } from "node:url";

/**
 * O pacote npm do sqlite-vector depende de pacotes opcionais por plataforma,
 * que o Deno nem sempre instala. Mantemos binários em `bin/sqlite-vector/`
 * como fallback para o ambiente de desenvolvimento e para o Docker.
 */
const BUNDLED_BIN_DIR = new URL("../../bin/sqlite-vector/", import.meta.url);

export class VectorExtensionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VectorExtensionNotFoundError";
  }
}

interface PlatformTarget {
  readonly directory: string;
  readonly extension: "so" | "dylib" | "dll";
}

/**
 * Resolve o caminho do binário do sqlite-vector:
 * 1. `VECTOR_EXTENSION_PATH`, se definido;
 * 2. o pacote npm da plataforma, se instalado;
 * 3. o binário embutido em `bin/sqlite-vector/<plataforma>/`.
 */
export function resolveVectorExtensionPath(override?: string): string {
  if (override !== undefined && override.trim() !== "") return override;

  try {
    return getExtensionPath();
  } catch {
    // Segue para o fallback embutido.
  }

  const target = detectPlatformTarget();
  const bundled = fileURLToPath(
    new URL(`${target.directory}/vector.${target.extension}`, BUNDLED_BIN_DIR),
  );

  try {
    if (Deno.statSync(bundled).isFile) return bundled;
  } catch {
    // Arquivo ausente.
  }

  throw new VectorExtensionNotFoundError(
    `Extensão sqlite-vector não encontrada para ${target.directory}. ` +
      `Rode "deno install" ou copie o binário para bin/sqlite-vector/${target.directory}/` +
      `vector.${target.extension}, ou defina VECTOR_EXTENSION_PATH.`,
  );
}

function detectPlatformTarget(): PlatformTarget {
  const os = Deno.build.os;
  const arch = Deno.build.arch;
  const isMusl = Deno.build.target.includes("musl");

  if (os === "linux" && arch === "x86_64") {
    return {
      directory: isMusl ? "linux-x86_64-musl" : "linux-x86_64",
      extension: "so",
    };
  }

  if (os === "linux" && arch === "aarch64") {
    return {
      directory: isMusl ? "linux-arm64-musl" : "linux-arm64",
      extension: "so",
    };
  }

  if (os === "darwin" && arch === "aarch64") {
    return { directory: "darwin-arm64", extension: "dylib" };
  }

  if (os === "darwin" && arch === "x86_64") {
    return { directory: "darwin-x86_64", extension: "dylib" };
  }

  if (os === "windows" && arch === "x86_64") {
    return { directory: "win32-x86_64", extension: "dll" };
  }

  throw new VectorExtensionNotFoundError(`Plataforma não suportada: ${os}-${arch}`);
}
