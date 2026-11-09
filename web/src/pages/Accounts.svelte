<script lang="ts">
  import { onMount } from "svelte";
  import AccountFormModal from "../components/AccountFormModal.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Icon from "../components/Icon.svelte";
  import { api, errorMessage } from "../lib/api";
  import { formatMoney } from "../lib/format";
  import { accountTypeIcon, accountTypeLabel } from "../lib/labels";
  import { toasts } from "../lib/toast.svelte";
  import type { Account, AccountBalance } from "../lib/types";

  let accounts = $state<Account[]>([]);
  let balances = $state<Record<string, AccountBalance>>({});
  let loading = $state(true);
  let error = $state<string | null>(null);
  let modalOpen = $state(false);
  let editing = $state<Account | null>(null);
  let toggling = $state<string | null>(null);

  const activeCount = $derived(accounts.filter((account) => account.isActive).length);

  async function load(): Promise<void> {
    loading = true;
    error = null;

    try {
      const payload = await api<{ accounts: Account[] }>("/accounts", {
        query: { includeInactive: true },
      });

      accounts = payload.accounts;

      const entries = await Promise.all(
        payload.accounts.map(async (account) => {
          try {
            const result = await api<{ balance: AccountBalance }>(
              `/accounts/${account.id}/balance`,
            );
            return [account.id, result.balance] as const;
          } catch {
            return null;
          }
        }),
      );

      const next: Record<string, AccountBalance> = {};

      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }

      balances = next;
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  function openCreate(): void {
    editing = null;
    modalOpen = true;
  }

  function openEdit(account: Account): void {
    editing = account;
    modalOpen = true;
  }

  async function toggleActive(account: Account): Promise<void> {
    const nextState = !account.isActive;
    const question = nextState
      ? `Reativar a conta "${account.name}"?`
      : `Desativar a conta "${account.name}"? Ela deixa de aparecer em novos lançamentos.`;

    if (!window.confirm(question)) return;

    toggling = account.id;

    try {
      await api(`/accounts/${account.id}`, {
        method: "PATCH",
        body: { isActive: nextState },
      });
      toasts.success(nextState ? "Conta reativada" : "Conta desativada");
      await load();
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      toggling = null;
    }
  }

  onMount(load);
</script>

<div class="page-head">
  <div>
    <p class="eyebrow">Patrimônio</p>
    <h2>Suas contas</h2>
    <p class="page-subtitle">
      {activeCount} ativa(s) de {accounts.length} conta(s) cadastrada(s).
    </p>
  </div>
  <div class="page-actions">
    <button class="btn btn--primary" type="button" onclick={openCreate}>
      <Icon name="plus" size={18} />
      Nova conta
    </button>
  </div>
</div>

{#if loading}
  <div class="grid grid--cards">
    {#each [1, 2, 3] as item}
      <div class="card skeleton-card" aria-hidden="true">
        <span class="skeleton skeleton--title"></span>
        <span class="skeleton skeleton--value"></span>
        <span class="skeleton skeleton--text"></span>
      </div>
    {/each}
  </div>
{:else if error}
  <div class="notice notice--error" role="alert">
    <Icon name="alert" />
    <div>
      <strong>Não foi possível carregar as contas</strong>
      <p>{error}</p>
    </div>
    <button class="btn btn--soft" type="button" onclick={load}>Tentar novamente</button>
  </div>
{:else if accounts.length === 0}
  <div class="card">
    <EmptyState
      icon="wallet"
      title="Nenhuma conta cadastrada"
      description="Comece com a conta onde seu dinheiro realmente passa."
    >
      {#snippet action()}
        <button class="btn btn--primary" type="button" onclick={openCreate}>Criar conta</button>
      {/snippet}
    </EmptyState>
  </div>
{:else}
  <div class="grid grid--cards">
    {#each accounts as account (account.id)}
      {@const balance = balances[account.id]}
      <article class="card account-card" class:account-card--inactive={!account.isActive}>
        <header class="account-card__head">
          <span class="account-icon">
            <Icon name={accountTypeIcon(account.type)} />
          </span>
          <div class="account-card__title">
            <h3>{account.name}</h3>
            <span class="muted">{accountTypeLabel(account.type)} · {account.currencyCode}</span>
          </div>
          <span class="badge" class:badge--active={account.isActive} class:badge--inactive={!account.isActive}>
            {account.isActive ? "ativa" : "inativa"}
          </span>
        </header>

        <div class="account-card__balance">
          <span class="stat__label">Saldo</span>
          <strong
            class:negative={balance !== undefined && balance.balanceMinor < 0}
          >
            {balance ? formatMoney(balance.balanceMinor, balance.currencyCode) : "—"}
          </strong>
        </div>

        <dl class="account-card__meta">
          <div>
            <dt>Compensado</dt>
            <dd>{balance ? formatMoney(balance.clearedBalanceMinor, balance.currencyCode) : "—"}</dd>
          </div>
          <div>
            <dt>Transações</dt>
            <dd>{balance?.transactionCount ?? 0}</dd>
          </div>
          {#if balance?.availableCreditMinor !== null && balance?.availableCreditMinor !== undefined}
            <div>
              <dt>Limite disponível</dt>
              <dd>{formatMoney(balance.availableCreditMinor, balance.currencyCode)}</dd>
            </div>
          {/if}
        </dl>

        {#if account.creditCard}
          <p class="account-card__card-info">
            Fecha dia {account.creditCard.closingDay} · Vence dia {account.creditCard.dueDay} ·
            Limite {formatMoney(account.creditCard.limitMinor, account.currencyCode)}
          </p>
        {/if}

        <footer class="account-card__actions">
          <button class="btn btn--soft btn--sm" type="button" onclick={() => openEdit(account)}>
            <Icon name="edit" size={16} />
            Editar
          </button>
          <button
            class="btn btn--ghost btn--sm"
            type="button"
            disabled={toggling === account.id}
            onclick={() => toggleActive(account)}
          >
            {account.isActive ? "Desativar" : "Reativar"}
          </button>
        </footer>
      </article>
    {/each}
  </div>
{/if}

<AccountFormModal
  open={modalOpen}
  account={editing}
  onclose={() => (modalOpen = false)}
  onsaved={() => void load()}
/>
