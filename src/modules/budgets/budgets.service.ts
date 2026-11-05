import { AppError } from "../../http/errors.ts";
import type { EventPublisher } from "../../events/event-publisher.ts";
import { monthBounds, todayUtc, yearBounds } from "../../shared/utils/date.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";
import type { UserPreferencesReader } from "../accounts/accounts.service.ts";
import type { CategoriesRepository, Category } from "../categories/categories.repository.ts";
import type { Budget, BudgetPeriodType, BudgetsRepository } from "./budgets.repository.ts";

/** Limiares fixos sinalizados em todo orçamento, além do alerta configurável. */
const DEFAULT_CROSSED_THRESHOLDS = [80, 90, 100] as const;

export type BudgetLevel = "ok" | "warning" | "exceeded";

export interface BudgetPeriod {
  readonly from: string;
  readonly to: string;
}

export interface BudgetStatus {
  readonly budget: Budget;
  readonly period: BudgetPeriod;
  readonly spentMinor: number;
  readonly remainingMinor: number;
  readonly percentUsed: number;
  readonly level: BudgetLevel;
  readonly crossedThresholds: number[];
  readonly isPeriodActive: boolean;
}

export interface CreateBudgetInput {
  readonly categoryId?: string | null;
  readonly name: string;
  readonly limitMinor: number;
  readonly currencyCode?: string;
  readonly periodType: BudgetPeriodType;
  readonly startDate: string;
  readonly endDate?: string | null;
  readonly alertThreshold?: number;
  readonly isActive?: boolean;
}

export interface UpdateBudgetInput {
  readonly categoryId?: string | null;
  readonly name?: string;
  readonly limitMinor?: number;
  readonly currencyCode?: string;
  readonly periodType?: BudgetPeriodType;
  readonly startDate?: string;
  readonly endDate?: string | null;
  readonly alertThreshold?: number;
  readonly isActive?: boolean;
}

export interface BudgetsServiceDependencies {
  readonly repository: BudgetsRepository;
  readonly categories: CategoriesRepository;
  readonly preferences: UserPreferencesReader;
  readonly events?: EventPublisher;
}

export class BudgetsService {
  readonly #repository: BudgetsRepository;
  readonly #categories: CategoriesRepository;
  readonly #preferences: UserPreferencesReader;
  readonly #events: EventPublisher | null;

  constructor(dependencies: BudgetsServiceDependencies) {
    this.#repository = dependencies.repository;
    this.#categories = dependencies.categories;
    this.#preferences = dependencies.preferences;
    this.#events = dependencies.events ?? null;
  }

  list(userId: string, includeInactive = false): Budget[] {
    return this.#repository.list(userId, includeInactive);
  }

  get(userId: string, budgetId: string): Budget {
    const budget = this.#repository.findById(userId, budgetId);
    if (!budget) {
      throw new AppError("NOT_FOUND", "Orçamento não encontrado");
    }
    return budget;
  }

  create(userId: string, input: CreateBudgetInput): Budget {
    const categoryId = input.categoryId ?? null;
    if (categoryId !== null) {
      this.#requireExpenseCategory(userId, categoryId);
    }

    const endDate = normalizeEndDate(input.periodType, input.endDate ?? null);
    assertPeriod(input.periodType, input.startDate, endDate);
    assertThreshold(input.alertThreshold ?? 80);

    const budgetId = uuidv7();
    const currencyCode = input.currencyCode ?? this.#baseCurrency(userId);
    const now = new Date().toISOString();

    this.#repository.create({
      id: budgetId,
      userId,
      categoryId,
      name: input.name.trim(),
      limitMinor: input.limitMinor,
      currencyCode,
      periodType: input.periodType,
      startDate: input.startDate,
      endDate,
      alertThreshold: input.alertThreshold ?? 80,
      isActive: input.isActive ?? true,
      now,
    });

    this.#publish("finance.budget.created", userId, budgetId, {
      budgetId,
      name: input.name.trim(),
      categoryId,
      limitMinor: input.limitMinor,
      currencyCode,
      periodType: input.periodType,
      startDate: input.startDate,
      endDate,
      alertThreshold: input.alertThreshold ?? 80,
    });

    return this.get(userId, budgetId);
  }

  update(userId: string, budgetId: string, input: UpdateBudgetInput): Budget {
    const current = this.get(userId, budgetId);
    const categoryId = input.categoryId === undefined ? current.categoryId : input.categoryId;
    if (categoryId !== null) {
      this.#requireExpenseCategory(userId, categoryId);
    }

    const periodType = input.periodType ?? current.periodType;
    const rawEndDate = input.endDate === undefined ? current.endDate : input.endDate;
    const endDate = normalizeEndDate(periodType, rawEndDate);
    const startDate = input.startDate ?? current.startDate;
    const alertThreshold = input.alertThreshold ?? current.alertThreshold;

    assertPeriod(periodType, startDate, endDate);
    assertThreshold(alertThreshold);

    this.#repository.update({
      id: budgetId,
      categoryId,
      name: input.name === undefined ? current.name : input.name.trim(),
      limitMinor: input.limitMinor ?? current.limitMinor,
      currencyCode: input.currencyCode ?? current.currencyCode,
      periodType,
      startDate,
      endDate,
      alertThreshold,
      isActive: input.isActive ?? current.isActive,
      now: new Date().toISOString(),
    });

    this.#publish("finance.budget.updated", userId, budgetId, {
      budgetId,
      name: input.name === undefined ? current.name : input.name.trim(),
      categoryId,
      limitMinor: input.limitMinor ?? current.limitMinor,
      currencyCode: input.currencyCode ?? current.currencyCode,
      periodType,
      startDate,
      endDate,
      alertThreshold,
      isActive: input.isActive ?? current.isActive,
    });

    return this.get(userId, budgetId);
  }

  delete(userId: string, budgetId: string): void {
    this.get(userId, budgetId);
    this.#repository.deactivate(userId, budgetId, new Date().toISOString());
  }

  status(userId: string, referenceDate = todayUtc(), includeInactive = false): BudgetStatus[] {
    const budgets = this.#repository.list(userId, includeInactive);
    return budgets.map((budget) => this.#statusFor(userId, budget, referenceDate));
  }

  #statusFor(userId: string, budget: Budget, referenceDate: string): BudgetStatus {
    const period = periodFor(budget, referenceDate);
    const isPeriodActive = referenceDate >= period.from && referenceDate <= period.to;
    const spentMinor = isPeriodActive
      ? this.#repository.spentMinor(userId, budget, period.from, period.to)
      : 0;
    const remainingMinor = budget.limitMinor - spentMinor;
    const percentUsed = Math.round((spentMinor * 10_000) / budget.limitMinor) / 100;
    const exceeded = spentMinor * 100 >= budget.limitMinor * 100;
    const warning = spentMinor * 100 >= budget.limitMinor * budget.alertThreshold;

    return {
      budget,
      period,
      spentMinor,
      remainingMinor,
      percentUsed,
      level: exceeded ? "exceeded" : warning ? "warning" : "ok",
      crossedThresholds: DEFAULT_CROSSED_THRESHOLDS.filter(
        (threshold) => spentMinor * 100 >= budget.limitMinor * threshold,
      ),
      isPeriodActive,
    };
  }

  #publish(
    type: "finance.budget.created" | "finance.budget.updated",
    userId: string,
    budgetId: string,
    payload: Record<string, unknown>,
  ): void {
    this.#events?.publish({
      type,
      aggregateType: "budget",
      aggregateId: budgetId,
      userId,
      payload,
    });
  }

  #requireExpenseCategory(userId: string, categoryId: string): Category {
    const category = this.#categories.findById(userId, categoryId);
    if (!category || !category.isActive) {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{ path: "categoryId", message: "Categoria não encontrada ou inativa" }],
      });
    }
    if (category.type !== "expense") {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{
          path: "categoryId",
          message: "O orçamento precisa de uma categoria de despesa",
        }],
      });
    }
    return category;
  }

  #baseCurrency(userId: string): string {
    return this.#preferences.findPreferences(userId)?.baseCurrency ?? "BRL";
  }
}

function periodFor(budget: Budget, referenceDate: string): BudgetPeriod {
  switch (budget.periodType) {
    case "monthly": {
      const bounds = monthBounds(referenceDate);
      return {
        from: bounds.from < budget.startDate ? budget.startDate : bounds.from,
        to: bounds.to,
      };
    }
    case "yearly": {
      const bounds = yearBounds(referenceDate);
      return {
        from: bounds.from < budget.startDate ? budget.startDate : bounds.from,
        to: bounds.to,
      };
    }
    case "custom":
      return { from: budget.startDate, to: budget.endDate ?? budget.startDate };
  }
}

function normalizeEndDate(
  periodType: BudgetPeriodType,
  endDate: string | null,
): string | null {
  if (periodType !== "custom") return null;
  if (endDate === null) {
    throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
      details: [{ path: "endDate", message: "Orçamentos personalizados exigem data final" }],
    });
  }
  return endDate;
}

function assertPeriod(
  periodType: BudgetPeriodType,
  startDate: string,
  endDate: string | null,
): void {
  if (periodType === "custom" && endDate !== null && endDate < startDate) {
    throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
      details: [{
        path: "endDate",
        message: "A data final precisa ser igual ou posterior à data inicial",
      }],
    });
  }
}

function assertThreshold(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
      details: [{ path: "alertThreshold", message: "O alerta deve estar entre 1 e 100" }],
    });
  }
}
