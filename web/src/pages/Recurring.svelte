<script lang="ts">
  import { onMount } from "svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Icon from "../components/Icon.svelte";
  import RecurringFormModal from "../components/RecurringFormModal.svelte";
  import { api, errorMessage } from "../lib/api";
    import { formatDate, formatMoney } from "../lib/format";
  import { recurringFrequencyLabel, recurringTypeLabel } from "../lib/labels";
  import { toasts } from "../lib/toast.svelte";
  import type {
    Account,
    Category,
    Recurring,
    Transaction,
    UpcomingOccurrence,
  } from "../lib/types";

  let recurrings = $state<Recurring[]>([]);
  let upcoming = $state<UpcomingOccurrence[]>([]);
  let accounts = $state<Account[]>([]);
  let categories = $state<Category[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showInactive = $state(false);
  let upcomingDays = $state(30);
  let modalOpen = $state(false);
  let editing = $state<Recurring | null>(null);
  let busyId = $state<string | null>(null);

  const activeAccounts = $derived(accounts.filter((account) => account.isActive));
  const canCreate = $derived(activeAccounts.length > 0);
  const accountNames = $derived(
    new Map(accounts.map((account) => [account.id, account.name] as const)),
  );
  const ordered = $derived.by(() =>
    [...recurrings].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.nextOccurrence.localeCompare(b.nextOccurrence);
    }),
  );
  const activeCount = $derived(recurrings.filter((item) => item.isActive).length);

  function titleOf(recurring: Recurring): string {
    return recurring.description ?? recurring.categoryName ?? "Recorrência";
  }

  function dayParts(iso: string): { day: string; month: string } {
    const date = new Date(`${iso}T00:00:00`);

    return {
      day: new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(date),
      month: new Intl.DateTimeFormat("pt-BR", { month: "short" })
        .format(date)
        .replace(".", ""),
    };
  }

  async function load(): Promise<void> {
    loading = true;
    error = null;

    try {
      const [recurringsPayload, upcomingPayload, accountsPayload, categoriesPayload] = await Promise.all([
        api<{ recurrings: Recurring[] }>("/recurring", {
          query: { includeInactive: showInactive },
        }),
        api<{ occurrences: UpcomingOccurrence[] }>("/recurring/upcoming", {
          query: { days: upcomingDays, limit: 20 },
        }),
        api<{ accounts: Account[] }>("/accounts"),
        api<{ categories: Category[] }>("/categories", { query: { includeInactive: true } }),
      ]);

      recurrings = recurringsPayload.recurrings;
      upcoming = upcomingPayload.occurrences;
      accounts = accountsPayload.accounts;
      categories = categoriesPayload.categories;
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

  function openEdit(recurring: Recurring): void {
    editing = recurring;
    modalOpen = true;
  }

  async function runNow(recurring: Recurring): Promise<void> {
    if (busyId !== null) return;

    if (!window.confirm(`Registrar agora a próxima ocorrência de "${titleOf(recurring)}"?`)) {
      return;
    }

    busyId = recurring.id;

    try {
      const result = await api<{ recurring: Recurring; transaction: Transaction }>(
        `/recurring/${recurring.id}/run-now`,
        { method: "POST" },
      );

      toasts.success(
        `Ocorrência registrada em ${formatDate(result.transaction.transactionDate)}`,
      );
      await load();
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      busyId = null;
    }
  }

  async function toggleActive(recurring: Recurring): Promise<void> {
    if (busyId !== null) return;

    const nextState = !recurring.isActive;
    const question = nextState
      ? `Reativar a recorrência "${titleOf(recurring)}"?`
      : `Pausar a recorrência "${titleOf(recurring)}"? O histórico é preservado.`;

    if (!window.confirm(question)) return;

    busyId = recurring.id;

    try {
      if (nextState) {
        await api(`/recurring/${recurring.id}`, {
          method: "PATCH",
          body: { isActive: true },
        });
        toasts.success("Recorrência reativada");
      } else {
        await api(`/recurring/${recurring.id}`, { method: "DELETE" });
        // Mantém a linha visível para permitir reativar sem caçar o filtro.
        showInactive = true;
        toasts.success("Recorrência pausada");
      }

      await load();
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      busyId = null;
    }
  }

  onMount(load);
</script>

<div class="page-head">
  <div>
    <p class="eyebrow">Planejamento</p>
    <h2>Recorrências</h2>
    <p class="page-subtitle">
      Automatize lançamentos fixos e acompanhe as próximas ocorrências previstas.
    </p>
  </div>
  <div class="page-actions">
    <button
      class="btn btn--primary"
      type="button"
      disabled={!canCreate}
      title={canCreate ? undefined : "Crie uma conta ativa primeiro"}
      onclick={openCreate}
    >
      <Icon name="plus" size={18} />
      Nova recorrência
    </button>
  </div>
</div>

<div class="toolbar">
  <label class="field toolbar__field">
    <span>Próximas ocorrências</span>
    <select class="select" bind:value={upcomingDays} onchange={() => void load()}>
      <option value={30}>Próximos 30 dias</option>
      <option value={60}>Próximos 60 dias</option>
      <option value={90}>Próximos 90 dias</option>
    </select>
  </label>

  <div class="toolbar__actions">
    <label class="checkbox">
      <input type="checkbox" bind:checked={showInactive} onchange={() => void load()} />
      <span>Mostrar pausadas</span>
    </label>

    <button class="btn btn--ghost btn--sm" type="button" onclick={() => void load()}>
      <Icon name="refresh" size={16} />
      Atualizar
    </button>
  </div>
</div>

{#if loading}
  <div class="card skeleton-card" aria-hidden="true">
    <span class="skeleton skeleton--title"></span>
    <span class="skeleton skeleton--row"></span>
    <span class="skeleton skeleton--row"></span>
  </div>
  <div class="card skeleton-card" aria-hidden="true">
    <span class="skeleton skeleton--title"></span>
    <span class="skeleton skeleton--row"></span>
  </div>
{:else if error}
  <div class="notice notice--error" role="alert">
    <Icon name="alert" />
    <div>
      <strong>Não foi possível carregar as recorrências</strong>
      <p>{error}</p>
    </div>
    <button class="btn btn--soft" type="button" onclick={() => void load()}>
      Tentar novamente
    </button>
  </div>
{:else}
  {#if activeAccounts.length === 0}
    <div class="notice">
      <Icon name="info" />
      <div>
        <strong>Nenhuma conta ativa</strong>
        <p>Recorrências precisam de uma conta ativa. Crie ou reative uma conta primeiro.</p>
      </div>
      <a class="btn btn--soft" href="#/accounts">Ir para contas</a>
    </div>
  {/if}

  <section class="card card--flush" aria-label="Próximas ocorrências">
    <div class="card-head card-head--flush">
      <div>
        <h3>Próximas ocorrências</h3>
        <p>Projeção das recorrências ativas para os próximos {upcomingDays} dias.</p>
      </div>
      <span class="badge badge--inactive">{upcoming.length} prevista(s)</span>
    </div>

    {#if upcoming.length === 0}
      <div class="card-empty">
        <p class="muted">Nenhuma ocorrência prevista no período.</p>
      </div>
    {:else}
      <div class="tx-list">
        {#each upcoming as occurrence (occurrence.recurringId + occurrence.occurrenceDate)}
          {@const parts = dayParts(occurrence.occurrenceDate)}
          <div class="tx-row">
            <span class="recurring-date" aria-hidden="true">
              <span class="recurring-date__day">{parts.day}</span>
              <span class="recurring-date__month">{parts.month}</span>
            </span>
            <div class="tx-main">
              <div class="tx-title">
                <strong>{occurrence.description ?? "Ocorrência recorrente"}</strong>
              </div>
              <span class="tx-meta">
                {accountNames.get(occurrence.accountId) ?? "Conta"} · {formatDate(
                  occurrence.occurrenceDate,
                )}
              </span>
            </div>
            <span
              class="tx-amount"
              class:tx-amount--income={occurrence.type === "income"}
            >
              {occurrence.type === "income" ? "+" : "−"}{formatMoney(
                occurrence.amountMinor,
                occurrence.currencyCode,
              )}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="card card--flush" aria-label="Recorrências cadastradas">
    <div class="card-head card-head--flush">
      <div>
        <h3>Cadastradas</h3>
        <p>{activeCount} ativa(s) de {recurrings.length} no total.</p>
      </div>
    </div>

    {#if ordered.length === 0}
      <EmptyState
        icon="repeat"
        title="Nenhuma recorrência"
        description="Cadastre contas fixas como aluguel, assinaturas e salário para lançar automaticamente."
      >
        {#snippet action()}
          <button
            class="btn btn--primary"
            type="button"
            disabled={!canCreate}
            onclick={openCreate}
          >
            Criar recorrência
          </button>
        {/snippet}
      </EmptyState>
    {:else}
      <div class="tx-list">
        {#each ordered as recurring (recurring.id)}
          <div class="tx-row" class:recurring-row--inactive={!recurring.isActive}>
            <span
              class="tx-icon"
              class:tx-icon--income={recurring.type === "income"}
              aria-hidden="true"
            >
              <Icon name="repeat" size={18} />
            </span>

            <div class="tx-main">
              <div class="tx-title">
                <strong>{titleOf(recurring)}</strong>
                <span class="badge badge--inactive">{recurringTypeLabel(recurring.type)}</span>
                {#if !recurring.isActive}
                  <span class="badge badge--pending">Pausada</span>
                {/if}
              </div>
              <span class="tx-meta">
                {recurring.accountName} · {recurring.categoryName ?? "Sem categoria"} · {recurringFrequencyLabel(
                  recurring.frequency,
                  recurring.interval,
                )}
              </span>
              <span class="tx-meta">
                {recurring.isActive ? "Próxima" : "Última prevista"}: {formatDate(
                  recurring.nextOccurrence,
                )}{#if recurring.endDate} · termina em {formatDate(recurring.endDate)}{/if}
              </span>
            </div>

            <span class="tx-amount" class:tx-amount--income={recurring.type === "income"}>
              {recurring.type === "income" ? "+" : "−"}{formatMoney(
                recurring.amountMinor,
                recurring.currencyCode,
              )}
            </span>

            <div class="tx-actions">
              <button
                class="btn btn--icon btn--ghost btn--sm"
                type="button"
                title="Executar agora"
                aria-label={`Executar agora ${titleOf(recurring)}`}
                disabled={!recurring.isActive || busyId !== null}
                onclick={() => void runNow(recurring)}
              >
                <Icon name="play" size={16} />
              </button>
              <button
                class="btn btn--icon btn--ghost btn--sm"
                type="button"
                title="Editar"
                aria-label={`Editar ${titleOf(recurring)}`}
                onclick={() => openEdit(recurring)}
              >
                <Icon name="edit" size={16} />
              </button>
              <button
                class="btn btn--icon btn--ghost btn--sm"
                type="button"
                title={recurring.isActive ? "Pausar" : "Reativar"}
                aria-label={`${recurring.isActive ? "Pausar" : "Reativar"} ${titleOf(recurring)}`}
                disabled={busyId !== null}
                onclick={() => void toggleActive(recurring)}
              >
                <Icon name={recurring.isActive ? "pause" : "refresh"} size={16} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<RecurringFormModal
  open={modalOpen}
  recurring={editing}
  accounts={activeAccounts}
  {categories}
  onclose={() => (modalOpen = false)}
  onsaved={() => void load()}
/>
