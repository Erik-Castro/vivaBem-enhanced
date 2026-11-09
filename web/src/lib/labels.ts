import type { IconName } from "./icons";
import type { AccountType, CategoryNode, CategoryType, TransactionType } from "./types";

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
