import type { IconName } from "./icons";
import type {
  AccountType,
  AchievementCategory,
  CategoryNode,
  CategoryType,
  Habit,
  HabitFrequencyType,
  HabitType,
  InvestmentOperationType,
  NotificationCategory,
  NotificationSeverity,
  TransactionType,
} from "./types";

export const accountTypeOptions: readonly {
  readonly value: AccountType;
  readonly label: string;
  readonly icon: IconName;
}[] = [
  { value: "checking", label: "Conta corrente", icon: "bank" },
  { value: "savings", label: "Poupança", icon: "piggy" },
  { value: "credit_card", label: "Cartão de crédito", icon: "card" },
  { value: "investment", label: "Investimento", icon: "chart" },
  { value: "cash", label: "Dinheiro", icon: "cash" },
];

export function accountTypeLabel(type: AccountType): string {
  return accountTypeOptions.find((option) => option.value === type)?.label ?? type;
}

export function accountTypeIcon(type: AccountType): IconName {
  return accountTypeOptions.find((option) => option.value === type)?.icon ?? "wallet";
}

export function categoryTypeLabel(type: CategoryType): string {
  if (type === "income") return "Receita";
  if (type === "expense") return "Despesa";
  return "Transferência";
}

export function transactionTypeLabel(type: TransactionType): string {
  if (type === "income") return "Receita";
  if (type === "expense") return "Despesa";
  return "Transferência";
}

export function transactionTypeIcon(type: TransactionType): IconName {
  if (type === "income") return "arrowLeft";
  if (type === "expense") return "arrowRight";
  return "arrows";
}

export const currencyOptions = [
  { value: "BRL", label: "Real (BRL)" },
  { value: "USD", label: "Dólar (USD)" },
  { value: "EUR", label: "Euro (EUR)" },
] as const;

export const localeOptions = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "en-US", label: "English (US)" },
] as const;

export const timezoneOptions = [
  { value: "America/Sao_Paulo", label: "São Paulo (GMT-3)" },
  { value: "America/Manaus", label: "Manaus (GMT-4)" },
  { value: "America/Belem", label: "Belém (GMT-3)" },
  { value: "America/Fortaleza", label: "Fortaleza (GMT-3)" },
  { value: "America/Recife", label: "Recife (GMT-3)" },
  { value: "America/Cuiaba", label: "Cuiabá (GMT-4)" },
  { value: "America/Porto_Velho", label: "Porto Velho (GMT-4)" },
  { value: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
  { value: "UTC", label: "UTC" },
] as const;

export interface FlatCategory {
  readonly category: CategoryNode;
  readonly depth: number;
}

/** Achata a árvore preservando a ordem de exibição e a profundidade. */
export function flattenCategoryTree(
  nodes: readonly CategoryNode[],
  depth = 0,
): FlatCategory[] {
  const result: FlatCategory[] = [];

  for (const node of nodes) {
    result.push({ category: node, depth });
    result.push(...flattenCategoryTree(node.children, depth + 1));
  }

  return result;
}

/** Retorna o id do nó e de todos os seus descendentes. */
export function subtreeIds(nodes: readonly CategoryNode[], id: string): Set<string> {
  const result = new Set<string>();

  function visit(node: CategoryNode): boolean {
    if (node.id === id) {
      collect(node);
      return true;
    }

    return node.children.some(visit);
  }

  function collect(node: CategoryNode): void {
    result.add(node.id);

    for (const child of node.children) {
      collect(child);
    }
  }

  for (const node of nodes) {
    if (visit(node)) break;
  }

  return result;
}

/** Versão para lista plana: inclui o id e todos os descendentes. */
export function descendantIds(
  categories: readonly { id: string; parentId: string | null }[],
  id: string,
): Set<string> {
  const result = new Set<string>([id]);
  let changed = true;

  while (changed) {
    changed = false;

    for (const category of categories) {
      if (
        category.parentId !== null &&
        result.has(category.parentId) &&
        !result.has(category.id)
      ) {
        result.add(category.id);
        changed = true;
      }
    }
  }

  return result;
}

export const habitTypeOptions: readonly {
  readonly value: HabitType;
  readonly label: string;
}[] = [
  { value: "good", label: "Hábito bom" },
  { value: "bad", label: "Hábito ruim" },
];

export const habitFrequencyOptions: readonly {
  readonly value: HabitFrequencyType;
  readonly label: string;
}[] = [
  { value: "daily", label: "Diário" },
  { value: "weekly", label: "Semanal" },
  { value: "custom", label: "Personalizado" },
];

export const weekdayOptions: readonly {
  readonly value: number;
  readonly short: string;
  readonly label: string;
}[] = [
  { value: 1, short: "Seg", label: "Segunda-feira" },
  { value: 2, short: "Ter", label: "Terça-feira" },
  { value: 3, short: "Qua", label: "Quarta-feira" },
  { value: 4, short: "Qui", label: "Quinta-feira" },
  { value: 5, short: "Sex", label: "Sexta-feira" },
  { value: 6, short: "Sáb", label: "Sábado" },
  { value: 7, short: "Dom", label: "Domingo" },
];

export function habitTypeLabel(type: HabitType): string {
  return habitTypeOptions.find((option) => option.value === type)?.label ?? type;
}

export function habitFrequencyLabel(type: HabitFrequencyType): string {
  return habitFrequencyOptions.find((option) => option.value === type)?.label ?? type;
}

/** Resumo legível da agenda: "Diário" ou "Seg, Qua e Sex". */
export function habitScheduleLabel(habit: Pick<Habit, "frequencyType" | "daysOfWeek">): string {
  if (habit.frequencyType === "daily") return "Diário";

  const days = weekdayOptions
    .filter((option) => habit.daysOfWeek.includes(option.value))
    .map((option) => option.short);

  return days.length === 0 ? "Sem dias definidos" : days.join(", ");
}

/** Frequência já com os dias: "Diário" ou "Personalizado · Seg, Qua, Sex". */
export function habitRecurrenceLabel(habit: Pick<Habit, "frequencyType" | "daysOfWeek">): string {
  if (habit.frequencyType === "daily") return "Diário";
  return `${habitFrequencyLabel(habit.frequencyType)} · ${habitScheduleLabel(habit)}`;
}

export const investmentOperationOptions: readonly {
  readonly value: InvestmentOperationType;
  readonly label: string;
}[] = [
  { value: "buy", label: "Compra" },
  { value: "sell", label: "Venda" },
  { value: "dividend", label: "Dividendo" },
  { value: "fee", label: "Taxa" },
];

export function investmentOperationLabel(type: InvestmentOperationType): string {
  return investmentOperationOptions.find((option) => option.value === type)?.label ?? type;
}

/** Sugestões de classe de ativo; a API aceita qualquer texto. */
export const assetClassSuggestions: readonly string[] = [
  "Ações",
  "FIIs",
  "ETFs",
  "Renda fixa",
  "Cripto",
  "Fundos",
  "Previdência",
  "Outros",
];

export const achievementCategoryOptions: readonly {
  readonly value: AchievementCategory;
  readonly label: string;
  readonly icon: IconName;
}[] = [
  { value: "finance", label: "Finanças", icon: "wallet" },
  { value: "habit", label: "Hábitos", icon: "heart" },
  { value: "investment", label: "Investimentos", icon: "piggy" },
  { value: "system", label: "Sistema", icon: "sparkles" },
];

export function achievementCategoryLabel(category: AchievementCategory): string {
  return (
    achievementCategoryOptions.find((option) => option.value === category)?.label ??
    category
  );
}

export function achievementCategoryIcon(category: AchievementCategory): IconName {
  return (
    achievementCategoryOptions.find((option) => option.value === category)?.icon ??
    "trophy"
  );
}

export const notificationCategoryOptions: readonly {
  readonly value: NotificationCategory;
  readonly label: string;
  readonly icon: IconName;
}[] = [
  { value: "finance", label: "Finanças", icon: "wallet" },
  { value: "habit", label: "Hábitos", icon: "heart" },
  { value: "security", label: "Segurança", icon: "lock" },
  { value: "system", label: "Sistema", icon: "sparkles" },
  { value: "investment", label: "Investimentos", icon: "piggy" },
  { value: "family", label: "Família", icon: "users" },
];

export function notificationCategoryLabel(category: NotificationCategory): string {
  return (
    notificationCategoryOptions.find((option) => option.value === category)?.label ??
    category
  );
}

export function notificationCategoryIcon(category: NotificationCategory): IconName {
  return (
    notificationCategoryOptions.find((option) => option.value === category)?.icon ??
    "bell"
  );
}

const notificationSeverityLabels: Readonly<Record<NotificationSeverity, string>> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  critical: "Crítica",
};

export function notificationSeverityLabel(severity: NotificationSeverity): string {
  return notificationSeverityLabels[severity];
}
