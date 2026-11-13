import { BlockList, isIP } from "node:net";

/**
 * Faixas tratadas como proxies confiáveis por padrão.
 *
 * Cobrem loopback, redes privadas RFC 1918, link-local, CGNAT do Tailscale
 * (`100.64.0.0/10`) e os equivalentes IPv6. Na prática, o peer imediato da API
 * no Compose é o container do Nginx (rede privada), então sem essa confiança
 * nenhum `X-Forwarded-For` seria lido.
 */
export const DEFAULT_TRUSTED_PROXY_CIDRS = [
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  "100.64.0.0/10",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
] as const;

export interface ParsedCidr {
  readonly address: string;
  readonly prefix: number;
  readonly family: "ipv4" | "ipv6";
}

/**
 * Normaliza um endereço IP vindo de header ou socket.
 *
 * Aceita `1.2.3.4`, `1.2.3.4:1234`, `[::1]`, `[::1]:443` e o formato mapeado
 * `::ffff:1.2.3.4` (comum quando um socket IPv6 recebe um cliente IPv4).
 * Devolve `null` para qualquer coisa que não seja um IP válido — entradas
 * malformadas nunca entram em chave de rate limit.
 */
export function normalizeIp(value: string): string | null {
  let candidate = value.trim();
  if (candidate === "") return null;

  if (candidate.startsWith("[")) {
    const closing = candidate.indexOf("]");
    if (closing === -1) return null;
    candidate = candidate.slice(1, closing);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    // IPv4 com porta (alguns proxies anexam `ip:port` ao XFF).
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(candidate);
  if (mapped?.[1] !== undefined) candidate = mapped[1];

  if (isIP(candidate) === 0) return null;
  return candidate.toLowerCase();
}

/** Valida e decompõe um CIDR (`10.0.0.0/8`, `fc00::/7`). */
export function parseCidr(value: string): ParsedCidr | null {
  const trimmed = value.trim();
  const slash = trimmed.lastIndexOf("/");
  if (slash === -1) return null;

  const address = normalizeIp(trimmed.slice(0, slash));
  if (address === null) return null;

  const prefixText = trimmed.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return null;

  const family = isIP(address) === 4 ? "ipv4" : "ipv6";
  const maxPrefix = family === "ipv4" ? 32 : 128;
  const prefix = Number(prefixText);
  if (prefix > maxPrefix) return null;

  return { address, prefix, family };
}

export function isValidCidr(value: string): boolean {
  return parseCidr(value) !== null;
}

/** Constrói a lista de confiança; entradas inválidas são ignoradas. */
export function buildIpBlockList(cidrs: readonly string[]): BlockList {
  const list = new BlockList();

  for (const cidr of cidrs) {
    const parsed = parseCidr(cidr);
    if (parsed === null) continue;
    list.addSubnet(parsed.address, parsed.prefix, parsed.family);
  }

  return list;
}

/** `true` quando o IP pertence a alguma faixa confiável. */
export function isTrustedIp(list: BlockList, ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return false;
  return list.check(ip, family === 4 ? "ipv4" : "ipv6");
}
