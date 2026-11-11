<script lang="ts">
  import Icon from "./Icon.svelte";
  import { errorMessage } from "../lib/api";
  import { formatRelativeTime } from "../lib/format";
  import {
    notificationCategoryIcon,
    notificationCategoryLabel,
    notificationSeverityLabel,
  } from "../lib/labels";
  import { notifications, resolveNotificationLink } from "../lib/notifications.svelte";
  import { router } from "../lib/router.svelte";
  import { toasts } from "../lib/toast.svelte";
  import type { Notification } from "../lib/types";

  // `onOpened` permite ao sino fechar o painel mesmo quando o link aponta
  // para a rota atual (nesse caso a rota não muda e o efeito não dispara).
  let { notification, onOpened }: { notification: Notification; onOpened?: () => void } = $props();

  let busy = $state(false);

  const label = $derived(
    `${notification.title}${notification.isRead ? "" : " (não lida)"}`,
  );

  async function open(): Promise<void> {
    if (busy) return;

    busy = true;

    try {
      if (!notification.isRead) await notifications.markRead(notification.id);

      const target = resolveNotificationLink(notification.link);
      if (target) router.navigate(target);
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      busy = false;
      onOpened?.();
    }
  }

  async function markAsRead(): Promise<void> {
    if (busy) return;

    busy = true;

    try {
      await notifications.markRead(notification.id);
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      busy = false;
    }
  }
</script>

<div class="notif-item" class:notif-item--unread={!notification.isRead}>
  <button
    class="notif-item__main"
    type="button"
    aria-label={label}
    disabled={busy}
    onclick={open}
  >
    <span class="notif-item__icon">
      <Icon name={notificationCategoryIcon(notification.category)} size={18} />
    </span>
    <span class="notif-item__body">
      <span class="notif-item__head">
        <span class="notif-item__title">{notification.title}</span>
        {#if !notification.isRead}
          <span class="notif-item__dot" aria-hidden="true"></span>
        {/if}
      </span>
      <span class="notif-item__message">{notification.message}</span>
      <span class="notif-item__meta">
        <span class={`notif-item__severity notif-item__severity--${notification.severity}`}>
          {notificationSeverityLabel(notification.severity)}
        </span>
        <span aria-hidden="true">·</span>
        <span>{notificationCategoryLabel(notification.category)}</span>
        <span aria-hidden="true">·</span>
        <time datetime={notification.createdAt}>
          {formatRelativeTime(notification.createdAt)}
        </time>
      </span>
    </span>
  </button>

  {#if !notification.isRead}
    <button
      class="notif-item__read"
      type="button"
      title="Marcar como lida"
      aria-label={`Marcar "${notification.title}" como lida`}
      disabled={busy}
      onclick={markAsRead}
    >
      <Icon name="check" size={14} />
    </button>
  {/if}
</div>
