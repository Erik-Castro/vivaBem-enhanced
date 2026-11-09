<script lang="ts">
  import { onMount } from "svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import HabitDetailModal from "../components/HabitDetailModal.svelte";
  import HabitFormModal from "../components/HabitFormModal.svelte";
  import Icon from "../components/Icon.svelte";
  import TriggerFormModal from "../components/TriggerFormModal.svelte";
  import { api, errorMessage } from "../lib/api";
  import { todayISO } from "../lib/format";
  import { habitRecurrenceLabel, habitTypeLabel } from "../lib/labels";
  import { toasts } from "../lib/toast.svelte";
  import type { Habit, HabitStreak, HabitTrigger } from "../lib/types";

  type Tab = "habits" | "triggers";

  let habits = $state<Habit[]>([]);
  let streaks = $state<Record<string, HabitStreak>>({});
  let triggers = $state<HabitTrigger[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let tab = $state<Tab>("habits");
  let showInactive = $state(false);
  let habitFormOpen = $state(false);
  let editingHabit = $state<Habit | null>(null);
  let detailOpen = $state(false);
  let detailHabit = $state<Habit | null>(null);
  let triggerFormOpen = $state(false);
  let editingTrigger = $state<HabitTrigger | null>(null);
  let busy = $state<string | null>(null);

  const today = todayISO();
  const nameById = $derived(
    Object.fromEntries(habits.map((habit) => [habit.id, habit.name] as const)),
  );
  const activeCount = $derived(habits.filter((habit) => habit.isActive).length);

  async function load(): Promise<void> {
    loading = true;
    error = null;

    try {
      const [habitsPayload, triggersPayload] = await Promise.all([
        api<{ habits: Habit[] }>("/habits", {
          query: { includeInactive: showInactive },
        }),
        api<{ triggers: HabitTrigger[] }>("/habit-triggers"),
      ]);

      habits = habitsPayload.habits;
      triggers = triggersPayload.triggers;

      const entries = await Promise.all(
        habits.map(async (habit) => {
          const payload = await api<{ streak: HabitStreak }>(`/habits/${habit.id}/streak`);
          return [habit.id, payload.streak] as const;
        }),
      );

      streaks = Object.fromEntries(entries);
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  function openCreateHabit(): void {
    editingHabit = null;
    habitFormOpen = true;
  }

  function openEditHabit(habit: Habit): void {
    editingHabit = habit;
    habitFormOpen = true;
  }

  function openDetail(habit: Habit): void {
    detailHabit = habit;
    detailOpen = true;
  }

  function openCreateTrigger(): void {
    editingTrigger = null;
    triggerFormOpen = true;
  }

  function openEditTrigger(trigger: HabitTrigger): void {
    editingTrigger = trigger;
    triggerFormOpen = true;
  }

  async function toggleActive(habit: Habit): Promise<void> {
    if (habit.isActive && !window.confirm(`Desativar "${habit.name}" e seus subhábitos?`)) {
      return;
    }

    busy = habit.id;

    try {
      if (habit.isActive) {
        await api(`/habits/${habit.id}`, { method: "DELETE" });
        toasts.success("Hábito desativado");
      } else {
        await api(`/habits/${habit.id}`, {
          method: "PATCH",
          body: { isActive: true },
        });
        toasts.success("Hábito reativado");
      }

      await load();
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      busy = null;
    }
  }

  async function checkIn(habit: Habit): Promise<void> {
    const streak = streaks[habit.id];
    if (streak === undefined) return;

    const value = habit.habitType === "good"
      ? habit.dailyTarget
      : streak.completedToday
        ? 1
        : 0;

    busy = habit.id;

    try {
      await api(`/habits/${habit.id}/logs`, {
        method: "POST",
        body: { logDate: today, value },
      });
      toasts.success(
        habit.habitType === "good"
          ? "Hábito concluído hoje"
          : value === 0
            ? "Dia limpo registrado"
            : "Recaída registrada",
      );
      await load();
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      busy = null;
    }
  }

  async function deleteTrigger(trigger: HabitTrigger): Promise<void> {
    if (!window.confirm(`Remover o gatilho "${trigger.triggerDescription}"?`)) return;

    busy = trigger.id;

    try {
      await api(`/habit-triggers/${trigger.id}`, { method: "DELETE" });
      toasts.success("Gatilho removido");
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
    <p class="eyebrow">Rotina</p>
    <h2>Hábitos</h2>
    <p class="page-subtitle">
      Acompanhe sequências, registre o dia e conecte hábitos ruins a substituições.
    </p>
  </div>
  <div class="page-actions">
    {#if tab === "habits"}
      <button class="btn btn--primary" type="button" onclick={openCreateHabit}>
        <Icon name="plus" size={18} />
        Novo hábito
      </button>
    {:else}
      <button class="btn btn--primary" type="button" onclick={openCreateTrigger}>
        <Icon name="plus" size={18} />
        Novo gatilho
      </button>
    {/if}
  </div>
</div>

<div class="toolbar">
  <div class="tabs" role="tablist" aria-label="Seções de hábitos">
    <button
      class="tab"
      class:active={tab === "habits"}
      type="button"
      role="tab"
      aria-selected={tab === "habits"}
      onclick={() => (tab = "habits")}
    >
      Hábitos
      <span class="tab__count">{habits.length}</span>
    </button>
    <button
      class="tab"
      class:active={tab === "triggers"}
      type="button"
      role="tab"
      aria-selected={tab === "triggers"}
      onclick={() => (tab = "triggers")}
    >
      Gatilhos
      <span class="tab__count">{triggers.length}</span>
    </button>
  </div>

  {#if tab === "habits"}
    <label class="checkbox toolbar__check">
      <input type="checkbox" bind:checked={showInactive} onchange={load} />
      <span>Mostrar inativos</span>
    </label>
  {/if}
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
      <strong>Não foi possível carregar os hábitos</strong>
      <p>{error}</p>
    </div>
    <button class="btn btn--soft" type="button" onclick={load}>Tentar novamente</button>
  </div>
{:else if tab === "habits"}
  {#if habits.length === 0}
    <div class="card">
      <EmptyState
        icon="heart"
        title="Nenhum hábito cadastrado"
        description="Comece com um hábito simples e acompanhe a sequência dia após dia."
      >
        {#snippet action()}
          <button class="btn btn--primary" type="button" onclick={openCreateHabit}>
            Criar hábito
          </button>
        {/snippet}
      </EmptyState>
    </div>
  {:else}
    <section class="grid grid--cards" aria-label="Hábitos">
      {#each habits as habit (habit.id)}
        {@const streak = streaks[habit.id]}
        <article
          class="card habit-card"
          class:habit-card--inactive={!habit.isActive}
          aria-label={`Hábito ${habit.name}`}
        >
          <div class="habit-card__head">
            <div class="habit-card__title">
              <span class="habit-dot" style:background={habit.color ?? "var(--primary)"}></span>
              <h3>{habit.name}</h3>
            </div>
            <span
              class="badge {habit.habitType === "good" ? "badge--active" : "badge--danger"}"
            >
              {habitTypeLabel(habit.habitType)}
            </span>
          </div>

          {#if habit.description}
            <p class="habit-card__desc">{habit.description}</p>
          {/if}

          <div class="habit-card__meta">
            <span>{habitRecurrenceLabel(habit)}</span>
            {#if habit.dailyTarget > 1}
              <span>
                Meta {habit.dailyTarget}{habit.targetUnit ? ` ${habit.targetUnit}` : ""}
              </span>
            {/if}
            {#if habit.parentHabitId && nameById[habit.parentHabitId]}
              <span>Empilhado em {nameById[habit.parentHabitId]}</span>
            {/if}
            {#if !habit.isActive}
              <span class="badge badge--inactive">Inativo</span>
            {/if}
          </div>

          {#if streak}
            <div class="habit-card__streak">
              <div>
                <strong>{streak.currentStreak}</strong>
                <span class="muted">dias seguidos</span>
              </div>
              <div>
                <strong>{streak.longestStreak}</strong>
                <span class="muted">recorde</span>
              </div>
              <div class="habit-card__today">
                <span
                  class="badge {streak.completedToday ? "badge--active" : "badge--pending"}"
                >
                  {habit.habitType === "bad"
                    ? streak.completedToday
                      ? "Hoje: dia limpo"
                      : "Hoje: recaída"
                    : streak.completedToday
                      ? "Hoje: cumprido"
                      : "Hoje: pendente"}
                </span>
              </div>
            </div>
          {/if}

          <div class="habit-card__actions">
            {#if habit.isActive && streak}
              <button
                class="btn btn--soft btn--sm"
                type="button"
                disabled={busy === habit.id ||
                  (habit.habitType === "good" && streak.completedToday)}
                onclick={() => checkIn(habit)}
              >
                {habit.habitType === "good"
                  ? streak.completedToday
                    ? "Concluído hoje"
                    : "Concluir hoje"
                  : streak.completedToday
                    ? "Registrar recaída"
                    : "Marcar dia limpo"}
              </button>
            {/if}

            <button class="btn btn--ghost btn--sm" type="button" onclick={() => openDetail(habit)}>
              Detalhes
            </button>

            {#if habit.isActive}
              <button
                class="btn btn--icon btn--ghost btn--sm"
                type="button"
                title="Editar"
                aria-label={`Editar ${habit.name}`}
                onclick={() => openEditHabit(habit)}
              >
                <Icon name="edit" size={16} />
              </button>
            {/if}

            <button
              class="btn btn--ghost btn--sm"
              type="button"
              disabled={busy === habit.id}
              onclick={() => toggleActive(habit)}
            >
              {habit.isActive ? "Desativar" : "Reativar"}
            </button>
          </div>
        </article>
      {/each}
    </section>
  {/if}
{:else}
  {#if triggers.length === 0}
    <div class="card">
      <EmptyState
        icon="refresh"
        title="Nenhum gatilho cadastrado"
        description="Conecte um hábito ruim a uma substituição saudável e registre quando ela for usada."
      >
        {#snippet action()}
          <button class="btn btn--primary" type="button" onclick={openCreateTrigger}>
            Criar gatilho
          </button>
        {/snippet}
      </EmptyState>
    </div>
  {:else}
    <section class="card card--flush" aria-label="Gatilhos">
      <ul class="trigger-list">
        {#each triggers as trigger (trigger.id)}
          <li class="trigger-row">
            <div class="trigger-row__main">
              <div class="trigger-row__title">
                <strong>{trigger.triggerDescription}</strong>
                <span class="badge badge--danger">{trigger.badHabitName}</span>
                {#if trigger.replacementHabitName}
                  <span class="muted">→ {trigger.replacementHabitName}</span>
                {/if}
              </div>
              {#if trigger.alternativeAction}
                <span class="hint">{trigger.alternativeAction}</span>
              {/if}
            </div>
            <div class="trigger-row__actions">
              <button
                class="btn btn--icon btn--ghost btn--sm"
                type="button"
                title="Editar"
                aria-label={`Editar gatilho ${trigger.triggerDescription}`}
                onclick={() => openEditTrigger(trigger)}
              >
                <Icon name="edit" size={16} />
              </button>
              <button
                class="btn btn--icon btn--ghost btn--sm"
                type="button"
                title="Remover"
                aria-label={`Remover gatilho ${trigger.triggerDescription}`}
                disabled={busy === trigger.id}
                onclick={() => deleteTrigger(trigger)}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
{/if}

<p class="muted habit-footer">{activeCount} hábito(s) ativo(s) em acompanhamento.</p>

<HabitFormModal
  open={habitFormOpen}
  habit={editingHabit}
  {habits}
  onclose={() => {
    habitFormOpen = false;
    editingHabit = null;
  }}
  onsaved={() => void load()}
/>

<HabitDetailModal
  open={detailOpen}
  habit={detailHabit}
  {triggers}
  onclose={() => {
    detailOpen = false;
    detailHabit = null;
  }}
  onchanged={() => void load()}
/>

<TriggerFormModal
  open={triggerFormOpen}
  trigger={editingTrigger}
  {habits}
  onclose={() => {
    triggerFormOpen = false;
    editingTrigger = null;
  }}
  onsaved={() => void load()}
/>
