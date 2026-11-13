/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { notificationTarget } from "./lib/notification-links";
import { getQueueOwner, listPending, removeFromQueue } from "./lib/offline-queue";

declare let self: ServiceWorkerGlobalScope;

const OFFLINE_QUEUE_TAG = "vivabem-flush";
const REFRESH_TAG = "vivabem-refresh";
const API_BASE = "/api/v1";

const CSRF_HEADER = "X-CSRF-Token";
const IDEMPOTENCY_HEADER = "Idempotency-Key";

interface PushPayload {
  readonly id?: string;
  readonly title?: string;
  readonly message?: string;
  readonly category?: string;
  readonly link?: string | null;
}

interface BadgingNavigator {
  readonly setAppBadge?: (contents?: number) => Promise<void>;
  readonly clearAppBadge?: () => Promise<void>;
}

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

/**
 * Fallback do SPA apenas para navegações. API e health nunca são capturados:
 * além de não serem cacheáveis, o `index.html` no lugar de um JSON quebraria
 * silenciosamente os clientes.
 */
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//, /^\/health/, /^\/ready/],
  }),
);

self.addEventListener("install", () => {
  // `autoUpdate` depende de o novo worker assumir sem esperar todas as abas.
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil(showPush(event));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openNotification(event.notification.data as PushPayload | undefined));
});

/**
 * O navegador pode rotacionar a assinatura sozinho. Como o service worker não
 * tem `document.cookie`, ele não consegue montar o `X-CSRF-Token`; por isso
 * apenas avisa uma aba aberta, que refaz o vínculo com o servidor.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        client.postMessage({ type: "push-subscription-change" });
      }
    }),
  );
});

self.addEventListener("sync", (event: Event) => {
  const syncEvent = event as ExtendableEvent & { readonly tag: string };
  if (syncEvent.tag !== OFFLINE_QUEUE_TAG) return;
  syncEvent.waitUntil(flushOfflineQueue());
});

self.addEventListener("periodicsync", (event: Event) => {
  const periodicEvent = event as ExtendableEvent & { readonly tag: string };
  if (periodicEvent.tag !== REFRESH_TAG) return;
  periodicEvent.waitUntil(refreshBadge());
});

self.addEventListener("message", (event) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === "flush-offline-queue") {
    event.waitUntil(flushOfflineQueue());
  }
});

async function showPush(event: PushEvent): Promise<void> {
  const payload = parsePushPayload(event.data);
  const link = notificationTarget(payload.link ?? null);

  await self.registration.showNotification(payload.title ?? "Viva Bem", {
    body: payload.message ?? "",
    icon: "/icon-192.png",
    badge: "/favicon-32.png",
    // `tag` agrupa por notificação: reenvios do mesmo evento substituem o
    // aviso anterior em vez de empilhar duplicatas.
    tag: payload.id ?? payload.category ?? link,
    data: { ...payload, link },
  });
}

function parsePushPayload(data: PushMessageData | null): PushPayload {
  if (data === null) return {};

  try {
    const value: unknown = data.json();
    return value !== null && typeof value === "object" ? (value as PushPayload) : {};
  } catch {
    // Payload fora do contrato ainda deve virar notificação visível: o Push
    // API exige uma notificação por push recebido.
    return {};
  }
}

async function openNotification(data: PushPayload | undefined): Promise<void> {
  const url = new URL(self.location.origin);
  url.hash = `#${notificationTarget(data?.link ?? null)}`;

  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existing = windows.find((client) => client.url.startsWith(self.location.origin));

  if (existing !== undefined) {
    await existing.focus();
    if ("navigate" in existing && typeof existing.navigate === "function") {
      await existing.navigate(url.href).catch(() => undefined);
    }
    return;
  }

  await self.clients.openWindow(url.href);
}

/**
 * Replay best-effort da fila offline quando não há aba aberta.
 *
 * Sem aba, o worker não tem como renovar a sessão (dois refreshes concorrentes
 * revogam a família de tokens), então qualquer 401/403 interrompe a tentativa
 * e a fila fica para a próxima abertura do app.
 */
async function flushOfflineQueue(): Promise<void> {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

  if (clients.length > 0) {
    for (const client of clients) {
      client.postMessage({ type: "flush-offline-queue" });
    }
    return;
  }

  // Sem dono persistido não há sessão confirmada pela página: não reproduz
  // nada. Isso impede que a fila de uma conta seja enviada com outra sessão.
  const owner = await getQueueOwner();
  if (owner === null) return;

  const pending = await listPending(owner);

  for (const entry of pending) {
    if (entry.csrf === undefined) return;

    let response: Response;

    try {
      response = await fetch(`${API_BASE}${entry.path}`, {
        method: entry.method,
        credentials: "include",
        headers: {
          Accept: "application/json",
          [CSRF_HEADER]: entry.csrf,
          [IDEMPOTENCY_HEADER]: entry.key,
          ...(entry.body === null ? {} : { "Content-Type": "application/json" }),
        },
        body: entry.body,
      });
    } catch {
      return;
    }

    if (response.ok || response.status === 409) {
      await removeFromQueue(entry.id);
      continue;
    }

    // 401 (access expirado) e 403 (CSRF rotacionado) só têm solução com a
    // página, que é a única capaz de renovar a sessão com segurança.
    return;
  }
}

async function refreshBadge(): Promise<void> {
  const response = await fetch(`${API_BASE}/notifications/unread-count`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) return;

  const payload = (await response.json()) as { data?: { unread?: number } };
  const unread = payload.data?.unread ?? 0;
  const navigatorWithBadge = self.navigator as unknown as BadgingNavigator;

  if (unread === 0) {
    await navigatorWithBadge.clearAppBadge?.();
    return;
  }

  await navigatorWithBadge.setAppBadge?.(unread);
}
