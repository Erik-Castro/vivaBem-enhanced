<script lang="ts">
  import { toasts } from "../lib/toast.svelte";
  import Icon from "./Icon.svelte";
</script>

<div class="toast-host" aria-live="polite" aria-atomic="false">
  {#each toasts.items as toast (toast.id)}
    <div class="toast toast--{toast.tone}" role="status">
      <Icon
        name={toast.tone === "success" ? "check" : toast.tone === "error" ? "alert" : "info"}
        size={18}
      />
      <span>{toast.message}</span>
      <button
        class="toast__close"
        type="button"
        aria-label="Fechar aviso"
        onclick={() => toasts.dismiss(toast.id)}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  {/each}
</div>
