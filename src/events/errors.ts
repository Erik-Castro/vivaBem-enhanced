/**
 * Erros de processamento de eventos.
 *
 * A classificação vive na camada de eventos para que o registry e o processor
 * possam falhar sem depender do runtime do worker.
 */

/**
 * Payload inválido ou incompatível com o contrato do tipo de evento.
 *
 * Reprocessar não resolve: o evento vai direto para dead letter.
 */
export class EventPayloadError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "EventPayloadError";
  }
}

/**
 * Falha permanente declarada por um handler.
 *
 * Use quando repetir a entrega não muda o resultado (regra de negócio violada,
 * autorização negada, configuração ausente).
 */
export class PermanentEventError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "PermanentEventError";
  }
}

/**
 * Falha transitória declarada por um handler.
 *
 * Use quando a próxima tentativa pode funcionar (provedor fora do ar, timeouts).
 */
export class TransientEventError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "TransientEventError";
  }
}
