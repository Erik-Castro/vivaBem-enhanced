<script lang="ts">
  import { onMount } from "svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Icon from "../components/Icon.svelte";
  import { api, errorMessage } from "../lib/api";
  import { formatDateTime } from "../lib/format";
  import {
    achievementCategoryIcon,
    achievementCategoryLabel,
    achievementCategoryOptions,
  } from "../lib/labels";
  import type {
    AchievementCategory,
    AchievementProgress,
    AchievementSummary,
  } from "../lib/types";

  type StatusFilter = "all" | "unlocked" | "locked";
  type CategoryFilter = "all" | AchievementCategory;

  const statusTabs: readonly { value: StatusFilter; label: string }[] = [
    { value: "all", label: "Todas" },
    { value: "unlocked", label: "Desbloqueadas" },
    { value: "locked", label: "Em progresso" },
  ];

  let achievements = $state<AchievementProgress[]>([]);
  let summary = $state<AchievementSummary | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let statusFilter = $state<StatusFilter>("all");
  let categoryFilter = $state<CategoryFilter>("all");
  let search = $state("");

  const counts = $derived.by(() => {
    const result = { all: achievements.length, unlocked: 0, locked: 0 };

    for (const achievement of achievements) {
      if (achievement.isUnlocked) result.unlocked += 1;
      else result.locked += 1;
    }

    return result;
  });

  const completionPercent = $derived(
    summary === null || summary.total === 0
      ? 0
      : Math.min(100, Math.round((summary.unlocked / summary.total) * 100)),
  );

  const visible = $derived.by(() => {
    const term = normalize(search.trim());

    return achievements.filter((achievement) => {
      if (statusFilter === "unlocked" && !achievement.isUnlocked) return false;
      if (statusFilter === "locked" && achievement.isUnlocked) return false;
      if (categoryFilter !== "all" && achievement.category !== categoryFilter) return false;
      if (term === "") return true;

      return (
        normalize(achievement.title).includes(term) ||
        normalize(achievement.description).includes(term)
      );
    });
  });

  const filtersActive = $derived(
    statusFilter !== "all" || categoryFilter !== "all" || search.trim() !== "",
  );

  function normalize(value: string): string {
    return value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  }

  function percentOf(achievement: AchievementProgress): number {
    if (achievement.isUnlocked) return 100;
    if (achievement.targetMetric <= 0) return 100;
    return Math.min(
      100,
      Math.max(0, Math.round((achievement.currentProgress / achievement.targetMetric) * 100)),
    );
  }

  function barWidth(achievement: AchievementProgress): string {
    return `${Math.max(3, percentOf(achievement))}%`;
  }

  function remaining(achievement: AchievementProgress): number {
    return Math.max(0, achievement.targetMetric - achievement.currentProgress);
  }

  function clearFilters(): void {
    statusFilter = "all";
    categoryFilter = "all";
    search = "";
  }

  async function load(): Promise<void> {
    loading = true;
    error = null;

    try {
      const payload = await api<{
        summary: AchievementSummary;
        achievements: AchievementProgress[];
      }>("/achievements/me/progress");

      summary = payload.summary;
      achievements = payload.achievements;
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
    <p class="eyebrow">Evolução</p>
    <h2>Conquistas</h2>
    <p class="page-subtitle">
      Cada marco das suas finanças e hábitos vira uma conquista. Desbloqueie e acumule pontos.
    </p>
  </div>
  <div class="page-actions">
    <button class="btn btn--soft" type="button" onclick={load} disabled={loading}>
      <Icon name="refresh" size={18} />
      Atualizar
    </button>
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
  <div class="grid grid--cards">
    {#each [1, 2, 3] as item}
      <div class="card skeleton-card" aria-hidden="true">
        <span class="skeleton skeleton--title"></span>
        <span class="skeleton skeleton--text"></span>
        <span class="skeleton skeleton--row"></span>
      </div>
    {/each}
  </div>
{:else if error}
  <div class="notice notice--error" role="alert">
    <Icon name="alert" />
    <div>
      <strong>Não foi possível carregar as conquistas</strong>
      <p>{error}</p>
    </div>
    <button class="btn btn--soft" type="button" onclick={load}>Tentar novamente</button>
  </div>
{:else if summary && achievements.length === 0}
  <div class="card">
    <EmptyState
      icon="trophy"
      title="Nenhuma conquista disponível"
      description="O catálogo é preenchido pelas migrações da API. Volte depois de concluir suas primeiras metas."
    />
  </div>
{:else if summary}
  <section class="grid grid--stats" aria-label="Resumo das conquistas">
    <article class="stat stat--accent">
      <span class="stat__label">Desbloqueadas</span>
      <strong class="stat__value">{summary.unlocked}</strong>
      <span class="stat__hint">de {summary.total} conquistas</span>
    </article>

    <article class="stat">
      <span class="stat__label">Pontos</span>
      <strong class="stat__value">{summary.points}</strong>
      <span class="stat__hint">acumulados nas conquistas</span>
    </article>

    <article class="stat">
      <span class="stat__label">Progresso da coleção</span>
      <strong class="stat__value">{completionPercent}%</strong>
      <div
        class="bar-track"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={completionPercent}
        aria-label="Progresso da coleção de conquistas"
      >
        <span class="bar-fill bar-fill--success" style:width={`${completionPercent}%`}></span>
      </div>
    </article>

    <article class="stat">
      <span class="stat__label">Em progresso</span>
      <strong class="stat__value">{counts.locked}</strong>
      <span class="stat__hint">entre as conquistas visíveis</span>
    </article>
  </section>

  <div class="toolbar">
    <div class="tabs" role="tablist" aria-label="Status das conquistas">
      {#each statusTabs as tab (tab.value)}
        <button
          class="tab"
          class:active={statusFilter === tab.value}
          type="button"
          role="tab"
          aria-selected={statusFilter === tab.value}
          onclick={() => (statusFilter = tab.value)}
        >
          {tab.label}
          <span class="tab__count">
            {tab.value === "all" ? counts.all : counts[tab.value]}
          </span>
        </button>
      {/each}
    </div>

    <label class="field toolbar__field">
      <span>Categoria</span>
      <select class="select" bind:value={categoryFilter}>
        <option value="all">Todas as categorias</option>
        {#each achievementCategoryOptions as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>

    <label class="field toolbar__field">
      <span>Buscar</span>
      <input
        class="input"
        type="search"
        placeholder="Título ou descrição"
        bind:value={search}
      />
    </label>
  </div>

  {#if visible.length === 0}
    <div class="card">
      <EmptyState
        icon="search"
        title="Nenhuma conquista encontrada"
        description="Ajuste os filtros ou tente outro termo de busca."
      >
        {#snippet action()}
          {#if filtersActive}
            <button class="btn btn--soft" type="button" onclick={clearFilters}>
              Limpar filtros
            </button>
          {/if}
        {/snippet}
      </EmptyState>
    </div>
  {:else}
    <p class="achievement-count muted">
      {visible.length} de {achievements.length} conquistas visíveis
    </p>

    <section class="grid grid--cards" aria-label="Conquistas">
      {#each visible as achievement (achievement.id)}
        <article
          class="achievement-card"
          class:achievement-card--unlocked={achievement.isUnlocked}
          aria-label={`Conquista ${achievement.title}`}
        >
          <header class="achievement-card__head">
            <span class="achievement-badge" class:achievement-badge--unlocked={achievement.isUnlocked}>
              <Icon name={achievementCategoryIcon(achievement.category)} size={20} />
            </span>
            <span class="achievement-points">+{achievement.pointsReward} pts</span>
          </header>

          <div class="achievement-card__body">
            <h3>{achievement.title}</h3>
            <p class="achievement-card__desc">{achievement.description}</p>
          </div>

          <div class="achievement-card__tags">
            <span class="badge badge--soon">
              {achievementCategoryLabel(achievement.category)}
            </span>
            {#if achievement.isUnlocked}
              <span class="badge badge--active">
                <Icon name="check" size={12} />
                Desbloqueada
              </span>
            {:else}
              <span class="badge badge--pending">Em progresso</span>
            {/if}
            {#if achievement.isHidden}
              <span class="badge badge--inactive">Oculta</span>
            {/if}
          </div>

          <div class="achievement-card__progress">
            <div class="achievement-card__progress-head">
              <span class="muted">Progresso</span>
              <strong>{achievement.currentProgress} / {achievement.targetMetric}</strong>
            </div>
            <div
              class="bar-track"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={percentOf(achievement)}
              aria-label={`Progresso de ${achievement.title}`}
            >
              <span
                class="bar-fill"
                class:bar-fill--success={achievement.isUnlocked}
                style:width={barWidth(achievement)}
              ></span>
            </div>
            <span class="hint">
              {#if achievement.isUnlocked && achievement.unlockedAt}
                Desbloqueada em {formatDateTime(achievement.unlockedAt)}
              {:else if remaining(achievement) === 0}
                Requisito cumprido; será desbloqueada na próxima avaliação.
              {:else}
                Faltam {remaining(achievement)} para desbloquear.
              {/if}
            </span>
          </div>
        </article>
      {/each}
    </section>
  {/if}
{/if}
