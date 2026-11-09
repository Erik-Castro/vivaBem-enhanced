<script lang="ts">
  import { formatMoney, formatShortDate } from "../lib/format";
  import { transactionTypeIcon, transactionTypeLabel } from "../lib/labels";
  import type { Transaction } from "../lib/types";
  import Icon from "./Icon.svelte";

  let {
    transaction,
    onedit,
    ondelete,
    onclear,
  }: {
    transaction: Transaction;
    onedit?: (transaction: Transaction) => void;
    ondelete?: (transaction: Transaction) => void;
    onclear?: (transaction: Transaction) => void;
  } = $props();

  const isIncome = $derived(transaction.type === "income");
  const isTransfer = $derived(transaction.type === "transfer");
  const amountLabel = $derived(
    `${isIncome ? "+" : transaction.type === "expense" ? "−" : ""}${formatMoney(
      transaction.amountMinor,
      transaction.currencyCode,
    )}`,
  );
  const title = $derived(
    transaction.description?.trim() ||
      transaction.categoryName ||
      transactionTypeLabel(transaction.type),
  );
  const subtitle = $derived(
    [
      transaction.categoryName ?? transaction.accountName,
      formatShortDate(transaction.transactionDate),
      transaction.installment
        ? `${transaction.installment.installmentNumber}/${transaction.installment.totalInstallments}`
        : null,
    ]
      .filter((part): part is string => part !== null)
      .join(" · "),
  );
  const hasActions = $derived(
    onedit !== undefined || ondelete !== undefined || onclear !== undefined,
  );
</script>

<div class="tx-row" class:tx-row--actions={hasActions}>
  <span
    class="tx-icon"
    class:tx-icon--income={isIncome}
    class:tx-icon--transfer={isTransfer}
  >
    <Icon name={transactionTypeIcon(transaction.type)} size={18} />
  </span>

  <div class="tx-main">
    <div class="tx-title">
      <strong>{title}</strong>
      {#if !transaction.isCleared}<span class="badge badge--pending">pendente</span>{/if}
    </div>
    <span class="tx-meta">{subtitle}</span>
  </div>

  <span class="tx-amount" class:tx-amount--income={isIncome} class:tx-amount--transfer={isTransfer}>
    {amountLabel}
  </span>

  {#if hasActions}
    <div class="tx-actions">
      {#if onclear && !transaction.isCleared}
        <button
          class="btn btn--icon btn--ghost btn--sm"
          type="button"
          title="Marcar como compensada"
          aria-label="Marcar como compensada"
          onclick={() => onclear(transaction)}
        >
          <Icon name="check" size={16} />
        </button>
      {/if}
      {#if onedit}
        <button
          class="btn btn--icon btn--ghost btn--sm"
          type="button"
          title="Editar"
          aria-label="Editar transação"
          onclick={() => onedit(transaction)}
        >
          <Icon name="edit" size={16} />
        </button>
      {/if}
      {#if ondelete}
        <button
          class="btn btn--icon btn--ghost btn--sm btn--danger-ghost"
          type="button"
          title="Remover"
          aria-label="Remover transação"
          onclick={() => ondelete(transaction)}
        >
          <Icon name="trash" size={16} />
        </button>
      {/if}
    </div>
  {/if}
</div>
