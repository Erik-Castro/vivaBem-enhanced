/**
 * Cálculo puro de posição, custo médio e P&L de investimentos.
 *
 * Toda a matemática monetária usa inteiros em minor units; apenas a
 * quantidade é fracionária (ações fracionadas/cripto). O custo médio é
 * ponderado: cada compra soma preço + taxas à base de custo e cada venda
 * remove a fração proporcional da base, realizando o lucro/prejuízo.
 */

export const INVESTMENT_OPERATION_TYPES = ["buy", "sell", "dividend", "fee"] as const;

export type InvestmentOperationType = (typeof INVESTMENT_OPERATION_TYPES)[number];

export interface InvestmentOperation {
  readonly operationType: InvestmentOperationType;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly feesMinor: number;
  readonly operationDate: string;
  /** Desempate determinístico de operações no mesmo dia. */
  readonly createdAt?: string;
}

export interface InvestmentPosition {
  /** Quantidade atual (pode ser 0 após encerrar a posição). */
  readonly quantity: number;
  /** Total bruto comprado, sem taxas. */
  readonly investedMinor: number;
  /** Total bruto vendido, sem taxas. */
  readonly proceedsMinor: number;
  /** Custo da posição aberta, incluindo taxas proporcionais de compra. */
  readonly costBasisMinor: number;
  /** Custo médio por unidade da posição aberta. */
  readonly averageCostMinor: number;
  /** Lucro/prejuízo realizado em vendas e taxas avulsas. */
  readonly realizedPnlMinor: number;
  /** Dividendos líquidos de taxas. */
  readonly dividendsMinor: number;
  readonly feesMinor: number;
  readonly operationCount: number;
  readonly firstOperationDate: string | null;
  readonly lastOperationDate: string | null;
}

export function roundMoney(value: number): number {
  return Math.round(value);
}

export function computeInvestmentPosition(
  operations: readonly InvestmentOperation[],
): InvestmentPosition {
  const sorted = [...operations].sort(compareOperations);

  let quantity = 0;
  let investedMinor = 0;
  let proceedsMinor = 0;
  let costBasisMinor = 0;
  let realizedPnlMinor = 0;
  let dividendsMinor = 0;
  let feesMinor = 0;
  let firstOperationDate: string | null = null;
  let lastOperationDate: string | null = null;

  for (const operation of sorted) {
    assertOperation(operation);

    firstOperationDate ??= operation.operationDate;
    lastOperationDate = operation.operationDate;
    feesMinor += operation.feesMinor;

    const grossMinor = roundMoney(operation.quantity * operation.unitPriceMinor);

    switch (operation.operationType) {
      case "buy":
        quantity += operation.quantity;
        investedMinor += grossMinor;
        costBasisMinor += grossMinor + operation.feesMinor;
        break;

      case "sell": {
        if (operation.quantity > quantity + 1e-9) {
          throw new RangeError(
            `Venda de ${operation.quantity} maior que a posição de ${quantity}`,
          );
        }

        const removedCostMinor = quantity > 0
          ? roundMoney((costBasisMinor * operation.quantity) / quantity)
          : 0;

        proceedsMinor += grossMinor;
        realizedPnlMinor += grossMinor - operation.feesMinor - removedCostMinor;
        costBasisMinor -= removedCostMinor;
        quantity -= operation.quantity;

        if (quantity <= 1e-9) {
          quantity = 0;
          costBasisMinor = 0;
        }
        break;
      }

      case "dividend":
        dividendsMinor += grossMinor;
        // Taxas de dividendos reduzem o ganho realizado, não o dividendo bruto.
        realizedPnlMinor -= operation.feesMinor;
        break;

      case "fee":
        realizedPnlMinor -= operation.feesMinor;
        break;
    }
  }

  return {
    quantity,
    investedMinor,
    proceedsMinor,
    costBasisMinor,
    averageCostMinor: quantity > 0 ? roundMoney(costBasisMinor / quantity) : 0,
    realizedPnlMinor,
    dividendsMinor,
    feesMinor,
    operationCount: sorted.length,
    firstOperationDate,
    lastOperationDate,
  };
}

function compareOperations(a: InvestmentOperation, b: InvestmentOperation): number {
  if (a.operationDate !== b.operationDate) {
    return a.operationDate < b.operationDate ? -1 : 1;
  }
  const aCreated = a.createdAt ?? "";
  const bCreated = b.createdAt ?? "";
  if (aCreated === bCreated) return 0;
  return aCreated < bCreated ? -1 : 1;
}

function assertOperation(operation: InvestmentOperation): void {
  if (!Number.isFinite(operation.quantity) || operation.quantity <= 0) {
    throw new RangeError("A quantidade precisa ser positiva");
  }
  if (!Number.isInteger(operation.unitPriceMinor) || operation.unitPriceMinor < 0) {
    throw new RangeError("O preço unitário precisa ser inteiro em minor units");
  }
  if (!Number.isInteger(operation.feesMinor) || operation.feesMinor < 0) {
    throw new RangeError("As taxas precisam ser inteiras em minor units");
  }
}
