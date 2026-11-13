/**
 * Tradução dos links de notificação da API para rotas do SPA.
 *
 * Vive fora do store porque o service worker também precisa resolver o link
 * no clique da notificação, e não pode importar runes.
 */

/** Rotas de notificação que já têm tela equivalente no SPA. */
const KNOWN_ROUTES = new Set([
  "/dashboard",
  "/transactions",
  "/accounts",
  "/categories",
  "/budgets",
  "/goals",
  "/habits",
  "/investments",
  "/achievements",
  "/notifications",
  "/insights",
  "/data",
  "/family",
  "/settings",
]);

const LINK_REWRITES: readonly (readonly [RegExp, string])[] = [
  [/^\/finances(\/.*)?$/, "/dashboard"],
  [/^\/budgets\/[^/]+$/, "/budgets"],
  [/^\/settings\/sessions$/, "/settings"],
];

/** Converte o link vindo da API em uma rota existente (ou `null`). */
export function resolveNotificationLink(link: string | null): string | null {
  if (!link) return null;

  const clean = link.split(/[?#]/)[0] ?? "";

  for (const [pattern, target] of LINK_REWRITES) {
    if (pattern.test(clean)) return target;
  }

  const path = clean.length > 1 && clean.endsWith("/") ? clean.slice(0, -1) : clean;
  return KNOWN_ROUTES.has(path) ? path : null;
}

/** Rota do SPA a abrir para um link da API (fallback: central de notificações). */
export function notificationTarget(link: string | null): string {
  return resolveNotificationLink(link) ?? "/notifications";
}
