<script lang="ts">
  import { onMount } from "svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Icon from "../components/Icon.svelte";
  import NotificationItem from "../components/NotificationItem.svelte";
  import { errorMessage } from "../lib/api";
  import { notifications, type NotificationFilter } from "../lib/notifications.svelte";
  import { toasts } from "../lib/toast.svelte";

  let markingAll = $state(false);
  let refreshing = $state(false);

  onMount(() => {
    void notifications.load(true);
    void notifications.refreshUnread();
  });

  async function selectFilter(filter: NotificationFilter): Promise<void> {
    if (notifications.filter === filter) return;

    await notifications.setFilter(filter);
  }

  async function refresh(): Promise<void> {
    if (refreshing) return;

    refreshing = true;

    try {
      await Promise.all([notifications.load(true), notifications.refreshUnread()]);
      toasts.push("Notificações atualizadas", "info");
    } finally {
      refreshing = false;
    }
  }

  async function markAll(): Promise<void> {
    if (markingAll) return;

    markingAll = true;

    try {
      const marked = await notifications.markAllRead();
      toasts.success(
        marked === 1
          ? "1 notificação marcada como lida"
          : `${marked} notificações marcadas como lidas`,
      );
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      markingAll = false;
    }
  }
</script>

<div class="page-head">
  <div>
    <p class="eyebrow">Central de avisos</p>
    <h2>Notificações</h2>
    <p class="page-subtitle">
      Conquistas, alertas financeiros, avisos de segurança e novidades do seu espaço.
    </p>
  </div>
  <div class="page-actions">
    <button
      class="btn btn--ghost btn--sm"
      type="button"
      disabled={refreshing}
      onclick={refresh}
    >
      {#if refreshing}
        <span class="spinner"></span>
      {:else}
        <Icon name="refresh" size={16} />
      {/if}
      Atualizar
    </button>
    <button
      class="btn btn--soft btn--sm"
      type="button"
      disabled={markingAll || notifications.unread === 0}
      onclick={markAll}
    >
      <Icon name="check" size={16} />
      Marcar todas como lidas
    </button>
  </div>
</div>

<div class="toolbar">
  <div class="tabs" role="tablist" aria-label="Filtrar notificações">
    <button
      class="tab"
      class:active={notifications.filter === "all"}
      type="button"
      role="tab"
      aria-selected={notifications.filter === "all"}
      onclick={() => selectFilter("all")}
    >
      Todas
    </button>
    <button
      class="tab"
      class:active={notifications.filter === "unread"}
      type="button"
      role="tab"
      aria-selected={notifications.filter === "unread"}
      onclick={() => selectFilter("unread")}
    >
      Não lidas
      {#if notifications.unread > 0}
        <span class="tab__count">{notifications.unread}</span>
      {/if}
    </button>
  </div>
  <span class="muted notif-page__hint">O contador é atualizado a cada minuto.</span>
</div>

{#if notifications.itemsLoading && notifications.items.length === 0}
  <div class="card notif-state">
    <span class="spinner"></span>
    <p class="muted">Carregando notificações…</p>
  </div>
{:else if notifications.error !== null}
  <div class="card">
    <EmptyState
      icon="alert"
      title="Não foi possível carregar"
      description={notifications.error}
    >
      {#snippet action()}
        <button class="btn btn--soft" type="button" onclick={() => notifications.load(true)}>
          Tentar novamente
        </button>
      {/snippet}
    </EmptyState>
  </div>
{:else if notifications.items.length === 0}
  <div class="card">
    {#if notifications.filter === "unread"}
      <EmptyState
        icon="check"
        title="Tudo em dia"
        description="Você não tem notificações não lidas."
      />
    {:else}
      <EmptyState
        icon="bell"
        title="Nenhuma notificação"
        description="Quando houver conquistas, alertas ou avisos, eles aparecem aqui."
      />
    {/if}
  </div>
{:else}
  <div class="card card--flush">
    <div class="notif-list" aria-label="Lista de notificações">
      {#each notifications.items as notification (notification.id)}
        <NotificationItem {notification} />
      {/each}
    </div>

    {#if notifications.hasMore}
      <div class="notif-list__foot">
        <button
          class="btn btn--ghost btn--sm"
          type="button"
          disabled={notifications.itemsLoadingMore}
          onclick={() => notifications.load()}
        >
          {#if notifications.itemsLoadingMore}
            <span class="spinner"></span>
            Carregando…
          {:else}
            Carregar mais
          {/if}
        </button>
      </div>
    {/if}
  </div>
{/if}
