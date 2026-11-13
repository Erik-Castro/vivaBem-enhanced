import { createMiddleware } from "@hono/hono/factory";
import type { Context } from "@hono/hono";
import { getConnInfo } from "@hono/hono/deno";
import type { BlockList } from "node:net";
import { AppError } from "../errors.ts";
import type { AppEnv } from "../types.ts";
import type { AppConfig } from "../../config.ts";
import type { SlidingWindowRateLimiter } from "../../shared/utils/rate-limiter.ts";
import { buildIpBlockList, isTrustedIp, normalizeIp } from "../../shared/utils/ip.ts";

export interface ClientIpSources {
  /** Endereço do peer TCP imediato (quem abriu a conexão com a API). */
  readonly peer?: string;
  readonly forwardedFor?: string;
  readonly realIp?: string;
}

/**
 * Resolve o IP do cliente a partir do peer e dos headers de proxy.
 *
 * Regras:
 * 1. Sem peer válido, devolve `unknown` — nunca cai em header controlável.
 * 2. Se o peer não é um proxy confiável, ele é o cliente: `X-Forwarded-For` e
 *    `X-Real-IP` são ignorados (um cliente direto não escolhe seu próprio IP).
 * 3. Se o peer é confiável, o cliente é o endereço `hops` posições antes do
 *    fim da cadeia do `X-Forwarded-For`. O último item da cadeia foi anexado
 *    pelo proxy mais próximo e é sempre confiável; usar posição fixa impede
 *    que um `X-Forwarded-For` forjado à esquerda vire uma chave nova.
 */
export function resolveClientIp(
  sources: ClientIpSources,
  trusted: BlockList,
  hops: number,
): string {
  const peer = sources.peer === undefined ? null : normalizeIp(sources.peer);
  if (peer === null) return "unknown";
  if (!isTrustedIp(trusted, peer)) return peer;

  const chain = (sources.forwardedFor ?? "")
    .split(",")
    .map((entry) => normalizeIp(entry))
    .filter((entry): entry is string => entry !== null);

  if (chain.length === 0) {
    const realIp = sources.realIp === undefined ? null : normalizeIp(sources.realIp);
    return realIp ?? peer;
  }

  const index = chain.length - Math.max(1, hops);
  return chain[index >= 0 ? index : 0] ?? peer;
}

const trustedProxyCache = new WeakMap<AppConfig, BlockList>();

function trustedProxies(config: AppConfig): BlockList {
  let list = trustedProxyCache.get(config);
  if (list === undefined) {
    list = buildIpBlockList(config.rateLimit.trustedProxyCidrs);
    trustedProxyCache.set(config, list);
  }
  return list;
}

/** Extrai o IP do cliente; ver `resolveClientIp` para as regras de confiança. */
export function clientIp(c: Context<AppEnv>, config: AppConfig): string {
  let peer: string | undefined;

  try {
    peer = getConnInfo(c).remote.address;
  } catch {
    // `app.request` sem env de conexão (testes/CLI) não expõe o peer.
    peer = undefined;
  }

  return resolveClientIp(
    {
      peer,
      forwardedFor: c.req.header("x-forwarded-for"),
      realIp: c.req.header("x-real-ip"),
    },
    trustedProxies(config),
    config.rateLimit.trustedProxyHops,
  );
}

export interface RateLimitOptions {
  readonly scope: string;
  readonly max?: number;
}

/**
 * Aplica o limiter por IP. Endpoints de autenticação usam um `scope` próprio,
 * para que o limite rígido não consuma a cota de outras rotas.
 */
export function rateLimit(
  limiter: SlidingWindowRateLimiter,
  config: AppConfig,
  options: RateLimitOptions,
) {
  const max = options.max ?? config.rateLimit.authMax;

  return createMiddleware<AppEnv, "*">(async (c, next) => {
    const key = `${options.scope}:${clientIp(c, config)}`;
    const result = limiter.consume(key, max, config.rateLimit.windowMs);

    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(result.remaining));

    if (!result.allowed) {
      c.header("Retry-After", String(result.retryAfterSeconds));
      throw new AppError(
        "RATE_LIMITED",
        "Muitas tentativas. Tente novamente em instantes.",
      );
    }

    await next();
  });
}
