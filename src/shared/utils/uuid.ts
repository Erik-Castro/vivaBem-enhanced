/**
 * Gera identificadores UUIDv7 (RFC 9562).
 *
 * O prefixo de 48 bits é o timestamp em milissegundos, o que mantém os IDs
 * aproximadamente ordenáveis por criação e melhora a localidade dos índices.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const view = new DataView(bytes.buffer);

  // 48 bits de timestamp (big-endian).
  view.setUint16(0, Math.floor(now / 2 ** 32));
  view.setUint32(2, now >>> 0);

  // Versão 7 (bits 48-51) e variante RFC 9562 (bits 64-65).
  view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x70);
  view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80);

  return formatUuid(bytes);
}

/** Extrai o timestamp (ms) embutido em um UUIDv7. Retorna `undefined` se inválido. */
export function uuidv7Timestamp(uuid: string): number | undefined {
  const hex = uuid.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) return undefined;
  return Number.parseInt(hex.slice(0, 12), 16);
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
