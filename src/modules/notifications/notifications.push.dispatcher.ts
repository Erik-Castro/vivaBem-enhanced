import type { PushConfig } from "../../config.ts";
import type { Logger } from "../../shared/logger/index.ts";
import type { NotificationsPushRepository } from "./notifications.push.repository.ts";
import type { PushSender } from "./notifications.push.sender.ts";
import type {
  ClaimedPushNotification,
  PushDispatchResult,
  PushPayload,
} from "./notifications.push.types.ts";

export interface PushDispatcherDependencies {
  readonly repository: NotificationsPushRepository;
  readonly sender: PushSender;
  readonly config: PushConfig;
  readonly logger: Logger;
  readonly workerId?: string;
  /** Injetável para testes determinísticos de lease e tentativas. */
  readonly now?: () => Date;
}

interface DeliveryOutcome {
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
  readonly revoked: number;
}

/**
 * Consumidor das notificações pendentes de push.
 *
 * Roda em processo próprio (worker) e não depende da IA: push continua
 * funcionando com `AI_ENABLED=false`. Cada ciclo adquire um lote, entrega para
 * todos os dispositivos vivos do usuário e grava o resultado na própria linha.
 */
export class PushDispatcher {
  readonly #repository: NotificationsPushRepository;
  readonly #sender: PushSender;
  readonly #config: PushConfig;
  readonly #logger: Logger;
  readonly #workerId: string | undefined;
  readonly #now: () => Date;

  #timer: ReturnType<typeof setTimeout> | undefined;
  #active: Promise<void> | null = null;
  #started = false;

  constructor(dependencies: PushDispatcherDependencies) {
    this.#repository = dependencies.repository;
    this.#sender = dependencies.sender;
    this.#config = dependencies.config;
    this.#logger = dependencies.logger;
    this.#workerId = dependencies.workerId;
    this.#now = dependencies.now ?? (() => new Date());
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#started = false;

    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }

    await this.#active;
  }

  /**
   * Executa um ciclo completo.
   *
   * Exposto para testes e para o worker; o agendamento periódico chama este
   * mesmo método, então não existe caminho de entrega diferente em produção.
   */
  async runOnce(): Promise<PushDispatchResult> {
    const now = this.#now().toISOString();
    const claimed = this.#repository.claimPending({
      now,
      leaseMs: this.#config.claimLeaseMs,
      limit: this.#config.batchSize,
    });

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let revoked = 0;

    for (const notification of claimed) {
      const outcome = await this.#deliver(notification, now);
      sent += outcome.sent;
      skipped += outcome.skipped;
      failed += outcome.failed;
      revoked += outcome.revoked;
    }

    if (claimed.length > 0) {
      this.#logger.info("push_dispatch", {
        workerId: this.#workerId,
        claimed: claimed.length,
        sent,
        skipped,
        failed,
        revoked,
      });
    }

    return { claimed: claimed.length, sent, skipped, failed, revoked };
  }

  async #deliver(
    notification: ClaimedPushNotification,
    now: string,
  ): Promise<DeliveryOutcome> {
    const subscriptions = this.#repository.listActiveByUser(notification.userId);

    if (subscriptions.length === 0) {
      this.#repository.markSkipped(notification.id, notification.claimToken);
      return { sent: 0, skipped: 1, failed: 0, revoked: 0 };
    }

    const payload: PushPayload = {
      id: notification.id,
      title: notification.title,
      message: notification.message,
      category: notification.category,
      severity: notification.severity,
      link: notification.link,
    };

    let delivered = 0;
    let transientError: string | null = null;
    let revoked = 0;

    for (const subscription of subscriptions) {
      try {
        await this.#sender.send(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
        );
        delivered++;
      } catch (error) {
        // Assinatura morta é removida na hora; não é falha da notificação e não
        // deve impedir os outros dispositivos de recebê-la.
        if (this.#sender.isGone(error)) {
          if (this.#repository.revokeById(subscription.id, now)) revoked++;
          continue;
        }

        transientError ??= describeError(error);
      }
    }

    if (delivered > 0) {
      // Pelo menos um dispositivo recebeu: repetir duplicaria o aviso nos que
      // já foram entregues, então a notificação é considerada concluída.
      this.#repository.markSent(notification.id, notification.claimToken, now);
      return { sent: 1, skipped: 0, failed: 0, revoked };
    }

    if (transientError === null) {
      // Todos os endpoints responderam "gone": nada mais a entregar.
      this.#repository.markSkipped(notification.id, notification.claimToken);
      return { sent: 0, skipped: 1, failed: 0, revoked };
    }

    const terminal = notification.attempts >= this.#config.maxAttempts;
    this.#repository.markFailed(
      notification.id,
      notification.claimToken,
      transientError,
      terminal,
    );

    if (terminal) {
      this.#logger.warn("push_delivery_failed", {
        workerId: this.#workerId,
        notificationId: notification.id,
        attempts: notification.attempts,
        message: transientError,
      });
    }

    return { sent: 0, skipped: 0, failed: 1, revoked };
  }

  #schedule(delayMs: number): void {
    const timer = setTimeout(() => {
      this.#timer = undefined;
      this.#active = this.#tick();
    }, delayMs);

    this.#timer = timer;

    // Sem `unref` o timer seguraria um processo cujo único trabalho é push;
    // o entry point mantém a promessa principal viva explicitamente.
    Deno.unrefTimer(timer);
  }

  async #tick(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.#logger.error("push_dispatch_failed", {
        workerId: this.#workerId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (this.#started) this.#schedule(this.#config.dispatchIntervalMs);
    }
  }
}

function describeError(error: unknown): string {
  const message = error instanceof Error && error.message.length > 0
    ? error.message
    : String(error);
  return message.slice(0, 500);
}
