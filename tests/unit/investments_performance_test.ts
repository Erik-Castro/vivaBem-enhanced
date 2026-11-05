import { assertEquals, assertThrows } from "@std/assert";
import {
  computeInvestmentPosition,
  type InvestmentOperation,
} from "../../src/modules/investments/investments.performance.ts";

function op(
  overrides: Partial<InvestmentOperation> & Pick<InvestmentOperation, "operationType">,
): InvestmentOperation {
  return {
    quantity: 1,
    unitPriceMinor: 0,
    feesMinor: 0,
    operationDate: "2026-11-01",
    ...overrides,
  };
}

Deno.test("compra acumula quantidade, investido e custo médio com taxas", () => {
  const position = computeInvestmentPosition([
    op({ operationType: "buy", quantity: 10, unitPriceMinor: 1_000, feesMinor: 50 }),
  ]);

  assertEquals(position.quantity, 10);
  assertEquals(position.investedMinor, 10_000);
  assertEquals(position.costBasisMinor, 10_050);
  assertEquals(position.averageCostMinor, 1_005);
  assertEquals(position.realizedPnlMinor, 0);
  assertEquals(position.feesMinor, 50);
});

Deno.test("venda remove custo proporcional e realiza lucro", () => {
  const position = computeInvestmentPosition([
    op({ operationType: "buy", quantity: 10, unitPriceMinor: 1_000 }),
    op({
      operationType: "sell",
      quantity: 4,
      unitPriceMinor: 1_500,
      feesMinor: 20,
      operationDate: "2026-11-02",
    }),
  ]);

  assertEquals(position.quantity, 6);
  assertEquals(position.costBasisMinor, 6_000);
  assertEquals(position.proceedsMinor, 6_000);
  // 6000 bruto - 20 taxa - 4000 de custo removido.
  assertEquals(position.realizedPnlMinor, 1_980);
  assertEquals(position.averageCostMinor, 1_000);
});

Deno.test("vender toda a posição zera o custo e mantém o realizado", () => {
  const position = computeInvestmentPosition([
    op({ operationType: "buy", quantity: 5, unitPriceMinor: 2_000 }),
    op({
      operationType: "sell",
      quantity: 5,
      unitPriceMinor: 2_500,
      operationDate: "2026-11-02",
    }),
  ]);

  assertEquals(position.quantity, 0);
  assertEquals(position.costBasisMinor, 0);
  assertEquals(position.averageCostMinor, 0);
  assertEquals(position.realizedPnlMinor, 2_500);
});

Deno.test("quantidades fracionárias preservam o custo médio", () => {
  const position = computeInvestmentPosition([
    op({ operationType: "buy", quantity: 0.5, unitPriceMinor: 30_000 }),
    op({
      operationType: "sell",
      quantity: 0.25,
      unitPriceMinor: 40_000,
      operationDate: "2026-11-02",
    }),
  ]);

  assertEquals(position.quantity, 0.25);
  assertEquals(position.investedMinor, 15_000);
  assertEquals(position.costBasisMinor, 7_500);
  assertEquals(position.realizedPnlMinor, 2_500);
  assertEquals(position.averageCostMinor, 30_000);
});

Deno.test("dividendos e taxas compõem o resultado realizado", () => {
  const position = computeInvestmentPosition([
    op({ operationType: "buy", quantity: 10, unitPriceMinor: 1_000 }),
    op({
      operationType: "dividend",
      quantity: 10,
      unitPriceMinor: 50,
      feesMinor: 5,
      operationDate: "2026-11-02",
    }),
    op({
      operationType: "fee",
      feesMinor: 25,
      operationDate: "2026-11-03",
    }),
  ]);

  assertEquals(position.dividendsMinor, 500);
  assertEquals(position.realizedPnlMinor, -30);
  assertEquals(position.feesMinor, 30);
  // O custo da posição não é afetado por dividendos nem taxas avulsas.
  assertEquals(position.costBasisMinor, 10_000);
  assertEquals(position.quantity, 10);
});

Deno.test("operações são ordenadas por data mesmo fora de ordem", () => {
  const position = computeInvestmentPosition([
    op({
      operationType: "sell",
      quantity: 2,
      unitPriceMinor: 1_500,
      operationDate: "2026-11-03",
    }),
    op({
      operationType: "buy",
      quantity: 10,
      unitPriceMinor: 1_000,
      operationDate: "2026-11-01",
    }),
  ]);

  assertEquals(position.quantity, 8);
  assertEquals(position.realizedPnlMinor, 1_000);
  assertEquals(position.firstOperationDate, "2026-11-01");
  assertEquals(position.lastOperationDate, "2026-11-03");
});

Deno.test("venda a descoberto é rejeitada", () => {
  assertThrows(
    () =>
      computeInvestmentPosition([
        op({ operationType: "buy", quantity: 1, unitPriceMinor: 1_000 }),
        op({
          operationType: "sell",
          quantity: 2,
          unitPriceMinor: 1_000,
          operationDate: "2026-11-02",
        }),
      ]),
    RangeError,
  );
});

Deno.test("venda retroativa abaixo do saldo histórico é rejeitada", () => {
  // A primeira compra chega só no dia 10; vender no dia 5 ficaria a descoberto.
  assertThrows(
    () =>
      computeInvestmentPosition([
        op({
          operationType: "sell",
          quantity: 1,
          unitPriceMinor: 1_000,
          operationDate: "2026-11-05",
        }),
        op({
          operationType: "buy",
          quantity: 10,
          unitPriceMinor: 1_000,
          operationDate: "2026-11-10",
        }),
      ]),
    RangeError,
  );
});
