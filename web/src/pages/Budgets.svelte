<script lang="ts">
  import { onMount } from "svelte";
  import BudgetFormModal from "../components/BudgetFormModal.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Icon from "../components/Icon.svelte";
  import { api, errorMessage } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { formatDate, formatMoney, todayISO } from "../lib/format";
  import { toasts } from "../lib/toast.svelte";
  import type { Budget, BudgetLevel, BudgetStatus, Category } from "../lib/types";

  let statuses = $state<BudgetStatus[]>([]);
  let categories = $state<Category[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let referenceMonth = $state(todayISO().slice(0, 7));
  let showInactive = $state(false);
  let modalOpen = $state(false);
  let editing = $state<Budget | null>(null);
  let toggling = $state<string | null>(null);

  const baseCurrency = $derived(auth.user?.preferences.baseCurrency ?? "BRL");
  const ordered = $derived.by(() =>
    [...statuses].sort((a, b) => {
      if (a.budget.isActive !== b.budget.isActive) return a.budget.isActive ? -1 : 1;
      return a.budget.name.localeCompare(b.budget.name, "pt-BR");
    }),
  );
  const totals = $derived.by(() => {
    const byCurrency = new Map<
      string,
      { limitMinor: number; spentMinor: number; remainingMinor: number; count: number }
    >();

    for (const status of statuses) {
      if (!status.budget.isActive) continue;

      const current = byCurrency.get(status.budget.currencyCode) ?? {
        limitMinor: 0,
        spentMinor: 0,
        remainingMinor: 0,
        count: 0,
      };

      current.limitMinor += status.budget.limitMinor;
      current.spentMinor += status.spentMinor;
      current.remainingMinor += status.remainingMinor;
      current.count += 1;
      byCurrency.set(status.budget.currencyCode, current);
    }

    return [...byCurrency.entries()].map(([currencyCode, values]) => ({
      currencyCode,
      ...values,
    }));
  });

  function periodLabel(budget: Budget): string {
    if (budget.periodType === "monthly") return "Mensal";
    if (budget.periodType === "yearly") return "Anual";
    if (budget.endDate === null) return `Desde ${formatDate(budget.startDate)}`;
    return `${formatDate(budget.startDate)} – ${formatDate(budget.endDate)}`;
  }

  function levelLabel(level: BudgetLevel): string {
    if (level === "exceeded") return "Estourado";
    if (level === "warning") return "Atenção";
    return "Dentro do limite";
  }

  function levelClass(level: BudgetLevel): string {
    if (level === "exceeded") return "badge badge--danger";
    if (level === "warning") return "badge badge--warning";
    return "badge badge--active";
  }

  function progressWidth(percentUsed: number): string {
    return `${Math.min(100, Math.max(3, Math.round(percentUsed)))}%`;
  }

  /**
   * A API avalia o status na data de referência. O último dia do mês garante
   * que um orçamento iniciado no meio do mês já apareça ativo no período.
   */
  function monthEndISO(month: string): string {
    const [year, monthNumber] = month.split("-").map(Number);

    if (!year || !monthNumber) return `${month}-01`;

    return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  }

  async function load(): Promise<void> {
    loading = true;
    error = null;

    try {
      const [statusPayload, categoriesPayload] = await Promise.all([
        api<{ budgets: BudgetStatus[] }>("/budgets/status", {
          query: { date: monthEndISO(referenceMonth), includeInactive: showInactive },
        }),
        api<{ categories: Category[] }>("/categories", {
          query: { includeInactive: true },
        }),
      ]);

      statuses = statusPayload.budgets;
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

  function openEdit(budget: Budget): void {
    editing = budget;
    modalOpen = true;
  }

  async function toggleActive(budget: Budget): Promise<void> {
    const nextState = !budget.isActive;
    const question = nextState
      ? `Reativar o orçamento "${budget.name}"?`
      : `Desativar o orçamento "${budget.name}"? O histórico é preservado.`;

    if (!window.confirm(question)) return;

    toggling = budget.id;

    try {
      if (nextState) {
        await api(`/budgets/${budget.id}`, {
          method: "PATCH",
          body: { isActive: true },
        });
        toasts.success("Orçamento reativado");
      } else {
        await api(`/budgets/${budget.id}`, { method: "DELETE" });
        toasts.success("Orçamento desativado");
      }

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
    <p class="eyebrow">Planejamento</p>
    <h2>Orçamentos</h2>
    <p class="page-subtitle">Defina limites por categoria e acompanhe o consumo do período.</p>
  </div>
  <div class="page-actions">
    <button class="btn btn--primary" type="button" onclick={openCreate}>
      <Icon name="plus" size={18} />
      Novo orçamento
    </button>
  </div>
</div>

<div class="toolbar">
  <label class="field toolbar__field">
    <span>Mês de referência</span>
    <input
      class="input"
      type="month"
      bind:value={referenceMonth}
      onchange={() => void load()}
    />
  </label>

  <label class="checkbox">
    <input type="checkbox" bind:checked={showInactive} onchange={() => void load()} />
    <span>Mostrar inativos</span>
  </label>
</div>

{#if loading}
  <div class="grid grid--stats">
    {#each [1, 2] as item}
      <div class="stat skeleton-card" aria-hidden="true">
        <span class="skeleton skeleton--text"></span>
        <span class="skeleton skeleton--value"></span>
        <span class="skeleton skeleton--text"></span>
      </div>
    {/each}
  </div>
  <div class="card skeleton-card" aria-hidden="true">
    <span class="skeleton skeleton--title"></span>
    <span class="skeleton skeleton--row"></span>
    <span class="skeleton skeleton--row"></span>
  </div>
{:else if error}
  <div class="notice notice--error" role="alert">
    <Icon name="alert" />
    <div>
      <strong>Não foi possível carregar os orçamentos</strong>
      <p>{error}</p>
    </div>
    <button class="btn btn--soft" type="button" onclick={load}>Tentar novamente</button>
  </div>
{:else if ordered.length === 0}
  <div class="card">
    <EmptyState
      icon="chart"
      title="Nenhum orçamento neste período"
      description="Crie um limite por categoria para saber quanto ainda pode gastar sem sustos."
    >
      {#snippet action()}
        <button class="btn btn--primary" type="button" onclick={openCreate}>
          Criar orçamento
        </button>
      {/snippet}
    </EmptyState>
  </div>
{:else}
  {#if totals.length > 0}
    <section class="grid grid--stats" aria-label="Resumo dos orçamentos">
      {#each totals as total (total.currencyCode)}
        <article class="stat">
          <span class="stat__label">Limite · {total.currencyCode}</span>
          <strong class="stat__value">
            {formatMoney(total.limitMinor, total.currencyCode)}
          </strong>
          <span class="stat__hint">{total.count} orçamento(s) ativo(s)</span>
        </article>

        <article class="stat">
          <span class="stat__label">Consumido · {total.currencyCode}</span>
          <strong class="stat__value stat__value--expense">
            {formatMoney(total.spentMinor, total.currencyCode)}
          </strong>
          <span class="stat__hint">
            {total.limitMinor > 0
              ? `${Math.round((total.spentMinor / total.limitMinor) * 100)}% do limite`
              : "—"}
          </span>
        </article>

        <article class="stat stat--accent">
          <span class="stat__label">Disponível · {total.currencyCode}</span>
          <strong class="stat__value" class:negative={total.remainingMinor < 0}>
            {formatMoney(total.remainingMinor, total.currencyCode)}
          </strong>
          <span class="stat__hint">
            {total.remainingMinor < 0 ? "Acima do limite" : "Ainda pode gastar"}
          </span>
        </article>
      {/each}
    </section>
  {/if}

  <section class="card card--flush">
    <div class="budget-list">
      {#each ordered as status (status.budget.id)}
        <article
          class="budget-row"
          class:budget-row--inactive={!status.budget.isActive}
          aria-label={`Orçamento ${status.budget.name}`}
        >
          <div class="budget-row__head">
            <div class="budget-row__title">
              <strong>{status.budget.name}</strong>
              <span class="muted">
                {status.budget.categoryName ?? "Sem categoria"} · {periodLabel(status.budget)}
              </span>
            </div>

            <div class="budget-row__values">
              <strong>
                {formatMoney(status.spentMinor, status.budget.currencyCode)}
                <span class="muted">
                  / {formatMoney(status.budget.limitMinor, status.budget.currencyCode)}
                </span>
              </strong>
              <span class="muted">{Math.round(status.percentUsed)}%</span>
            </div>
          </div>

          <div
            class="bar-track"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.min(100, Math.round(status.percentUsed))}
            aria-label={`Consumo de ${status.budget.name}`}
          >
            <span
              class="bar-fill"
              class:bar-fill--warning={status.level === "warning"}
              class:bar-fill--danger={status.level === "exceeded"}
              style:width={progressWidth(status.percentUsed)}
            ></span>
          </div>

          <div class="budget-row__meta">
            <span class:negative={status.remainingMinor < 0}>
              {status.remainingMinor < 0
                ? `${formatMoney(Math.abs(status.remainingMinor), status.budget.currencyCode)} acima do limite`
                : `${formatMoney(status.remainingMinor, status.budget.currencyCode)} disponíveis`}
            </span>

            <span class={levelClass(status.level)}>{levelLabel(status.level)}</span>
            {#if !status.isPeriodActive}
              <span class="badge badge--inactive">Fora do período</span>
            {/if}
            {#if !status.budget.isActive}
              <span class="badge badge--inactive">Inativo</span>
            {/if}
            {#if status.crossedThresholds.length > 0}
              <span class="muted">
                Limiares: {status.crossedThresholds.join("%, ")}%
              </span>
            {/if}

            <div class="budget-row__actions">
              <button
                class="btn btn--icon btn--ghost btn--sm"
                type="button"
                title="Editar"
                aria-label={`Editar ${status.budget.name}`}
                onclick={() => openEdit(status.budget)}
              >
                <Icon name="edit" size={16} />
              </button>
              <button
                class="btn btn--ghost btn--sm"
                type="button"
                disabled={toggling === status.budget.id}
                onclick={() => toggleActive(status.budget)}
              >
                {status.budget.isActive ? "Desativar" : "Reativar"}
              </button>
            </div>
          </div>
        </article>
      {/each}
    </div>
  </section>
{/if}

<BudgetFormModal
  open={modalOpen}
  budget={editing}
  {categories}
  defaultCurrency={baseCurrency}
  defaultStartDate={`${referenceMonth}-01`}
  onclose={() => (modalOpen = false)}
  onsaved={() => void load()}
/>
