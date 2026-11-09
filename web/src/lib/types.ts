export interface UserPreferences {
  readonly timezone: string;
  readonly baseCurrency: string;
  readonly locale: string;
  readonly aiEnabled: boolean;
}

export interface User {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly avatarUrl: string | null;
  readonly subscriptionTier: "free" | "premium";
  readonly emailVerified: boolean;
  readonly createdAt: string;
  readonly preferences: UserPreferences;
}

export interface AuthPayload {
  readonly user: User;
  readonly csrfToken: string;
}

export interface MePayload {
  readonly user: User;
  readonly stats: { readonly activeSessions: number };
}

export type AccountType = "checking" | "savings" | "credit_card" | "investment" | "cash";

export interface CreditCardDetails {
  readonly closingDay: number;
  readonly dueDay: number;
  readonly limitMinor: number;
}

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currencyCode: string;
  readonly isActive: boolean;
  readonly creditCard: CreditCardDetails | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AccountBalance {
  readonly accountId: string;
  readonly currencyCode: string;
  readonly balanceMinor: number;
  readonly clearedBalanceMinor: number;
  readonly transactionCount: number;
  readonly availableCreditMinor: number | null;
}

export type CategoryType = "income" | "expense" | "transfer";

export interface Category {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly type: CategoryType;
  readonly color: string | null;
  readonly icon: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CategoryNode extends Category {
  readonly children: readonly CategoryNode[];
}

export type TransactionType = "income" | "expense" | "transfer";

export interface Installment {
  readonly installmentNumber: number;
  readonly totalInstallments: number;
  readonly installmentGroupId: string;
}

export interface Transaction {
  readonly id: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly accountType: AccountType;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly transferGroupId: string | null;
  readonly recurringTransactionId: string | null;
  readonly type: TransactionType;
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly description: string | null;
  readonly transactionDate: string;
  readonly isCleared: boolean;
  readonly externalId: string | null;
  readonly importHash: string | null;
  readonly installment: Installment | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CategorySummary {
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly type: "income" | "expense";
  readonly amountMinor: number;
}

export interface CurrencySummary {
  readonly currencyCode: string;
  readonly incomeMinor: number;
  readonly expenseMinor: number;
  readonly netMinor: number;
  readonly byCategory: readonly CategorySummary[];
}

export interface TransactionSummary {
  readonly period: { readonly from: string | null; readonly to: string | null };
  readonly currencies: readonly CurrencySummary[];
}

export type BudgetPeriodType = "monthly" | "yearly" | "custom";

export interface Budget {
  readonly id: string;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly name: string;
  readonly limitMinor: number;
  readonly currencyCode: string;
  readonly periodType: BudgetPeriodType;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly alertThreshold: number;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type BudgetLevel = "ok" | "warning" | "exceeded";

export interface BudgetStatus {
  readonly budget: Budget;
  readonly period: { readonly from: string; readonly to: string };
  readonly spentMinor: number;
  readonly remainingMinor: number;
  readonly percentUsed: number;
  readonly level: BudgetLevel;
  readonly crossedThresholds: readonly number[];
  readonly isPeriodActive: boolean;
}

export type GoalStatus = "active" | "paused" | "completed" | "cancelled";

export interface Goal {
  readonly id: string;
  readonly targetAccountId: string | null;
  readonly targetAccountName: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly targetAmountMinor: number;
  readonly currencyCode: string;
  readonly targetDate: string | null;
  readonly status: GoalStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GoalContribution {
  readonly id: string;
  readonly goalId: string;
  readonly accountId: string | null;
  readonly accountName: string | null;
  readonly transactionId: string | null;
  readonly amountMinor: number;
  readonly contributionDate: string;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface GoalProgress {
  readonly goal: Goal;
  readonly contributions: readonly GoalContribution[];
  readonly contributedMinor: number;
  readonly remainingMinor: number;
  readonly progressPercent: number;
  readonly isCompleted: boolean;
  readonly contributionCount: number;
  readonly lastContributionDate: string | null;
}

export interface Session {
  readonly id: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string;
  readonly current: boolean;
}
