import { ApplicationServer, importVapidKeys, PushMessageError, Urgency } from "@negrel/webpush";
import type { PushConfig } from "../../config.ts";
import { parseVapidJwk } from "../../shared/crypto/vapid.ts";
import type { PushPayload } from "./notifications.push.types.ts";

/**
 * Assinatura como o navegador entrega. Declarada aqui (em vez de importar o
 * tipo da biblioteca) para não colidir com o `PushSubscription` do DOM.
 */
export interface PushTarget {
  readonly endpoint: string;
  readonly keys: {
    readonly p256dh: string;
    readonly auth: string;
  };
}

/**
 * Abstração do envio, para que o dispatcher seja testável com um sender falso e
 * para que a dependência do Web Push fique isolada em um único arquivo.
 */
export interface PushSender {
  send(target: PushTarget, payload: PushPayload): Promise<void>;
  /** `true` quando o serviço de push informou que a assinatura não existe mais. */
  isGone(error: unknown): boolean;
}

/**
 * Cria o sender VAPID.
 *
 * Retorna `null` quando o push está desligado; lança quando a configuração
 * está incoerente (o boot já valida as chaves, então isso é um invariante).
 */
export async function createPushSender(config: PushConfig): Promise<PushSender | null> {
  if (!config.enabled) return null;

  const publicJwk = config.vapidPublicKey === undefined
    ? null
    : parseVapidJwk(config.vapidPublicKey);
  const privateJwk = config.vapidPrivateKey === undefined
    ? null
    : parseVapidJwk(config.vapidPrivateKey);

  if (publicJwk === null || privateJwk === null || privateJwk.d === undefined) {
    throw new Error("chaves VAPID ausentes ou inválidas com PUSH_ENABLED=true");
  }

  const vapidKeys = await importVapidKeys({ publicKey: publicJwk, privateKey: privateJwk });
  // As chaves ECDH do servidor são efêmeras: só protegem o payload de cada
  // entrega, enquanto o par VAPID identifica a aplicação perante o push service.
  const server = await ApplicationServer.new({
    contactInformation: config.subject,
    vapidKeys,
  });

  return {
    async send(target, payload) {
      const subscriber = server.subscribe({
        endpoint: target.endpoint,
        keys: { p256dh: target.keys.p256dh, auth: target.keys.auth },
      });

      await subscriber.pushTextMessage(JSON.stringify(payload), {
        ttl: config.ttlSeconds,
        urgency: Urgency.High,
        // `Topic` agrupa reenvios do mesmo aviso no serviço de push (máx. 32
        // caracteres URL-safe). O UUID sem hífens cabe exatamente.
        topic: payload.id.replaceAll("-", "").slice(0, 32),
      });
    },

    isGone(error) {
      if (!(error instanceof PushMessageError)) return false;
      // 404 e 410 significam assinatura inexistente/expirada; qualquer outro
      // status (429, 5xx, ...) é transitório e vale retry.
      return error.response.status === 404 || error.response.status === 410;
    },
  };
}
