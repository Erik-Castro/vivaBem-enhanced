import { api, apiRequest, errorMessage } from "./api";
import type {
  MarkAllReadPayload,
  Notification,
  NotificationListPayload,
  NotificationPayload,
  UnreadCountPayload,
} from "./types";

export type NotificationFilter = "all" | "unread";

const POLL_INTERVAL_MS = 60_000;
const RECENT_LIMIT = 8;
const PAGE_SIZE = 50;
const RECENT_TTL_MS = 30_000;

/**
 * Rotas de notificação que já têm tela equivalente no SPA.
 * As demais (`/family`, `/insights`) ficam sem navegação até serem entregues.
 */
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

class NotificationsStore {
  unread = $state(0);
  recent = $state<Notification[]>([]);
  recentLoading = $state(false);
  items = $state<Notification[]>([]);
  itemsLoading = $state(false);
  itemsLoadingMore = $state(false);
  hasMore = $state(false);
  filter = $state<NotificationFilter>("all");
  error = $state<string | null>(null);
  /** Painel do sino; vive no store para o layer ser renderizado fora do topbar. */
  panelOpen = $state(false);

  #timer: ReturnType<typeof setInterval> | null = null;
  #unreadInFlight = false;
  #recentFetchedAt = 0;
  #loadToken = 0;

  #onVisibility = (): void => {
    if (document.visibilityState === "visible") void this.refreshUnread();
  };

  #onOnline = (): void => {
    void this.refreshUnread();
  };

  /** Inicia o polling do contador; chamado quando a sessão autenticada monta. */
  startPolling(): void {
    if (this.#timer !== null) return;

    void this.refreshUnread();

    this.#timer = setInterval(() => {
      if (document.visibilityState === "visible") void this.refreshUnread();
    }, POLL_INTERVAL_MS);

    document.addEventListener("visibilitychange", this.#onVisibility);
    window.addEventListener("online", this.#onOnline);
  }

  stopPolling(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }

    document.removeEventListener("visibilitychange", this.#onVisibility);
    window.removeEventListener("online", this.#onOnline);
  }

  async refreshUnread(): Promise<void> {
    if (this.#unreadInFlight) return;

    this.#unreadInFlight = true;

    try {
      const payload = await api<UnreadCountPayload>("/notifications/unread-count");
      this.unread = payload.unread;
    } catch {
      // O contador é secundário: falhas de polling não interrompem a interface.
    } finally {
      this.#unreadInFlight = false;
    }
  }

  /** Abre/fecha o painel do sino, carregando a lista recente ao abrir. */
  async togglePanel(): Promise<void> {
    if (this.panelOpen) {
      this.panelOpen = false;
      return;
    }

    this.panelOpen = true;
    await Promise.all([this.loadRecent(true), this.refreshUnread()]);
  }

  closePanel(): void {
    this.panelOpen = false;
  }

  async loadRecent(force = false): Promise<void> {
    if (this.recentLoading) return;
    if (!force && this.recent.length > 0 && Date.now() - this.#recentFetchedAt < RECENT_TTL_MS) {
      return;
    }

    this.recentLoading = true;

    try {
      const envelope = await apiRequest<NotificationListPayload>("/notifications", {
        query: { limit: RECENT_LIMIT },
      });
      this.recent = envelope.data.notifications;
      this.#recentFetchedAt = Date.now();
    } catch {
      // Mantém a última lista conhecida em vez de esvaziar o painel.
    } finally {
      this.recentLoading = false;
    }
  }

  async load(reset = false): Promise<void> {
    if (!reset && (!this.hasMore || this.itemsLoadingMore || this.itemsLoading)) return;

    const token = ++this.#loadToken;

    if (reset) {
      this.itemsLoading = true;
      this.error = null;
    } else {
      this.itemsLoadingMore = true;
    }

    const offset = reset ? 0 : this.items.length;

    try {
      const envelope = await apiRequest<NotificationListPayload>("/notifications", {
        query: {
          limit: PAGE_SIZE,
          offset,
          isRead: this.filter === "unread" ? false : undefined,
        },
      });

      if (token !== this.#loadToken) return;

      const received = envelope.data.notifications;
      this.items = reset ? received : [...this.items, ...received];
      this.hasMore = envelope.meta.hasMore === true;
    } catch (cause) {
      if (token === this.#loadToken && reset) this.error = errorMessage(cause);
    } finally {
      if (token === this.#loadToken) {
        this.itemsLoading = false;
        this.itemsLoadingMore = false;
      }
    }
  }

  async setFilter(filter: NotificationFilter): Promise<void> {
    if (this.filter === filter) return;

    this.filter = filter;
    await this.load(true);
  }

  async markRead(id: string): Promise<void> {
    const payload = await api<NotificationPayload>(`/notifications/${id}/read`, {
      method: "PATCH",
    });
    this.#applyRead(id, payload.notification.isRead);
  }

  async markAllRead(): Promise<number> {
    const payload = await api<MarkAllReadPayload>("/notifications/read-all", {
      method: "POST",
    });
    const markAll = (list: Notification[]): Notification[] =>
      list.map((item) => (item.isRead ? item : { ...item, isRead: true }));

    this.recent = markAll(this.recent);
    this.items = markAll(this.items);
    this.unread = 0;

    if (this.filter === "unread") {
      this.items = [];
      this.hasMore = false;
    }

    return payload.marked;
  }

  #applyRead(id: string, isRead: boolean): void {
    let wasUnread = false;

    const update = (list: Notification[]): Notification[] =>
      list.map((item) => {
        if (item.id !== id) return item;
        if (!item.isRead) wasUnread = true;
        return item.isRead === isRead ? item : { ...item, isRead };
      });

    this.recent = update(this.recent);
    this.items = update(this.items);

    if (isRead && wasUnread) this.unread = Math.max(0, this.unread - 1);
  }
}

export const notifications = new NotificationsStore();
