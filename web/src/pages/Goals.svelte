<script lang="ts">
  import { onMount } from "svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import GoalDetailModal from "../components/GoalDetailModal.svelte";
  import GoalFormModal from "../components/GoalFormModal.svelte";
  import Icon from "../components/Icon.svelte";
  import { api, errorMessage } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { formatDate, formatMoney } from "../lib/format";
  import { toasts } from "../lib/toast.svelte";
  import type { Account, Goal, GoalProgress, GoalStatus } from "../lib/types";

  type GoalFilter = "all" | GoalStatus;

  const tabs: readonly { value: GoalFilter; label: string }[] = [
    { value: "all", label: "Todas" },
    { value: "active", label: "Ativas" },
    { value: "paused", label: "Pausadas" },
    { value: "completed", label: "Concluídas" },
    { value: "cancelled", label: "Canceladas" },
  ];

  let goals = $state<Goal[]>([]);
  let progressById = $state<Record<string, GoalProgress>>({});
  let accounts = $state<Account[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let filter = $state<GoalFilter>("all");
  let formOpen = $state(false);
  let editing = $state<Goal | null>(null);
  let detailOpen = $state(false);
  let detailProgress = $state<GoalProgress | null>(null);
  let busy = $state<string | null>(null);

  const baseCurrency = $derived(auth.user?.preferences.baseCurrency ?? "BRL");
  const counts = $derived.by(() => {
    const result: Record<GoalFilter, number> = {
      all: goals.length,
      active: 0,
      paused: 0,
      completed: 0,
      cancelled: 0,
    };

    for (const goal of goals) {
      result[goal.status] += 1;
    }

    return result;
  });
  const visible = $derived(
    filter === "all" ? goals : goals.filter((goal) => goal.status === filter),
  );

  function statusLabel(status: GoalStatus): string {
    if (status === "paused") return "Pausada";
    if (status === "completed") return "Concluída";
    if (status === "cancelled") return "Cancelada";
    return "Ativa";
  }

  function statusClass(status: GoalStatus): string {
    if (status === "paused") return "badge badge--pending";
    if (status === "completed") return "badge badge--active";
    if (status === "cancelled") return "badge badge--inactive";
    return "badge badge--soon";
  }

  function progressWidth(percent: number): string {
    return `${Math.min(100, Math.max(3, Math.round(percent)))}%`;
  }

  async function load(): Promise<void> {
    loading = true;
    error = null;

    try {
      const [goalsPayload, accountsPayload] = await Promise.all([
        api<{ goals: Goal[] }>("/goals"),
        api<{ accounts: Account[] }>("/accounts"),
      ]);

      goals = goalsPayload.goals;
      accounts = accountsPayload.accounts;

      const entries = await Promise.all(
        goals.map(async (goal) => {
          const payload = await api<{ progress: GoalProgress }>(
            `/goals/${goal.id}/progress`,
          );
          return [goal.id, payload.progress] as const;
        }),
      );

      progressById = Object.fromEntries(entries);
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  function openCreate(): void {
    editing = null;
    formOpen = true;
  }

  function openEdit(goal: Goal): void {
    editing = goal;
    formOpen = true;
  }

  function openDetail(goal: Goal): void {
    detailProgress = progressById[goal.id] ?? null;
    detailOpen = true;
  }

  async function togglePause(goal: Goal): Promise<void> {
    const nextStatus = goal.status === "paused" ? "active" : "paused";
    busy = goal.id;

    try {
      await api(`/goals/${goal.id}`, {
        method: "PATCH",
        body: { status: nextStatus },
      });
      toasts.success(nextStatus === "paused" ? "Meta pausada" : "Meta retomada");
      await load();
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      busy = null;
    }
  }

  async function cancelGoal(goal: Goal): Promise<void> {
    if (!window.confirm(`Cancelar a meta "${goal.name}"? O histórico é preservado.`)) {
      return;
    }

    busy = goal.id;

    try {
      await api(`/goals/${goal.id}`, { method: "DELETE" });
      toasts.success("Meta cancelada");
      await load();
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      busy = null;
    }
  }

  onMount(load);
</script>

<div class="page-head">
  <div>
    <p class="eyebrow">Planejamento</p>
    <h2>Metas</h2>
    <p class="page-subtitle">Planeje objetivos financeiros e acompanhe cada contribuição.</p>
  </div>
  <div class="page-actions">
    <button class="btn btn--primary" type="button" onclick={openCreate}>
      <Icon name="plus" size={18} />
      Nova meta
    </button>
  </div>
</div>

<div class="toolbar">
  <div class="tabs" role="tablist" aria-label="Filtrar metas">
    {#each tabs as tab (tab.value)}
      <button
        class="tab"
        class:active={filter === tab.value}
        type="button"
        role="tab"
        aria-selected={filter === tab.value}
        onclick={() => (filter = tab.value)}
      >
        {tab.label}
        <span class="tab__count">{counts[tab.value]}</span>
      </button>
    {/each}
  </div>
</div>

{#if loading}
  <div class="grid grid--cards">
    {#each [1, 2, 3] as item}
      <div class="card skeleton-card" aria-hidden="true">
        <span class="skeleton skeleton--title"></span>
        <span class="skeleton skeleton--text"></span>
        <span class="skeleton skeleton--value"></span>
        <span class="skeleton skeleton--row"></span>
      </div>
    {/each}
  </div>
{:else if error}
  <div class="notice notice--error" role="alert">
    <Icon name="alert" />
    <div>
      <strong>Não foi possível carregar as metas</strong>
      <p>{error}</p>
    </div>
    <button class="btn btn--soft" type="button" onclick={load}>Tentar novamente</button>
  </div>
{:else if goals.length === 0}
  <div class="card">
    <EmptyState
      icon="target"
      title="Nenhuma meta cadastrada"
      description="Crie uma meta para dar destino ao seu dinheiro e acompanhar o progresso."
    >
      {#snippet action()}
        <button class="btn btn--primary" type="button" onclick={openCreate}>
          Criar meta
        </button>
      {/snippet}
    </EmptyState>
  </div>
{:else if visible.length === 0}
  <div class="card">
    <p class="muted">Nenhuma meta neste filtro.</p>
  </div>
{:else}
  <section class="grid grid--cards" aria-label="Metas">
    {#each visible as goal (goal.id)}
      {@const progress = progressById[goal.id]}
      <article
        class="card goal-card"
        class:goal-card--cancelled={goal.status === "cancelled"}
        aria-label={`Meta ${goal.name}`}
      >
        <div class="goal-card__head">
          <div class="goal-card__title">
            <h3>{goal.name}</h3>
            {#if goal.description}
              <p class="goal-card__desc">{goal.description}</p>
            {/if}
          </div>
          <span class={statusClass(goal.status)}>{statusLabel(goal.status)}</span>
        </div>

        {#if progress}
          <div class="goal-card__amounts">
            <strong>{formatMoney(progress.contributedMinor, goal.currencyCode)}</strong>
            <span class="muted">
              de {formatMoney(goal.targetAmountMinor, goal.currencyCode)}
            </span>
            <span class="goal-card__percent">{Math.round(progress.progressPercent)}%</span>
          </div>

          <div
            class="bar-track"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.min(100, Math.round(progress.progressPercent))}
            aria-label={`Progresso de ${goal.name}`}
          >
            <span
              class="bar-fill"
              class:bar-fill--success={progress.isCompleted}
              style:width={progressWidth(progress.progressPercent)}
            ></span>
          </div>

          <div class="goal-card__meta">
            <span>
              {progress.remainingMinor > 0
                ? `${formatMoney(progress.remainingMinor, goal.currencyCode)} restantes`
                : "Meta atingida"}
            </span>
            <span>{progress.contributionCount} contribuição(ões)</span>
            {#if goal.targetDate}
              <span>Alvo em {formatDate(goal.targetDate)}</span>
            {/if}
            {#if goal.targetAccountName}
              <span>Conta: {goal.targetAccountName}</span>
            {/if}
          </div>
        {/if}

        <div class="goal-card__actions">
          <button
            class="btn btn--soft btn--sm"
            type="button"
            onclick={() => openDetail(goal)}
          >
            {goal.status === "cancelled" ? "Histórico" : "Contribuir"}
          </button>

          {#if goal.status !== "cancelled"}
            <button
              class="btn btn--icon btn--ghost btn--sm"
              type="button"
              title="Editar"
              aria-label={`Editar ${goal.name}`}
              onclick={() => openEdit(goal)}
            >
              <Icon name="edit" size={16} />
            </button>
          {/if}

          {#if goal.status === "active" || goal.status === "paused"}
            <button
              class="btn btn--ghost btn--sm"
              type="button"
              disabled={busy === goal.id}
              onclick={() => togglePause(goal)}
            >
              {goal.status === "paused" ? "Retomar" : "Pausar"}
            </button>
          {/if}

          {#if goal.status !== "cancelled"}
            <button
              class="btn btn--ghost btn--sm btn--danger-ghost"
              type="button"
              disabled={busy === goal.id}
              onclick={() => cancelGoal(goal)}
            >
              Cancelar
            </button>
          {/if}
        </div>
      </article>
    {/each}
  </section>
{/if}

<GoalFormModal
  open={formOpen}
  goal={editing}
  {accounts}
  currencyLocked={(editing ? progressById[editing.id]?.contributionCount ?? 0 : 0) > 0}
  defaultCurrency={baseCurrency}
  onclose={() => {
    formOpen = false;
    editing = null;
  }}
  onsaved={() => void load()}
/>

<GoalDetailModal
  open={detailOpen}
  progress={detailProgress}
  {accounts}
  onclose={() => {
    detailOpen = false;
    detailProgress = null;
  }}
  onchanged={() => void load()}
/>
