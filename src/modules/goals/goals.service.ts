import type { AppDatabase } from "../../db/client.ts";
import { AppError } from "../../http/errors.ts";
import type { EventPublisher } from "../../events/event-publisher.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";
import type { Account, AccountsRepository } from "../accounts/accounts.repository.ts";
import type { UserPreferencesReader } from "../accounts/accounts.service.ts";
import type { Goal, GoalContribution, GoalsRepository, GoalStatus } from "./goals.repository.ts";

export interface GoalProgress {
  readonly goal: Goal;
  readonly contributions: GoalContribution[];
  readonly contributedMinor: number;
  readonly remainingMinor: number;
  readonly progressPercent: number;
  readonly isCompleted: boolean;
  readonly contributionCount: number;
  readonly lastContributionDate: string | null;
}

export interface CreateGoalInput {
  readonly targetAccountId?: string | null;
  readonly name: string;
  readonly description?: string | null;
  readonly targetAmountMinor: number;
  readonly currencyCode?: string;
  readonly targetDate?: string | null;
}

export interface UpdateGoalInput {
  readonly targetAccountId?: string | null;
  readonly name?: string;
  readonly description?: string | null;
  readonly targetAmountMinor?: number;
  readonly currencyCode?: string;
  readonly targetDate?: string | null;
  readonly status?: Exclude<GoalStatus, "completed">;
}

export interface CreateContributionInput {
  readonly accountId?: string | null;
  readonly amountMinor: number;
  readonly contributionDate: string;
  readonly note?: string | null;
}

export interface GoalsServiceDependencies {
  readonly db: AppDatabase;
  readonly repository: GoalsRepository;
  readonly accounts: AccountsRepository;
  readonly preferences: UserPreferencesReader;
  readonly events?: EventPublisher;
}

export class GoalsService {
  readonly #db: AppDatabase;
  readonly #repository: GoalsRepository;
  readonly #accounts: AccountsRepository;
  readonly #preferences: UserPreferencesReader;
  readonly #events: EventPublisher | null;

  constructor(dependencies: GoalsServiceDependencies) {
    this.#db = dependencies.db;
    this.#repository = dependencies.repository;
    this.#accounts = dependencies.accounts;
    this.#preferences = dependencies.preferences;
    this.#events = dependencies.events ?? null;
  }

  list(userId: string, status?: GoalStatus): Goal[] {
    return this.#repository.list(userId, { status });
  }

  get(userId: string, goalId: string): Goal {
    const goal = this.#repository.findById(userId, goalId);
    if (!goal) {
      throw new AppError("NOT_FOUND", "Meta não encontrada");
    }
    return goal;
  }

  create(userId: string, input: CreateGoalInput): Goal {
    const targetAccountId = input.targetAccountId ?? null;
    if (targetAccountId !== null) {
      this.#requireAccount(userId, targetAccountId);
    }

    const goalId = uuidv7();
    const now = new Date().toISOString();

    this.#repository.create({
      id: goalId,
      userId,
      targetAccountId,
      name: input.name.trim(),
      description: normalizeDescription(input.description),
      targetAmountMinor: input.targetAmountMinor,
      currencyCode: input.currencyCode ?? this.#baseCurrency(userId),
      targetDate: input.targetDate ?? null,
      status: "active",
      now,
    });

    return this.get(userId, goalId);
  }

  update(userId: string, goalId: string, input: UpdateGoalInput): Goal {
    const current = this.get(userId, goalId);
    const targetAccountId = input.targetAccountId === undefined
      ? current.targetAccountId
      : input.targetAccountId;

    if (targetAccountId !== null) {
      this.#requireAccount(userId, targetAccountId);
    }

    const currencyCode = input.currencyCode ?? current.currencyCode;
    if (currencyCode !== current.currencyCode && this.#repository.hasContributions(goalId)) {
      throw new AppError(
        "CONFLICT",
        "A moeda da meta não pode ser alterada depois de receber contribuições",
      );
    }

    const targetAmountMinor = input.targetAmountMinor ?? current.targetAmountMinor;
    const contributedMinor = this.#repository.sumContributions(goalId);
    let status: GoalStatus = input.status ?? current.status;

    if (status === "active" && contributedMinor >= targetAmountMinor) {
      status = "completed";
    } else if (status === "completed" && contributedMinor < targetAmountMinor) {
      status = "active";
    }

    this.#repository.update({
      id: goalId,
      targetAccountId,
      name: input.name === undefined ? current.name : input.name.trim(),
      description: input.description === undefined
        ? current.description
        : normalizeDescription(input.description),
      targetAmountMinor,
      currencyCode,
      targetDate: input.targetDate === undefined ? current.targetDate : input.targetDate,
      status,
      now: new Date().toISOString(),
    });

    return this.get(userId, goalId);
  }

  delete(userId: string, goalId: string): void {
    this.get(userId, goalId);
    this.#repository.updateStatus(goalId, "cancelled", new Date().toISOString());
  }

  progress(userId: string, goalId: string): GoalProgress {
    return this.#progressFor(this.get(userId, goalId));
  }

  addContribution(
    userId: string,
    goalId: string,
    input: CreateContributionInput,
  ): GoalProgress {
    const goal = this.get(userId, goalId);
    if (goal.status === "cancelled") {
      throw new AppError("CONFLICT", "Metas canceladas não aceitam contribuições");
    }

    const accountId = input.accountId ?? null;
    if (accountId !== null) {
      this.#requireAccount(userId, accountId);
    }

    const now = new Date().toISOString();
    const contributionId = uuidv7();

    this.#db.transaction(() => {
      this.#repository.insertContribution({
        id: contributionId,
        goalId,
        accountId,
        transactionId: null,
        amountMinor: input.amountMinor,
        contributionDate: input.contributionDate,
        note: normalizeDescription(input.note),
        now,
      });

      if (
        goal.status === "active" && this.#repository.sumContributions(goalId) >=
          goal.targetAmountMinor
      ) {
        this.#repository.updateStatus(goalId, "completed", now);
      }

      this.#events?.publish({
        type: "finance.goal.contribution.created",
        aggregateType: "goal",
        aggregateId: goalId,
        userId,
        payload: {
          goalId,
          goalName: goal.name,
          contributionId,
          amountMinor: input.amountMinor,
          currencyCode: goal.currencyCode,
          contributionDate: input.contributionDate,
          targetAmountMinor: goal.targetAmountMinor,
        },
      });
    });

    return this.progress(userId, goalId);
  }

  removeContribution(userId: string, goalId: string, contributionId: string): GoalProgress {
    const goal = this.get(userId, goalId);
    const contribution = this.#repository.findContribution(goalId, contributionId);
    if (!contribution) {
      throw new AppError("NOT_FOUND", "Contribuição não encontrada");
    }

    const now = new Date().toISOString();

    this.#db.transaction(() => {
      this.#repository.softDeleteContribution(contributionId, now);

      if (
        goal.status === "completed" &&
        this.#repository.sumContributions(goalId) < goal.targetAmountMinor
      ) {
        this.#repository.updateStatus(goalId, "active", now);
      }
    });

    return this.progress(userId, goalId);
  }

  #progressFor(goal: Goal): GoalProgress {
    const contributions = this.#repository.listContributions(goal.id);
    const contributedMinor = this.#repository.sumContributions(goal.id);
    const remainingMinor = Math.max(0, goal.targetAmountMinor - contributedMinor);

    return {
      goal,
      contributions,
      contributedMinor,
      remainingMinor,
      progressPercent: Math.round((contributedMinor * 10_000) / goal.targetAmountMinor) / 100,
      isCompleted: contributedMinor >= goal.targetAmountMinor,
      contributionCount: contributions.length,
      lastContributionDate: contributions[0]?.contributionDate ?? null,
    };
  }

  #requireAccount(userId: string, accountId: string): Account {
    const account = this.#accounts.findById(userId, accountId);
    if (!account) {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{ path: "accountId", message: "Conta não encontrada" }],
      });
    }
    if (!account.isActive) {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{ path: "accountId", message: "A conta está inativa" }],
      });
    }
    return account;
  }

  #baseCurrency(userId: string): string {
    return this.#preferences.findPreferences(userId)?.baseCurrency ?? "BRL";
  }
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
