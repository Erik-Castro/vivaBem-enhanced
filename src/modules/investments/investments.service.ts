import type { AppDatabase } from "../../db/client.ts";
import { AppError } from "../../http/errors.ts";
import type { EventPublisher } from "../../events/event-publisher.ts";
import { todayUtc } from "../../shared/utils/date.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";
import type { Account, AccountsRepository } from "../accounts/accounts.repository.ts";
import {
  computeInvestmentPosition,
  type InvestmentOperation,
  type InvestmentOperationType,
  type InvestmentPosition,
  roundMoney,
} from "./investments.performance.ts";
import type {
  Investment,
  InvestmentQuote,
  InvestmentsRepository,
  InvestmentTransaction,
} from "./investments.repository.ts";

export interface UserPreferencesReader {
  findPreferences(userId: string): { readonly baseCurrency: string } | undefined;
}

export interface CreateInvestmentInput {
  readonly ticker: string;
  readonly name: string;
  readonly assetClass: string;
  readonly currencyCode?: string;
}

export interface UpdateInvestmentInput {
  readonly ticker?: string;
  readonly name?: string;
  readonly assetClass?: string;
  readonly currencyCode?: string;
}

export interface CreateInvestmentTransactionInput {
  readonly accountId: string;
  readonly operationType: InvestmentOperationType;
  readonly quantity?: number;
  readonly unitPriceMinor?: number;
  readonly feesMinor?: number;
  readonly operationDate: string;
}

export interface CreateInvestmentQuoteInput {
  readonly priceMinor: number;
  readonly quotedAt?: string;
  readonly source?: string | null;
}

export interface ListTransactionsInput {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<T> {
  readonly items: T[];
  readonly hasMore: boolean;
}

/** Posição enriquecida com a última cotação e o P&L consolidado. */
export interface InvestmentPositionView extends InvestmentPosition {
  readonly investmentId: string;
  readonly ticker: string;
  readonly name: string;
  readonly assetClass: string;
  readonly currencyCode: string;
  readonly currentPriceMinor: number | null;
  readonly marketValueMinor: number | null;
  readonly unrealizedPnlMinor: number | null;
  readonly totalPnlMinor: number;
  readonly returnPercent: number;
  readonly quoteQuotedAt: string | null;
}

export interface PortfolioTotal {
  readonly currencyCode: string;
  readonly investmentCount: number;
  readonly pricedCount: number;
  readonly investedMinor: number;
  readonly costBasisMinor: number;
  readonly marketValueMinor: number;
  readonly unrealizedPnlMinor: number;
  readonly realizedPnlMinor: number;
  readonly dividendsMinor: number;
  readonly feesMinor: number;
  readonly totalPnlMinor: number;
  /** `false` quando algum ativo com posição aberta ainda não tem cotação. */
  readonly valuationComplete: boolean;
}

export interface Portfolio {
  readonly positions: InvestmentPositionView[];
  readonly totals: PortfolioTotal[];
}

export interface InvestmentsServiceDependencies {
  readonly db: AppDatabase;
  readonly repository: InvestmentsRepository;
  readonly accounts: AccountsRepository;
  readonly preferences: UserPreferencesReader;
  readonly events?: EventPublisher;
}

export class InvestmentsService {
  readonly #db: AppDatabase;
  readonly #repository: InvestmentsRepository;
  readonly #accounts: AccountsRepository;
  readonly #preferences: UserPreferencesReader;
  readonly #events: EventPublisher | null;

  constructor(dependencies: InvestmentsServiceDependencies) {
    this.#db = dependencies.db;
    this.#repository = dependencies.repository;
    this.#accounts = dependencies.accounts;
    this.#preferences = dependencies.preferences;
    this.#events = dependencies.events ?? null;
  }

  list(userId: string, assetClass?: string): Investment[] {
    return this.#repository.list(userId, {
      assetClass: assetClass?.trim() || undefined,
    });
  }

  get(userId: string, investmentId: string): Investment {
    return this.#requireInvestment(userId, investmentId);
  }

  create(userId: string, input: CreateInvestmentInput): Investment {
    const ticker = input.ticker.trim();
    this.#assertTickerAvailable(userId, ticker);

    const currencyCode = input.currencyCode ?? this.#baseCurrency(userId);
    const investmentId = uuidv7();
    const now = new Date().toISOString();

    this.#repository.create({
      id: investmentId,
      userId,
      ticker,
      name: input.name.trim(),
      assetClass: input.assetClass.trim(),
      currencyCode,
      now,
    });

    return this.get(userId, investmentId);
  }

  update(userId: string, investmentId: string, input: UpdateInvestmentInput): Investment {
    const current = this.#requireInvestment(userId, investmentId);

    const ticker = input.ticker === undefined ? current.ticker : input.ticker.trim();
    if (ticker !== current.ticker) {
      this.#assertTickerAvailable(userId, ticker, investmentId);
    }

    const currencyCode = input.currencyCode ?? current.currencyCode;
    if (
      currencyCode !== current.currencyCode &&
      this.#repository.hasTransactions(investmentId)
    ) {
      throw new AppError(
        "CONFLICT",
        "A moeda não pode ser alterada depois de existirem operações",
      );
    }

    this.#repository.update({
      id: investmentId,
      ticker,
      name: input.name === undefined ? current.name : input.name.trim(),
      assetClass: input.assetClass === undefined ? current.assetClass : input.assetClass.trim(),
      currencyCode,
      now: new Date().toISOString(),
    });

    return this.get(userId, investmentId);
  }

  /** Soft delete: operações e cotações continuam preservadas para auditoria. */
  delete(userId: string, investmentId: string): void {
    this.#requireInvestment(userId, investmentId);
    this.#repository.softDelete(investmentId, new Date().toISOString());
  }

  addTransaction(
    userId: string,
    investmentId: string,
    input: CreateInvestmentTransactionInput,
  ): InvestmentTransaction {
    const investment = this.#requireInvestment(userId, investmentId);
    const account = this.#requireAccount(userId, input.accountId);

    if (!account.isActive) {
      throw validationError("accountId", "A conta está inativa");
    }

    if (account.currencyCode !== investment.currencyCode) {
      throw validationError(
        "accountId",
        "A conta precisa ter a mesma moeda do ativo",
      );
    }

    const startDate = investment.createdAt.slice(0, 10);
    if (input.operationDate > todayUtc()) {
      throw validationError("operationDate", "A operação não pode ser futura");
    }
    if (input.operationDate < startDate) {
      throw validationError(
        "operationDate",
        "A operação é anterior à criação do ativo",
      );
    }

    const now = new Date().toISOString();
    const candidate = normalizeOperation(input, now);

    // Recalcula a posição inteira com a candidata: impede venda a descoberto,
    // inclusive quando a operação é retroativa e muda a ordem cronológica.
    try {
      computeInvestmentPosition([
        ...this.#repository.listTransactions(investmentId).map(toOperation),
        candidate,
      ]);
    } catch (error) {
      if (error instanceof RangeError) {
        throw validationError("quantity", error.message);
      }
      throw error;
    }

    const transactionId = uuidv7();

    this.#db.transaction(() => {
      this.#repository.insertTransaction({
        id: transactionId,
        investmentId,
        accountId: input.accountId,
        operationType: candidate.operationType,
        quantity: candidate.quantity,
        unitPriceMinor: candidate.unitPriceMinor,
        feesMinor: candidate.feesMinor,
        operationDate: candidate.operationDate,
        now,
      });

      this.#events?.publish({
        type: "investment.transaction.created",
        aggregateType: "investment_transaction",
        aggregateId: transactionId,
        userId,
        payload: {
          investmentId,
          transactionId,
          ticker: investment.ticker,
          operationType: candidate.operationType,
          quantity: candidate.quantity,
          unitPriceMinor: candidate.unitPriceMinor,
          feesMinor: candidate.feesMinor,
          operationDate: candidate.operationDate,
        },
      });
    });

    const created = this.#repository.findTransactionById(investmentId, transactionId);
    if (!created) {
      throw new AppError("INTERNAL_ERROR", "Falha ao registrar a operação");
    }
    return created;
  }

  listTransactions(
    userId: string,
    investmentId: string,
    input: ListTransactionsInput,
  ): Page<InvestmentTransaction> {
    this.#requireInvestment(userId, investmentId);

    const rows = this.#repository.listTransactionsPage(
      investmentId,
      input.limit + 1,
      input.offset,
    );

    return {
      items: rows.slice(0, input.limit),
      hasMore: rows.length > input.limit,
    };
  }

  position(userId: string, investmentId: string): InvestmentPositionView {
    const investment = this.#requireInvestment(userId, investmentId);
    const operations = this.#repository.listTransactions(investmentId).map(toOperation);
    return buildPositionView(
      investment,
      computeInvestmentPosition(operations),
      this.#repository.latestQuote(investmentId),
    );
  }

  portfolio(userId: string): Portfolio {
    const investments = this.#repository.list(userId);
    const positions = investments.map((investment) => {
      const operations = this.#repository.listTransactions(investment.id)
        .map(toOperation);
      return buildPositionView(
        investment,
        computeInvestmentPosition(operations),
        this.#repository.latestQuote(investment.id),
      );
    });

    return { positions, totals: aggregateTotals(positions) };
  }

  listQuotes(
    userId: string,
    investmentId: string,
    input: ListTransactionsInput,
  ): Page<InvestmentQuote> {
    this.#requireInvestment(userId, investmentId);

    const rows = this.#repository.listQuotes(investmentId, {
      limit: input.limit + 1,
      offset: input.offset,
    });

    return {
      items: rows.slice(0, input.limit),
      hasMore: rows.length > input.limit,
    };
  }

  addQuote(
    userId: string,
    investmentId: string,
    input: CreateInvestmentQuoteInput,
  ): InvestmentQuote {
    const investment = this.#requireInvestment(userId, investmentId);

    const quote: InvestmentQuote = {
      id: uuidv7(),
      investmentId,
      priceMinor: input.priceMinor,
      quotedAt: input.quotedAt ?? new Date().toISOString(),
      source: normalizeText(input.source),
      createdAt: new Date().toISOString(),
    };

    this.#repository.insertQuote({
      id: quote.id,
      investmentId,
      priceMinor: quote.priceMinor,
      quotedAt: quote.quotedAt,
      source: quote.source,
      now: quote.createdAt,
    });

    this.#events?.publish({
      type: "investment.quote.created",
      aggregateType: "investment",
      aggregateId: investmentId,
      userId,
      payload: {
        investmentId,
        ticker: investment.ticker,
        quoteId: quote.id,
        priceMinor: quote.priceMinor,
        currencyCode: investment.currencyCode,
        quotedAt: quote.quotedAt,
        source: quote.source,
      },
    });

    return quote;
  }

  #requireInvestment(userId: string, investmentId: string): Investment {
    const investment = this.#repository.findById(userId, investmentId);
    if (!investment) {
      throw new AppError("NOT_FOUND", "Ativo não encontrado");
    }
    return investment;
  }

  #requireAccount(userId: string, accountId: string): Account {
    const account = this.#accounts.findById(userId, accountId);
    if (!account) {
      throw new AppError("NOT_FOUND", "Conta não encontrada");
    }
    return account;
  }

  #assertTickerAvailable(
    userId: string,
    ticker: string,
    excludeId?: string,
  ): void {
    const existing = this.#repository.findByTicker(userId, ticker, excludeId);
    if (existing) {
      throw new AppError("CONFLICT", "Já existe um ativo com este ticker");
    }
  }

  #baseCurrency(userId: string): string {
    return this.#preferences.findPreferences(userId)?.baseCurrency ?? "BRL";
  }
}

interface NormalizedOperation extends InvestmentOperation {
  readonly operationType: InvestmentOperationType;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly feesMinor: number;
  readonly operationDate: string;
  readonly createdAt: string;
}

function normalizeOperation(
  input: CreateInvestmentTransactionInput,
  now: string,
): NormalizedOperation {
  return {
    operationType: input.operationType,
    quantity: input.quantity ?? 1,
    unitPriceMinor: input.unitPriceMinor ?? 0,
    feesMinor: input.feesMinor ?? 0,
    operationDate: input.operationDate,
    // A operação nova é a última do dia; sem o carimbo ela se ordenaria antes
    // das existentes e a validação de venda a descoberto falharia.
    createdAt: now,
  };
}

function toOperation(transaction: InvestmentTransaction): InvestmentOperation {
  return {
    operationType: transaction.operationType,
    quantity: transaction.quantity,
    unitPriceMinor: transaction.unitPriceMinor,
    feesMinor: transaction.feesMinor,
    operationDate: transaction.operationDate,
    createdAt: transaction.createdAt,
  };
}

function buildPositionView(
  investment: Investment,
  position: InvestmentPosition,
  quote: InvestmentQuote | undefined,
): InvestmentPositionView {
  const currentPriceMinor = quote?.priceMinor ?? null;
  const marketValueMinor = quote ? roundMoney(position.quantity * quote.priceMinor) : null;
  const unrealizedPnlMinor = marketValueMinor === null
    ? null
    : marketValueMinor - position.costBasisMinor;
  const totalPnlMinor = position.realizedPnlMinor +
    position.dividendsMinor +
    (unrealizedPnlMinor ?? 0);
  const returnPercent = position.investedMinor > 0
    ? Math.round((totalPnlMinor / position.investedMinor) * 10_000) / 100
    : 0;

  return {
    ...position,
    investmentId: investment.id,
    ticker: investment.ticker,
    name: investment.name,
    assetClass: investment.assetClass,
    currencyCode: investment.currencyCode,
    currentPriceMinor,
    marketValueMinor,
    unrealizedPnlMinor,
    totalPnlMinor,
    returnPercent,
    quoteQuotedAt: quote?.quotedAt ?? null,
  };
}

function aggregateTotals(positions: readonly InvestmentPositionView[]): PortfolioTotal[] {
  const totals = new Map<string, {
    investmentCount: number;
    pricedCount: number;
    investedMinor: number;
    costBasisMinor: number;
    marketValueMinor: number;
    unrealizedPnlMinor: number;
    realizedPnlMinor: number;
    dividendsMinor: number;
    feesMinor: number;
    totalPnlMinor: number;
    openUnpriced: boolean;
  }>();

  for (const position of positions) {
    const current = totals.get(position.currencyCode) ?? {
      investmentCount: 0,
      pricedCount: 0,
      investedMinor: 0,
      costBasisMinor: 0,
      marketValueMinor: 0,
      unrealizedPnlMinor: 0,
      realizedPnlMinor: 0,
      dividendsMinor: 0,
      feesMinor: 0,
      totalPnlMinor: 0,
      openUnpriced: false,
    };

    current.investmentCount += 1;
    current.investedMinor += position.investedMinor;
    current.costBasisMinor += position.costBasisMinor;
    current.realizedPnlMinor += position.realizedPnlMinor;
    current.dividendsMinor += position.dividendsMinor;
    current.feesMinor += position.feesMinor;
    current.totalPnlMinor += position.totalPnlMinor;

    if (position.currentPriceMinor !== null) {
      current.pricedCount += 1;
      current.marketValueMinor += position.marketValueMinor ?? 0;
      current.unrealizedPnlMinor += position.unrealizedPnlMinor ?? 0;
    } else if (position.quantity > 0) {
      current.openUnpriced = true;
    }

    totals.set(position.currencyCode, current);
  }

  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currencyCode, total]) => ({
      currencyCode,
      investmentCount: total.investmentCount,
      pricedCount: total.pricedCount,
      investedMinor: total.investedMinor,
      costBasisMinor: total.costBasisMinor,
      marketValueMinor: total.marketValueMinor,
      unrealizedPnlMinor: total.unrealizedPnlMinor,
      realizedPnlMinor: total.realizedPnlMinor,
      dividendsMinor: total.dividendsMinor,
      feesMinor: total.feesMinor,
      totalPnlMinor: total.totalPnlMinor,
      valuationComplete: !total.openUnpriced,
    }));
}

function normalizeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function validationError(path: string, message: string): AppError {
  return new AppError("VALIDATION_ERROR", "Dados inválidos", {
    details: [{ path, message }],
  });
}
