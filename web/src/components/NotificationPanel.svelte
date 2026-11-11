<script lang="ts">
  import Icon from "./Icon.svelte";
  import NotificationItem from "./NotificationItem.svelte";
  import { errorMessage } from "../lib/api";
  import { notifications } from "../lib/notifications.svelte";
  import { router } from "../lib/router.svelte";
  import { toasts } from "../lib/toast.svelte";

  let markingAll = $state(false);

  const unreadLabel = $derived(
    notifications.unread === 1 ? "1 não lida" : `${notifications.unread} não lidas`,
  );

  // O layer é renderizado fora do topbar: `backdrop-filter` no topbar cria um
  // containing block para `position: fixed` e quebraria o bottom sheet no mobile.
  $effect(() => {
    router.path;
    notifications.closePanel();
  });

  $effect(() => {
    if (!notifications.panelOpen) return;

    function onKeydown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      close();
    }

    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  });

  function focusBell(): void {
    document.querySelector<HTMLButtonElement>(".notif-bell")?.focus();
  }

  function close(): void {
    notifications.closePanel();
    focusBell();
  }

  function viewAll(): void {
    notifications.closePanel();
    router.navigate("/notifications");
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

{#if notifications.panelOpen}
  <div class="notif-layer">
    <button
      class="notif-backdrop"
      type="button"
      aria-label="Fechar notificações"
      onclick={close}
    ></button>

    <div class="notif-panel" role="dialog" aria-label="Notificações">
      <header class="notif-panel__head">
        <div>
          <strong class="notif-panel__title">Notificações</strong>
          {#if notifications.unread > 0}
            <span class="notif-panel__count">{unreadLabel}</span>
          {/if}
        </div>
        {#if notifications.unread > 0}
          <button
            class="btn btn--ghost btn--sm"
            type="button"
            disabled={markingAll}
            onclick={markAll}
          >
            Marcar todas
          </button>
        {/if}
      </header>

      {#if notifications.recentLoading && notifications.recent.length === 0}
        <div class="notif-panel__loading">
          <span class="spinner"></span>
        </div>
      {:else if notifications.recent.length === 0}
        <div class="notif-panel__empty">
          <Icon name="bell" size={22} />
          <p>Nenhuma notificação por aqui.</p>
        </div>
      {:else}
        <div class="notif-panel__list">
          {#each notifications.recent as notification (notification.id)}
            <NotificationItem {notification} onOpened={close} />
          {/each}
        </div>
      {/if}

      <footer class="notif-panel__foot">
        <button class="btn btn--soft btn--block" type="button" onclick={viewAll}>
          Ver todas
        </button>
      </footer>
    </div>
  </div>
{/if}
