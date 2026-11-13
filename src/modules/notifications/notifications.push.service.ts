import type { PushConfig } from "../../config.ts";
import { AppError } from "../../http/errors.ts";
import { base64UrlDecode } from "../../shared/crypto/tokens.ts";
import { applicationServerKey, parseVapidJwk } from "../../shared/crypto/vapid.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";
import type { NotificationsRepository } from "./notifications.repository.ts";
import type { NotificationsPushRepository } from "./notifications.push.repository.ts";
import type { PushSubscriptionInput, PushSubscriptionRecord } from "./notifications.push.types.ts";

const P256DH_BYTES = 65;
const AUTH_BYTES = 16;
const MAX_ENDPOINT_LENGTH = 2_048;

export interface PushKeyResult {
  readonly enabled: boolean;
  readonly publicKey: string | null;
}

export interface SubscribePushResult {
  readonly id: string;
  readonly endpoint: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
}

export interface NotificationsPushServiceDependencies {
  readonly repository: NotificationsPushRepository;
  readonly notifications: NotificationsRepository;
  readonly config: PushConfig;
  readonly now?: () => Date;
}

/**
 * Casos de uso de push expostos pela API.
 *
 * A entrega é assíncrona: `subscribe` só persiste o dispositivo e `sendTest`
 * apenas cria a notificação marcada como `pending`. Quem envia é o worker.
 */
export class NotificationsPushService {
  readonly #repository: NotificationsPushRepository;
  readonly #notifications: NotificationsRepository;
  readonly #config: PushConfig;
  readonly #now: () => Date;

  constructor(dependencies: NotificationsPushServiceDependencies) {
    this.#repository = dependencies.repository;
    this.#notifications = dependencies.notifications;
    this.#config = dependencies.config;
    this.#now = dependencies.now ?? (() => new Date());
  }

  /** Chave pública para `PushManager.subscribe`; `null` quando desligado. */
  key(): PushKeyResult {
    if (!this.#config.enabled || this.#config.vapidPublicKey === undefined) {
      return { enabled: false, publicKey: null };
    }

    const jwk = parseVapidJwk(this.#config.vapidPublicKey);
    if (jwk === null) {
      // A validação de boot impede este estado; se acontecer, é erro de deploy.
      throw new AppError("PUSH_DISABLED", "Configuração de push indisponível");
    }

    return { enabled: true, publicKey: applicationServerKey(jwk) };
  }

  list(userId: string): PushSubscriptionRecord[] {
    return this.#repository.listActiveByUser(userId);
  }

  subscribe(userId: string, input: PushSubscriptionInput): SubscribePushResult {
    this.#assertEnabled();
    validateSubscription(input);

    const now = this.#now().toISOString();
    const subscription = this.#repository.upsert({
      id: uuidv7(),
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
      now,
    });

    return {
      id: subscription.id,
      endpoint: subscription.endpoint,
      createdAt: subscription.createdAt,
      lastSeenAt: subscription.lastSeenAt,
    };
  }

  /**
   * Revoga o dispositivo do próprio usuário.
   *
   * Um endpoint de outro usuário responde `NOT_FOUND`, nunca `FORBIDDEN`: a
   * existência da assinatura não deve vazar entre contas.
   */
  unsubscribe(userId: string, endpoint: string): void {
    const revoked = this.#repository.revokeByEndpoint(userId, endpoint, this.#now().toISOString());
    if (!revoked) {
      throw new AppError("NOT_FOUND", "Assinatura push não encontrada");
    }
  }

  /**
   * Cria uma notificação de teste.
   *
   * Reaproveita a fila normal das notificações: o aviso aparece na central e é
   * entregue pelo worker, exatamente como qualquer notificação real.
   */
  sendTest(userId: string): string {
    this.#assertEnabled();

    if (this.#repository.countActiveByUser(userId) === 0) {
      throw new AppError("CONFLICT", "Nenhum dispositivo inscrito para receber push");
    }

    const now = this.#now().toISOString();
    const notification = this.#notifications.create({
      id: uuidv7(),
      userId,
      title: "Notificação de teste",
      message: "Se este aviso apareceu, as notificações push estão funcionando.",
      category: "system",
      severity: "low",
      link: "/settings",
      now,
    });

    return notification.id;
  }

  #assertEnabled(): void {
    if (!this.#config.enabled) {
      throw new AppError("PUSH_DISABLED", "Notificações push estão desabilitadas");
    }
  }
}

function validateSubscription(input: PushSubscriptionInput): void {
  const details: Array<{ path: string; message: string }> = [];

  if (input.endpoint.length > MAX_ENDPOINT_LENGTH) {
    details.push({ path: "endpoint", message: "endpoint muito longo" });
  } else {
    try {
      const url = new URL(input.endpoint);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        details.push({ path: "endpoint", message: "endpoint deve ser http(s)" });
      }
    } catch {
      details.push({ path: "endpoint", message: "endpoint inválido" });
    }
  }

  if (!isPoint(input.p256dh)) {
    details.push({ path: "keys.p256dh", message: "p256dh deve ser um ponto P-256 em base64url" });
  }

  if (!isAuthSecret(input.auth)) {
    details.push({ path: "keys.auth", message: "auth deve ter 16 bytes em base64url" });
  }

  if (details.length > 0) {
    throw new AppError("VALIDATION_ERROR", "Assinatura push inválida", { details });
  }
}

function isPoint(value: string): boolean {
  try {
    const decoded = base64UrlDecode(value);
    return decoded.length === P256DH_BYTES && decoded[0] === 4;
  } catch {
    return false;
  }
}

function isAuthSecret(value: string): boolean {
  try {
    return base64UrlDecode(value).length === AUTH_BYTES;
  } catch {
    return false;
  }
}
