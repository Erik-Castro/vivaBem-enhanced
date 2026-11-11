<script lang="ts">
  import Icon from "./Icon.svelte";
  import { notifications } from "../lib/notifications.svelte";
</script>

<button
  class="btn btn--icon btn--ghost notif-bell"
  type="button"
  title="Notificações"
  aria-label={notifications.unread > 0
    ? `Notificações (${notifications.unread === 1 ? "1 não lida" : `${notifications.unread} não lidas`})`
    : "Notificações"}
  aria-haspopup="dialog"
  aria-expanded={notifications.panelOpen}
  onclick={() => void notifications.togglePanel()}
>
  <Icon name="bell" />
  {#if notifications.unread > 0}
    <span class="notif-bell__badge" aria-hidden="true">
      {notifications.unread > 9 ? "9+" : notifications.unread}
    </span>
  {/if}
</button>
