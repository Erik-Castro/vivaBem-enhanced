<script lang="ts">
  import { onMount } from "svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Icon from "../components/Icon.svelte";
  import TransactionRow from "../components/TransactionRow.svelte";
  import { api, errorMessage } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { firstName, formatMoney, monthLabel, monthRange } from "../lib/format";
  import type {
    Account,
    AccountBalance,
    Transaction,
    TransactionSummary,
  } from "../lib/types";

  let loading = $state(true);
  let error = $state<string | null>(null);
  let accounts = $state<Account[]>([]);
  let balances = $state<Record<string, AccountBalance>>({});
  let recent = $state<Transaction[]>([]);
  let summary = $state<TransactionSummary | null>(null);

  const range = monthRange();
  const greeting = $derived.by(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Bom dia";
    if (hour < 18) return "Boa tarde";
    return "Boa noite";
  });
  const baseCurrency = $derived(auth.user?.preferences.baseCurrency ?? "BRL");
  const selectedCurrency = $derived(
    summary?.currencies.find((entry) => entry.currencyCode === baseCurrency) ??
      summary?.currencies[0] ??
      null,
  );
  const activeAccounts = $derived(accounts.filter((account) => account.isActive));
  const totals = $derived.by(() => {
    const byCurrency = new Map<string, number>();

    for (const balance of Object.values(balances)) {
      byCurrency.set(
        balance.currencyCode,
        (byCurrency.get(balance.currencyCode) ?? 0) + balance.balanceMinor,
      );
    }

    return [...byCurrency.entries()].map(([currencyCode, amountMinor]) => ({
      currencyCode,
      amountMinor,
    }));
  });
  const topCategories = $derived(
    (selectedCurrency?.byCategory ?? [])
      .filter((entry) => entry.type === "expense" && entry.amountMinor > 0)
      .slice(0, 5),
  );
  const maxCategory = $derived(
    Math.max(1, ...topCategories.map((entry) => entry.amountMinor)),
  );

  async function load(): Promise<void> {
    loading = true;
    error = null;

    try {
      const [accountsPayload, transactionsPayload, summaryPayload] = await Promise.all([
        api<{ accounts: Account[] }>("/accounts"),
        api<{ transactions: Transaction[] }>("/transactions", {
          query: { limit: 6, offset: 0 },
        }),
        api<TransactionSummary>("/transactions/summary", { query: range }),
      ]);

      accounts = accountsPayload.accounts;
      recent = transactionsPayload.transactions;
      summary = summaryPayload;

      const balanceEntries = await Promise.all(
        accounts
          .filter((account) => account.isActive)
          .map(async (account) => {
            const payload = await api<{ balance: AccountBalance }>(
              `/accounts/${account.id}/balance`,
            );
            return [account.id, payload.balance] as const;
          }),
      );

      balances = Object.fromEntries(balanceEntries);
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<div class="page-head">
  <div>
    <p class="eyebrow">{greeting}, {firstName(auth.user?.name ?? "")}</p>
    <h2>{monthLabel()}</h2>
    <p class="page-subtitle">Uma visão rápida do seu dinheiro neste mês.</p>
  </div>
  <div class="page-actions">
    <button class="btn btn--ghost" type="button" onclick={load} disabled={loading}>
      <Icon name="refresh" size={18} />
      Atualizar
    </button>
    <a class="btn btn--primary" href="#/transactions">
      <Icon name="plus" size={18} />
      Nova transação
    </a>
  </div>
</div>

{#if loading}
  <div class="grid grid--stats">
    {#each [1, 2, 3, 4] as item}
      <div class="stat skeleton-card" aria-hidden="true">
        <span class="skeleton skeleton--text"></span>
        <span class="skeleton skeleton--value"></span>
        <span class="skeleton skeleton--text"></span>
      </div>
    {/each}
  </div>
  <div class="grid grid--main">
    <div class="card skeleton-card" aria-hidden="true">
      <span class="skeleton skeleton--title"></span>
      <span class="skeleton skeleton--row"></span>
      <span class="skeleton skeleton--row"></span>
      <span class="skeleton skeleton--row"></span>
    </div>
    <div class="card skeleton-card" aria-hidden="true">
      <span class="skeleton skeleton--title"></span>
      <span class="skeleton skeleton--row"></span>
      <span class="skeleton skeleton--row"></span>
    </div>
  </div>
{:else if error}
  <div class="notice notice--error" role="alert">
    <Icon name="alert" />
    <div>
      <strong>Não foi possível carregar o painel</strong>
      <p>{error}</p>
    </div>
    <button class="btn btn--soft" type="button" onclick={load}>Tentar novamente</button>
  </div>
{:else if accounts.length === 0}
  <div class="card">
    <EmptyState
      icon="wallet"
      title="Comece pela sua primeira conta"
      description="Cadastre uma conta para registrar transações e acompanhar o resumo do mês."
    >
      {#snippet action()}
        <a class="btn btn--primary" href="#/accounts">Criar conta</a>
      {/snippet}
    </EmptyState>
  </div>
{:else}
  <section class="grid grid--stats" aria-label="Resumo do mês">
    <article class="stat">
      <span class="stat__label">Receitas</span>
      <strong class="stat__value stat__value--income">
        {formatMoney(selectedCurrency?.incomeMinor ?? 0, selectedCurrency?.currencyCode ?? baseCurrency)}
      </strong>
      <span class="stat__hint">Entradas no mês</span>
    </article>

    <article class="stat">
      <span class="stat__label">Despesas</span>
      <strong class="stat__value stat__value--expense">
        {formatMoney(selectedCurrency?.expenseMinor ?? 0, selectedCurrency?.currencyCode ?? baseCurrency)}
      </strong>
      <span class="stat__hint">Saídas no mês</span>
    </article>

    <article class="stat">
      <span class="stat__label">Resultado</span>
      <strong
        class="stat__value"
        class:stat__value--income={(selectedCurrency?.netMinor ?? 0) >= 0}
        class:stat__value--expense={(selectedCurrency?.netMinor ?? 0) < 0}
      >
        {formatMoney(selectedCurrency?.netMinor ?? 0, selectedCurrency?.currencyCode ?? baseCurrency)}
      </strong>
      <span class="stat__hint">Receitas menos despesas</span>
    </article>

    <article class="stat stat--accent">
      <span class="stat__label">Saldo em contas</span>
      {#if totals.length === 0}
        <strong class="stat__value">—</strong>
      {:else}
        <strong class="stat__value">{formatMoney(totals[0]?.amountMinor ?? 0, totals[0]?.currencyCode ?? baseCurrency)}</strong>
      {/if}
      <span class="stat__hint">{activeAccounts.length} conta(s) ativa(s)</span>
    </article>
  </section>

  <div class="grid grid--main">
    <section class="card">
      <header class="card-head">
        <div>
          <h3>Últimas transações</h3>
          <p>O que passou pelo seu dinheiro recentemente.</p>
        </div>
        <a class="btn btn--ghost btn--sm" href="#/transactions">Ver todas</a>
      </header>

      {#if recent.length === 0}
        <EmptyState
          icon="arrows"
          title="Nenhuma transação ainda"
          description="Registre sua primeira receita ou despesa para começar."
        >
          {#snippet action()}
            <a class="btn btn--soft" href="#/transactions">Registrar transação</a>
          {/snippet}
        </EmptyState>
      {:else}
        <div class="tx-list">
          {#each recent as transaction (transaction.id)}
            <TransactionRow {transaction} />
          {/each}
        </div>
      {/if}
    </section>

    <section class="card">
      <header class="card-head">
        <div>
          <h3>Onde mais gastou</h3>
          <p>Top categorias de despesa no mês.</p>
        </div>
      </header>

      {#if topCategories.length === 0}
        <p class="muted">Sem despesas categorizadas neste mês.</p>
      {:else}
        <div class="bar-list">
          {#each topCategories as entry (entry.categoryId ?? entry.categoryName)}
            <div class="bar-row">
              <div class="bar-row__head">
                <span>{entry.categoryName ?? "Sem categoria"}</span>
                <strong>{formatMoney(entry.amountMinor, selectedCurrency?.currencyCode ?? baseCurrency)}</strong>
              </div>
              <div class="bar-track">
                <span
                  class="bar-fill"
                  style:width={`${Math.max(4, Math.round((entry.amountMinor / maxCategory) * 100))}%`}
                ></span>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>

  <section class="card">
    <header class="card-head">
      <div>
        <h3>Saldos por moeda</h3>
        <p>Valores consolidados de todas as contas ativas.</p>
      </div>
      <a class="btn btn--ghost btn--sm" href="#/accounts">Gerenciar contas</a>
    </header>

    {#if totals.length === 0}
      <p class="muted">Nenhum saldo disponível.</p>
    {:else}
      <div class="currency-balances">
        {#each totals as total (total.currencyCode)}
          <div class="currency-balance">
            <span class="currency-balance__code">{total.currencyCode}</span>
            <strong class:negative={total.amountMinor < 0}>
              {formatMoney(total.amountMinor, total.currencyCode)}
            </strong>
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}
