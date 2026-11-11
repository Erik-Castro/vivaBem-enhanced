<script lang="ts">
  import { onMount } from "svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Icon from "../components/Icon.svelte";
  import { api, apiRequest, errorMessage } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { formatRelativeTime } from "../lib/format";
  import {
    insightCategoryIcon,
    insightCategoryLabel,
    insightCategoryOptions,
    insightSeverityLabel,
  } from "../lib/labels";
  import { toasts } from "../lib/toast.svelte";
  import type {
    FeedbackRating,
    Insight,
    InsightCategory,
    InsightSeverity,
  } from "../lib/types";

  const PAGE_SIZE = 50;

  let insights = $state<Insight[]>([]);
  let unread = $state(0);
  let loading = $state(true);
  let loadingMore = $state(false);
  let error = $state<string | null>(null);
  let category = $state<InsightCategory | "">("");
  let unreadOnly = $state(false);
  let hasMore = $state(false);
  let busyId = $state<string | null>(null);
  let markingAll = $state(false);

  let searchInput = $state("");
  let searchQuery = $state("");
  let searchResults = $state<Insight[] | null>(null);
  let searching = $state(false);
  let searchError = $state<string | null>(null);

  let feedbackSent = $state<Record<string, FeedbackRating>>({});

  const aiEnabled = $derived(auth.user?.preferences.aiEnabled ?? false);
  const visible = $derived(searchResults ?? insights);
  const hasUnread = $derived(unread > 0);

  function severityClass(severity: InsightSeverity): string {
    if (severity === "critical") return "badge--danger";
    if (severity === "high") return "badge--warning";
    if (severity === "medium") return "badge--soon";
    return "badge--inactive";
  }

  function patchInsight(updated: Insight): void {
    insights = insights.map((item) => (item.id === updated.id ? updated : item));
    searchResults = searchResults?.map((item) =>
      item.id === updated.id ? updated : item,
    ) ?? null;
  }

  async function loadUnread(): Promise<void> {
    try {
      const payload = await api<{ unread: number }>("/insights/unread-count");
      unread = payload.unread;
    } catch {
      // O contador é acessório; falhas não interrompem a lista.
    }
  }

  async function load(): Promise<void> {
    loading = true;
    error = null;

    try {
      const envelope = await apiRequest<{ insights: Insight[] }>("/insights", {
        query: {
          category: category === "" ? undefined : category,
          isRead: unreadOnly ? "false" : undefined,
          limit: PAGE_SIZE,
          offset: 0,
        },
      });

      insights = envelope.data.insights;
      hasMore = envelope.meta.hasMore ?? envelope.data.insights.length === PAGE_SIZE;
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  async function loadMore(): Promise<void> {
    if (loadingMore || !hasMore) return;

    loadingMore = true;

    try {
      const envelope = await apiRequest<{ insights: Insight[] }>("/insights", {
        query: {
          category: category === "" ? undefined : category,
          isRead: unreadOnly ? "false" : undefined,
          limit: PAGE_SIZE,
          offset: insights.length,
        },
      });

      insights = [...insights, ...envelope.data.insights];
      hasMore = envelope.meta.hasMore ?? envelope.data.insights.length === PAGE_SIZE;
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      loadingMore = false;
    }
  }

  async function refresh(): Promise<void> {
    clearSearch();
    await Promise.all([load(), loadUnread()]);
  }

  async function changeFilter(): Promise<void> {
    clearSearch();
    await load();
  }

  function clearSearch(): void {
    searchInput = "";
    searchQuery = "";
    searchResults = null;
    searchError = null;
  }

  async function runSearch(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (searching) return;

    const query = searchInput.trim();

    if (query === "") {
      clearSearch();
      return;
    }

    searching = true;
    searchError = null;

    try {
      const payload = await api<{ insights: Insight[] }>("/insights/search", {
        query: { q: query, limit: 50 },
      });

      searchResults = payload.insights;
      searchQuery = query;
    } catch (cause) {
      searchResults = null;
      searchQuery = "";
      searchError = errorMessage(cause);
    } finally {
      searching = false;
    }
  }

  async function markRead(insight: Insight): Promise<void> {
    if (insight.isRead || busyId !== null) return;

    busyId = insight.id;

    try {
      const result = await api<{ insight: Insight }>(`/insights/${insight.id}/read`, {
        method: "PATCH",
      });

      patchInsight(result.insight);
      unread = Math.max(0, unread - 1);
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      busyId = null;
    }
  }

  async function markAll(): Promise<void> {
    if (markingAll || !hasUnread) return;

    markingAll = true;

    try {
      const result = await api<{ marked: number }>("/insights/read-all", {
        method: "POST",
      });

      insights = insights.map((item) => ({ ...item, isRead: true }));
      searchResults = searchResults?.map((item) => ({ ...item, isRead: true })) ?? null;
      unread = 0;
      toasts.success(
        result.marked === 1
          ? "1 insight marcado como lido"
          : `${result.marked} insights marcados como lidos`,
      );
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      markingAll = false;
    }
  }

  async function sendFeedback(insight: Insight, rating: FeedbackRating): Promise<void> {
    if (busyId !== null) return;

    busyId = insight.id;

    try {
      await api(`/insights/${insight.id}/feedback`, {
        method: "POST",
        body: { rating },
      });

      feedbackSent = { ...feedbackSent, [insight.id]: rating };
      toasts.success("Obrigado pelo feedback");
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      busyId = null;
    }
  }

  onMount(() => {
    void load();
    void loadUnread();
  });
</script>

<div class="page-head">
  <div>
    <p class="eyebrow">Inteligência</p>
    <h2>Insights</h2>
    <p class="page-subtitle">
      Análises geradas pela IA a partir dos seus hábitos e das suas finanças.
    </p>
  </div>
  <div class="page-actions">
    <button class="btn btn--ghost btn--sm" type="button" onclick={() => void refresh()}>
      <Icon name="refresh" size={16} />
      Atualizar
    </button>
  </div>
</div>

{#if !aiEnabled}
  <div class="notice">
    <Icon name="sparkles" />
    <div>
      <strong>IA desativada</strong>
      <p>
        Ative a inteligência artificial nas preferências para que o Viva Bem gere
        novos insights. Os insights já existentes continuam disponíveis abaixo.
      </p>
    </div>
    <a class="btn btn--soft" href="#/settings">Abrir preferências</a>
  </div>
{/if}

<div class="toolbar">
  <label class="field toolbar__field">
    <span>Categoria</span>
    <select class="select" bind:value={category} onchange={() => void changeFilter()}>
      <option value="">Todas</option>
      {#each insightCategoryOptions as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </label>

  <div class="toolbar__actions">
    <label class="checkbox">
      <input type="checkbox" bind:checked={unreadOnly} onchange={() => void changeFilter()} />
      <span>Somente não lidos</span>
    </label>

    <form class="insight-search" onsubmit={runSearch}>
      <input
        class="input insight-search__input"
        type="search"
        placeholder="Buscar insights…"
        maxlength="200"
        aria-label="Buscar insights"
        bind:value={searchInput}
      />
      <button class="btn btn--soft btn--sm" type="submit" disabled={searching}>
        {#if searching}<span class="spinner"></span>{:else}<Icon name="search" size={16} />{/if}
        Buscar
      </button>
    </form>

    {#if hasUnread}
      <button
        class="btn btn--soft btn--sm"
        type="button"
        disabled={markingAll}
        onclick={() => void markAll()}
      >
        <Icon name="check" size={16} />
        Marcar todas ({unread})
      </button>
    {/if}
  </div>
</div>

{#if searchError}
  <div class="form-error" role="alert">
    <Icon name="alert" size={18} />
    <span>{searchError}</span>
  </div>
{/if}

{#if searchResults !== null}
  <div class="insight-search-summary">
    <span>
      {searchResults.length === 1 ? "1 resultado" : `${searchResults.length} resultados`}
      para <strong>{searchQuery}</strong>
    </span>
    <button class="btn btn--ghost btn--sm" type="button" onclick={clearSearch}>
      Limpar busca
    </button>
  </div>
{/if}

{#if loading}
  <div class="card skeleton-card" aria-hidden="true">
    <span class="skeleton skeleton--title"></span>
    <span class="skeleton skeleton--row"></span>
    <span class="skeleton skeleton--row"></span>
  </div>
{:else if error}
  <div class="notice notice--error" role="alert">
    <Icon name="alert" />
    <div>
      <strong>Não foi possível carregar os insights</strong>
      <p>{error}</p>
    </div>
    <button class="btn btn--soft" type="button" onclick={() => void load()}>
      Tentar novamente
    </button>
  </div>
{:else if visible.length === 0}
  <div class="card">
    {#if searchResults !== null}
      <EmptyState
        icon="search"
        title="Nenhum insight encontrado"
        description="Tente outra palavra. A busca usa similaridade e cai para texto quando a indexação ainda não terminou."
      >
        {#snippet action()}
          <button class="btn btn--soft" type="button" onclick={clearSearch}>
            Limpar busca
          </button>
        {/snippet}
      </EmptyState>
    {:else}
      <EmptyState
        icon="sparkles"
        title={unreadOnly || category !== "" ? "Nenhum insight neste filtro" : "Nenhum insight ainda"}
        description={unreadOnly || category !== ""
          ? "Ajuste os filtros para ver outros insights."
          : aiEnabled
          ? "Assim que houver dados suficientes, a IA publica análises aqui."
          : "Ative a IA nas preferências para receber análises automáticas."}
      >
        {#snippet action()}
          {#if unreadOnly || category !== ""}
            <button
              class="btn btn--soft"
              type="button"
              onclick={() => {
                unreadOnly = false;
                category = "";
                void changeFilter();
              }}
            >
              Limpar filtros
            </button>
          {:else if !aiEnabled}
            <a class="btn btn--soft" href="#/settings">Abrir preferências</a>
          {/if}
        {/snippet}
      </EmptyState>
    {/if}
  </div>
{:else}
  <div class="insight-list">
    {#each visible as insight (insight.id)}
      <article
        class="insight-card"
        class:insight-card--unread={!insight.isRead}
        aria-label={insight.title}
      >
        <span class="insight-card__icon" aria-hidden="true">
          <Icon name={insightCategoryIcon(insight.category)} size={20} />
        </span>

        <div class="insight-card__body">
          <div class="insight-card__head">
            <h3>{insight.title}</h3>
            <span class="badge {severityClass(insight.severity)}">
              {insightSeverityLabel(insight.severity)}
            </span>
            {#if !insight.isRead}
              <span class="insight-card__dot" title="Não lido"></span>
            {/if}
          </div>

          <p class="insight-card__message">{insight.message}</p>

          <div class="insight-card__meta">
            <span>{insightCategoryLabel(insight.category)}</span>
            <span>·</span>
            <span>{formatRelativeTime(insight.createdAt)}</span>
            <span>·</span>
            <span>{Math.round(insight.confidence * 100)}% de confiança</span>
          </div>

          <div class="insight-card__actions">
            {#if !insight.isRead}
              <button
                class="btn btn--soft btn--sm"
                type="button"
                disabled={busyId !== null}
                onclick={() => void markRead(insight)}
              >
                <Icon name="check" size={14} />
                Marcar como lida
              </button>
            {/if}

            <button
              class="btn btn--ghost btn--sm"
              class:insight-feedback--active={feedbackSent[insight.id] === "helpful"}
              type="button"
              aria-label={`Marcar como útil: ${insight.title}`}
              disabled={busyId !== null}
              onclick={() => void sendFeedback(insight, "helpful")}
            >
              <Icon name="thumbUp" size={14} />
              Útil
            </button>
            <button
              class="btn btn--ghost btn--sm"
              class:insight-feedback--active={feedbackSent[insight.id] === "not_helpful"}
              type="button"
              aria-label={`Marcar como não útil: ${insight.title}`}
              disabled={busyId !== null}
              onclick={() => void sendFeedback(insight, "not_helpful")}
            >
              <Icon name="thumbDown" size={14} />
              Não útil
            </button>
          </div>
        </div>
      </article>
    {/each}
  </div>

  {#if searchResults === null && hasMore}
    <div class="insight-more">
      <button
        class="btn btn--soft"
        type="button"
        disabled={loadingMore}
        onclick={() => void loadMore()}
      >
        {#if loadingMore}<span class="spinner"></span>{:else}Carregar mais{/if}
      </button>
    </div>
  {/if}
{/if}
