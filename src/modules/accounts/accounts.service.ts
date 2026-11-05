import type { AppDatabase } from "../../db/client.ts";
import { AppError } from "../../http/errors.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";
import type {
  Account,
  AccountBalance,
  AccountsRepository,
  AccountType,
  CreditCardDetails,
} from "./accounts.repository.ts";

export interface UserPreferencesReader {
  findPreferences(userId: string): { readonly baseCurrency: string } | undefined;
}

export interface CreateAccountInput {
  readonly name: string;
  readonly type: AccountType;
  readonly currencyCode?: string;
  readonly creditCard?: CreditCardDetails;
}

export interface UpdateAccountInput {
  readonly name?: string;
  readonly currencyCode?: string;
  readonly isActive?: boolean;
  readonly creditCard?: {
    readonly closingDay?: number;
    readonly dueDay?: number;
    readonly limitMinor?: number;
  };
}

export interface AccountsServiceDependencies {
  readonly db: AppDatabase;
  readonly repository: AccountsRepository;
  readonly preferences: UserPreferencesReader;
}

export class AccountsService {
  readonly #db: AppDatabase;
  readonly #repository: AccountsRepository;
  readonly #preferences: UserPreferencesReader;

  constructor(dependencies: AccountsServiceDependencies) {
    this.#db = dependencies.db;
    this.#repository = dependencies.repository;
    this.#preferences = dependencies.preferences;
  }

  list(userId: string, includeInactive = false): Account[] {
    return this.#repository.list(userId, includeInactive);
  }

  get(userId: string, accountId: string): Account {
    const account = this.#repository.findById(userId, accountId);
    if (!account) {
      throw new AppError("NOT_FOUND", "Conta não encontrada");
    }
    return account;
  }

  create(userId: string, input: CreateAccountInput): Account {
    const name = input.name.trim();
    this.#assertUniqueName(userId, name);

    if (input.type === "credit_card" && input.creditCard === undefined) {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{
          path: "creditCard",
          message: "Informe fechamento, vencimento e limite do cartão",
        }],
      });
    }

    if (input.type !== "credit_card" && input.creditCard !== undefined) {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{
          path: "creditCard",
          message: "Detalhes de cartão só se aplicam ao tipo credit_card",
        }],
      });
    }

    const currencyCode = input.currencyCode ??
      this.#preferences.findPreferences(userId)?.baseCurrency ??
      "BRL";
    const accountId = uuidv7();
    const now = new Date().toISOString();

    this.#db.transaction(() => {
      this.#repository.create({
        id: accountId,
        userId,
        name,
        type: input.type,
        currencyCode,
        now,
      });

      if (input.type === "credit_card" && input.creditCard !== undefined) {
        this.#repository.upsertCreditCardDetails(accountId, input.creditCard);
      }
    });

    return this.get(userId, accountId);
  }

  update(userId: string, accountId: string, input: UpdateAccountInput): Account {
    const current = this.get(userId, accountId);
    const name = input.name?.trim() ?? current.name;
    const isActive = input.isActive ?? current.isActive;
    const currencyCode = input.currencyCode ?? current.currencyCode;

    if (isActive && (!current.isActive || name !== current.name)) {
      this.#assertUniqueName(userId, name, accountId);
    }

    if (currencyCode !== current.currencyCode && this.#repository.hasTransactions(accountId)) {
      throw new AppError(
        "CONFLICT",
        "Não é possível alterar a moeda de uma conta com transações",
      );
    }

    if (input.creditCard !== undefined && current.type !== "credit_card") {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{
          path: "creditCard",
          message: "Detalhes de cartão só se aplicam ao tipo credit_card",
        }],
      });
    }

    const now = new Date().toISOString();

    this.#db.transaction(() => {
      this.#repository.update({
        id: accountId,
        name,
        currencyCode,
        isActive,
        now,
      });

      if (current.type === "credit_card") {
        const existing = current.creditCard;
        if (!existing) {
          throw new AppError("INTERNAL_ERROR", "Detalhes do cartão ausentes", { expose: false });
        }

        this.#repository.upsertCreditCardDetails(accountId, {
          closingDay: input.creditCard?.closingDay ?? existing.closingDay,
          dueDay: input.creditCard?.dueDay ?? existing.dueDay,
          limitMinor: input.creditCard?.limitMinor ?? existing.limitMinor,
        });
      }
    });

    return this.get(userId, accountId);
  }

  deactivate(userId: string, accountId: string): void {
    this.get(userId, accountId);
    this.#repository.deactivate(accountId, new Date().toISOString());
  }

  balance(userId: string, accountId: string): AccountBalance {
    const account = this.get(userId, accountId);
    return this.#repository.balance(account);
  }

  #assertUniqueName(userId: string, name: string, excludeId?: string): void {
    if (this.#repository.findActiveByName(userId, name, excludeId) !== undefined) {
      throw new AppError("CONFLICT", "Já existe uma conta ativa com esse nome");
    }
  }
}
