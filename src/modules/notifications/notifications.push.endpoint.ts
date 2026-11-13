import { isIP } from "node:net";

/**
 * Provedores de push aceitos por padrão.
 *
 * A lista é comparada por host exato ou sufixo com fronteira de ponto
 * (`web.push.apple.com` casa `push.apple.com`, mas `evilpush.apple.com` não).
 * Cobre FCM (Chrome/Edge/Opera), Mozilla (Firefox), WNS (Edge legado) e APNs
 * (Safari/iOS).
 */
export const DEFAULT_PUSH_ENDPOINT_HOSTS = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
] as const;

/**
 * Valida o endpoint de uma assinatura Web Push.
 *
 * Bloqueia `http:`, credenciais embutidas na URL, IPs literais e hosts fora da
 * allowlist. Sem isso, qualquer usuário autenticado poderia apontar a assinatura
 * para um serviço interno e transformar o worker em vetor de SSRF.
 */
export function isAllowedPushEndpoint(
  endpoint: string,
  allowedHosts: readonly string[],
): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "" || host.includes("[") || isIP(host) !== 0) return false;

  return allowedHosts.some((allowed) => {
    const normalized = allowed.toLowerCase().replace(/\.$/, "");
    return host === normalized || host.endsWith(`.${normalized}`);
  });
}
