import type { NotificationCategory, NotificationSeverity } from "./notifications.repository.ts";

/** Assinatura push como o navegador entrega em `PushSubscription.toJSON()`. */
export interface PushSubscriptionInput {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly userAgent: string | null;
}

/** Assinatura viva persistida. */
export interface PushSubscriptionRecord {
  readonly id: string;
  readonly userId: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly userAgent: string | null;
  readonly createdAt: string;
  readonly lastSeenAt: string;
}

/** Payload entregue ao service worker — mesmo contrato de `web/src/sw.ts`. */
export interface PushPayload {
  readonly id: string;
  readonly title: string;
  readonly message: string;
  readonly category: NotificationCategory;
  readonly severity: NotificationSeverity;
  readonly link: string | null;
}

/** Notificação adquirida para entrega; `push_attempts` já conta esta rodada. */
export interface ClaimedPushNotification {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly message: string;
  readonly category: NotificationCategory;
  readonly severity: NotificationSeverity;
  readonly link: string | null;
  readonly createdAt: string;
  readonly attempts: number;
  readonly claimToken: string;
}

export interface PushDispatchResult {
  readonly claimed: number;
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
  readonly revoked: number;
}

/** Estados terminais/operacionais da entrega de push. */
export const PUSH_STATES = ["pending", "sent", "skipped", "failed"] as const;
export type PushState = (typeof PUSH_STATES)[number];
