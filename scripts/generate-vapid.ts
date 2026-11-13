import { exportVapidKeys, generateVapidKeys } from "@negrel/webpush";

/**
 * Gera o par VAPID usado pelo Web Push.
 *
 * A chave é um par EC P-256 exportável em JWK. Guarde as duas no ambiente;
 * trocar o par invalida todas as assinaturas existentes (os navegadores
 * renegociam na próxima abertura do app).
 */
const keys = await generateVapidKeys({ extractable: true });
const exported = await exportVapidKeys(keys);

const lines = [
  "# Cole no .env (ou no Portainer). Nunca commite este arquivo.",
  `PUSH_ENABLED=true`,
  `PUSH_VAPID_PUBLIC_KEY='${JSON.stringify(exported.publicKey)}'`,
  `PUSH_VAPID_PRIVATE_KEY='${JSON.stringify(exported.privateKey)}'`,
  `PUSH_VAPID_SUBJECT='mailto:voce@exemplo.com'`,
];

Deno.stdout.writeSync(new TextEncoder().encode(`${lines.join("\n")}\n`));
