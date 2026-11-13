import { api, ApiError, errorMessage } from "./api";

/**
 * Estado do opt-in de notificações push.
 *
 * O navegador só permite assinar com um service worker ativo e uma chave VAPID
 * vinda do servidor. Por isso o store separa três coisas distintas:
 * - `supported`: o navegador/contexto tem as APIs necessárias;
 * - `enabled`: o servidor está com `PUSH_ENABLED=true`;
 * - `subscribed`: este dispositivo tem uma assinatura viva no servidor.
 */

interface PushKeyPayload {
  readonly enabled: boolean;
  readonly publicKey: string | null;
}

interface DeviceSubscription {
  readonly id: string;
  readonly endpoint: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
}

export type PushPermission = "unsupported" | "default" | "granted" | "denied";

/** Converte a chave VAPID de base64url para o `BufferSource` esperado pela API. */
export function applicationServerKeyBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toBase64Url(bytes: ArrayBuffer | null): string {
  if (bytes === null) return "";

  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function supportsPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** `getRegistration` resolve `undefined` quando não há SW; `ready` nunca resolveria. */
async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ?? null;
}

function subscriptionKeys(subscription: PushSubscription): {
  p256dh: string;
  auth: string;
} | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;

  if (typeof p256dh !== "string" || typeof auth !== "string") return null;
  return { p256dh, auth };
}

class PushStore {
  supported = $state(false);
  enabled = $state(false);
  permission = $state<PushPermission>("default");
  subscribed = $state(false);
  busy = $state(false);
  error = $state<string | null>(null);

  /** Chave pública já convertida, reaproveitada na assinatura e na troca. */
  #key: string | null = null;
  #initialized = false;

  get available(): boolean {
    return this.supported && this.enabled;
  }

  get blocked(): boolean {
    return this.permission === "denied";
  }

  /**
   * Lê a capacidade do servidor e reconcilia o dispositivo.
   *
   * Reenviar a assinatura existente atualiza `lastSeenAt` no servidor, mas só
   * quando o endpoint já está registrado — caso contrário um dispositivo
   * desativado em outra aba voltaria a receber avisos sem o usuário pedir.
   */
  async refresh(): Promise<void> {
    if (!supportsPush()) {
      this.supported = false;
      this.enabled = false;
      this.subscribed = false;
      return;
    }

    this.supported = true;
    this.permission = Notification.permission as PushPermission;

    try {
      const key = await api<PushKeyPayload>("/notifications/push/key");
      this.enabled = key.enabled;
      this.#key = key.publicKey;

      if (!key.enabled || key.publicKey === null) {
        this.subscribed = false;
        return;
      }

      await this.#reconcile();
    } catch (cause) {
      // Sem sessão válida a tela de configurações nem é montada; falha aqui é
      // apenas ausência de suporte temporário, não erro que mereça alarde.
      this.enabled = false;
      this.subscribed = false;
      this.error = errorMessage(cause);
    } finally {
      this.#initialized = true;
    }
  }

  /** Pede permissão e inscreve este dispositivo. */
  async enable(): Promise<boolean> {
    if (!this.available || this.busy) return false;

    this.busy = true;
    this.error = null;

    try {
      const permission = await Notification.requestPermission();
      this.permission = permission as PushPermission;

      if (permission !== "granted") {
        return false;
      }

      const registration = await activeRegistration();
      if (registration === null || this.#key === null) {
        this.error = "O aplicativo ainda não está pronto para receber avisos.";
        return false;
      }

      const subscription = await this.#subscribe(registration);
      await this.#persist(subscription);
      this.subscribed = true;
      return true;
    } catch (cause) {
      this.error = errorMessage(cause);
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** Remove a assinatura do servidor e do navegador. */
  async disable(): Promise<boolean> {
    if (!this.supported || this.busy) return false;

    this.busy = true;
    this.error = null;

    try {
      const registration = await activeRegistration();
      const subscription = await registration?.pushManager.getSubscription() ?? null;

      if (subscription !== null) {
        await this.#revoke(subscription.endpoint);
        await subscription.unsubscribe().catch(() => false);
      }

      this.subscribed = false;
      return true;
    } catch (cause) {
      this.error = errorMessage(cause);
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** Enfileira uma notificação de teste pelo caminho normal do worker. */
  async sendTest(): Promise<boolean> {
    if (this.busy) return false;

    this.busy = true;
    this.error = null;

    try {
      await api<{ notificationId: string }>("/notifications/push/test", { method: "POST" });
      return true;
    } catch (cause) {
      this.error = errorMessage(cause);
      return false;
    } finally {
      this.busy = false;
    }
  }

  /**
   * Refaz o vínculo quando o navegador rotaciona a assinatura.
   *
   * O service worker não consegue montar o `X-CSRF-Token` (não lê cookies
   * HttpOnly), então ele apenas avisa a aba, que executa este método.
   */
  async handleSubscriptionChange(): Promise<void> {
    if (!this.available) return;

    try {
      const registration = await activeRegistration();
      if (registration === null || this.#key === null) return;

      const subscription = await this.#subscribe(registration);
      await this.#persist(subscription);
      this.subscribed = true;
    } catch (cause) {
      this.error = errorMessage(cause);
    }
  }

  /** Best-effort no logout: desfaz o vínculo antes de a sessão ser revogada. */
  async revokeOnLogout(): Promise<void> {
    if (!this.supported) return;

    try {
      const registration = await activeRegistration();
      const subscription = await registration?.pushManager.getSubscription() ?? null;
      if (subscription === null) return;

      await this.#revoke(subscription.endpoint);
      await subscription.unsubscribe().catch(() => false);
    } catch {
      // Logout nunca deve falhar por causa do push.
    } finally {
      this.subscribed = false;
      this.#initialized = false;
    }
  }

  /** Limpa o estado local quando a sessão termina. */
  reset(): void {
    this.subscribed = false;
    this.error = null;

    if (!this.#initialized) return;
    this.permission = this.supported
      ? (Notification.permission as PushPermission)
      : "unsupported";
  }

  async #reconcile(): Promise<void> {
    const registration = await activeRegistration();
    if (registration === null) {
      this.subscribed = false;
      return;
    }

    let subscription = await registration.pushManager.getSubscription();

    // A chave pública pode ter sido rotacionada no servidor: a assinatura
    // antiga continuaria sendo recusada pelo push service.
    if (subscription !== null && !this.#matchesKey(subscription) && this.#key !== null) {
      await subscription.unsubscribe().catch(() => false);
      subscription = null;
    }

    if (subscription === null) {
      this.subscribed = false;
      return;
    }

    // Só confirma no servidor se o endpoint já é conhecido: reenviar uma
    // assinatura revogada reativaria o dispositivo sem ação do usuário.
    const active = await api<{ subscriptions: DeviceSubscription[] }>(
      "/notifications/push/subscriptions",
    );
    const known = active.subscriptions.some((item) => item.endpoint === subscription.endpoint);
    if (!known) {
      this.subscribed = false;
      return;
    }

    await this.#persist(subscription);
    this.subscribed = true;
  }

  #matchesKey(subscription: PushSubscription): boolean {
    const current = subscription.options?.applicationServerKey;
    if (current === null || current === undefined) return false;
    return toBase64Url(current) === this.#key;
  }

  async #subscribe(registration: ServiceWorkerRegistration): Promise<PushSubscription> {
    if (this.#key === null) {
      throw new Error("Chave pública de push ausente");
    }

    const existing = await registration.pushManager.getSubscription();
    if (existing !== null && this.#matchesKey(existing)) return existing;

    if (existing !== null) await existing.unsubscribe().catch(() => false);

    return registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKeyBytes(this.#key),
    });
  }

  async #persist(subscription: PushSubscription): Promise<void> {
    const keys = subscriptionKeys(subscription);

    if (keys === null) {
      throw new Error("O navegador não expôs as chaves da assinatura");
    }

    await api<{ subscription: DeviceSubscription }>("/notifications/push/subscriptions", {
      method: "POST",
      body: { endpoint: subscription.endpoint, keys },
    });
  }

  async #revoke(endpoint: string): Promise<void> {
    try {
      await api("/notifications/push/subscriptions", {
        method: "DELETE",
        body: { endpoint },
      });
    } catch (cause) {
      // 404 = já revogada; qualquer outro erro fica para o logout seguir.
      if (cause instanceof ApiError && cause.status === 404) return;
      throw cause;
    }
  }
}

export const push = new PushStore();
