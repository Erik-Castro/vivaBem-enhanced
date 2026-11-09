<script lang="ts">
  import { onMount } from "svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Icon from "../components/Icon.svelte";
  import TransactionFormModal from "../components/TransactionFormModal.svelte";
  import TransactionRow from "../components/TransactionRow.svelte";
  import { api, apiRequest, errorMessage } from "../lib/api";
  import { monthRange } from "../lib/format";
  import { toasts } from "../lib/toast.svelte";
  import type { Account, Category, Transaction } from "../lib/types";

  const PAGE_SIZE = 20;
  const range = monthRange();

  let transactions = $state<Transaction[]>([]);
  let accounts = $state<Account[]>([]);
  let categories = $state<Category[]>([]);
  let loading = $state(true);
  let loadingMore = $state(false);
  let error = $state<string | null>(null);
  let optionsError = $state<string | null>(null);
  let hasMore = $state(false);
  let offset = $state(0);
  let modalOpen = $state(false);
  let editing = $state<Transaction | null>(null);

  let filters = $state({
    accountId: "",
    categoryId: "",
    type: "" as "" | "income" | "expense" | "transfer",
    from: range.from,
    to: range.to,
  });

  const activeAccounts = $derived(accounts.filter((account) => account.isActive));
  const categoryOptions = $derived(
    categories.filter(
      (category) =>
        category.isActive && (filters.type === "" || category.type === filters.type),
    ),
  );
  const hasFilters = $derived(
    filters.accountId !== "" ||
      filters.categoryId !== "" ||
      filters.type !== "" ||
      filters.from !== range.from ||
      filters.to !== range.to,
  );

  async function loadOptions(): Promise<void> {
    optionsError = null;

    try {
      const [accountsPayload, categoriesPayload] = await Promise.all([
        api<{ accounts: Account[] }>("/accounts", { query: { includeInactive: true } }),
        api<{ categories: Category[] }>("/categories", {
          query: { includeInactive: true },
        }),
      ]);

      accounts = accountsPayload.accounts;
      categories = categoriesPayload.categories;
    } catch (cause) {
      optionsError = errorMessage(cause);
    }
  }

  function buildQuery(nextOffset: number): Record<string, string | number> {
    const query: Record<string, string | number> = {
      limit: PAGE_SIZE,
      offset: nextOffset,
    };

    if (filters.accountId !== "") query.accountId = filters.accountId;
    if (filters.categoryId !== "") query.categoryId = filters.categoryId;
    if (filters.type !== "") query.type = filters.type;
    if (filters.from !== "") query.from = filters.from;
    if (filters.to !== "") query.to = filters.to;

    return query;
  }

  async function load(reset = true): Promise<void> {
    if (reset) {
      loading = true;
      error = null;
    } else {
      loadingMore = true;
    }

    try {
      const envelope = await apiRequest<{ transactions: Transaction[] }>("/transactions", {
        query: buildQuery(reset ? 0 : offset),
      });

      if (reset) {
        transactions = envelope.data.transactions;
        offset = envelope.data.transactions.length;
      } else {
        transactions = [...transactions, ...envelope.data.transactions];
        offset += envelope.data.transactions.length;
      }

      hasMore = envelope.meta.hasMore ?? false;
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
      loadingMore = false;
    }
  }

  function openCreate(): void {
    editing = null;
    modalOpen = true;
  }

  function openEdit(transaction: Transaction): void {
    editing = transaction;
    modalOpen = true;
  }

  async function handleClear(transaction: Transaction): Promise<void> {
    try {
      await api(`/transactions/${transaction.id}/clear`, { method: "POST" });
      toasts.success("Transação compensada");
      await load(true);
    } catch (cause) {
      toasts.error(errorMessage(cause));
    }
  }

  async function handleDelete(transaction: Transaction): Promise<void> {
    const extra = transaction.installment
      ? " Todas as parcelas do grupo serão removidas."
      : transaction.transferGroupId
        ? " As duas pernas da transferência serão removidas."
        : "";

    if (!window.confirm(`Remover esta transação?${extra}`)) return;

    try {
      await api(`/transactions/${transaction.id}`, { method: "DELETE" });
      toasts.success("Transação removida");
      await load(true);
    } catch (cause) {
      toasts.error(errorMessage(cause));
    }
  }

  function handleFilter(event: SubmitEvent): void {
    event.preventDefault();
    void load(true);
  }

  function clearFilters(): void {
    filters = { accountId: "", categoryId: "", type: "", from: "", to: "" };
    void load(true);
  }

  onMount(() => {
    void loadOptions();
    void load(true);
  });
</script>

<div class="page-head">
  <div>
    <p class="eyebrow">Movimentações</p>
    <h2>Transações</h2>
    <p class="page-subtitle">
      {transactions.length} transação(ões) carregada(s){hasMore ? ", há mais no período" : ""}.
    </p>
  </div>
  <div class="page-actions">
    <button
      class="btn btn--primary"
      type="button"
      disabled={activeAccounts.length === 0}
      title={activeAccounts.length === 0 ? "Crie uma conta ativa primeiro" : undefined}
      onclick={openCreate}
    >
      <Icon name="plus" size={18} />
      Nova transação
    </button>
  </div>
</div>

{#if optionsError}
  <div class="notice notice--error" role="alert">
    <Icon name="alert" />
    <div>
      <strong>Não foi possível carregar contas e categorias</strong>
      <p>{optionsError}</p>
    </div>
    <button class="btn btn--soft" type="button" onclick={loadOptions}>Tentar novamente</button>
  </div>
{/if}

<form class="filters" onsubmit={handleFilter}>
  <label class="field">
    <span>Conta</span>
    <select class="select" bind:value={filters.accountId}>
      <option value="">Todas as contas</option>
      {#each accounts as account (account.id)}
        <option value={account.id}>{account.name}{account.isActive ? "" : " (inativa)"}</option>
      {/each}
    </select>
  </label>

  <label class="field">
    <span>Categoria</span>
    <select class="select" bind:value={filters.categoryId}>
      <option value="">Todas as categorias</option>
      {#each categoryOptions as category (category.id)}
        <option value={category.id}>{category.name}</option>
      {/each}
    </select>
  </label>

  <label class="field">
    <span>Tipo</span>
    <select class="select" bind:value={filters.type}>
      <option value="">Todos</option>
      <option value="expense">Despesas</option>
      <option value="income">Receitas</option>
      <option value="transfer">Transferências</option>
    </select>
  </label>

  <label class="field">
    <span>De</span>
    <input class="input" type="date" bind:value={filters.from} />
  </label>

  <label class="field">
    <span>Até</span>
    <input class="input" type="date" bind:value={filters.to} />
  </label>

  <div class="filters__actions">
    <button class="btn btn--primary" type="submit" disabled={loading}>
      <Icon name="filter" size={16} />
      Filtrar
    </button>
    {#if hasFilters}
      <button class="btn btn--ghost" type="button" onclick={clearFilters}>Limpar</button>
    {/if}
  </div>
</form>

{#if loading}
  <div class="card skeleton-card" aria-hidden="true">
    <span class="skeleton skeleton--title"></span>
    <span class="skeleton skeleton--row"></span>
    <span class="skeleton skeleton--row"></span>
    <span class="skeleton skeleton--row"></span>
    <span class="skeleton skeleton--row"></span>
  </div>
{:else if error}
  <div class="notice notice--error" role="alert">
    <Icon name="alert" />
    <div>
      <strong>Não foi possível carregar as transações</strong>
      <p>{error}</p>
    </div>
    <button class="btn btn--soft" type="button" onclick={() => load(true)}>Tentar novamente</button>
  </div>
{:else if transactions.length === 0}
  <div class="card">
    <EmptyState
      icon="arrows"
      title="Nenhuma transação encontrada"
      description={hasFilters
        ? "Tente ampliar o período ou remover os filtros."
        : "Registre uma receita ou despesa para começar a acompanhar seu dinheiro."}
    >
      {#snippet action()}
        {#if hasFilters}
          <button class="btn btn--soft" type="button" onclick={clearFilters}>Limpar filtros</button>
        {:else if activeAccounts.length > 0}
          <button class="btn btn--primary" type="button" onclick={openCreate}>
            Registrar transação
          </button>
        {:else}
          <a class="btn btn--primary" href="#/accounts">Criar conta</a>
        {/if}
      {/snippet}
    </EmptyState>
  </div>
{:else}
  <div class="card card--flush">
    <div class="tx-list">
      {#each transactions as transaction (transaction.id)}
        <TransactionRow
          {transaction}
          onedit={openEdit}
          onclear={handleClear}
          ondelete={handleDelete}
        />
      {/each}
    </div>

    {#if hasMore}
      <div class="load-more">
        <button class="btn btn--soft" type="button" disabled={loadingMore} onclick={() => load(false)}>
          {#if loadingMore}
            Carregando…
          {:else}
            Carregar mais
          {/if}
        </button>
      </div>
    {/if}
  </div>
{/if}

<TransactionFormModal
  open={modalOpen}
  transaction={editing}
  {accounts}
  {categories}
  onclose={() => (modalOpen = false)}
  onsaved={() => void load(true)}
/>
