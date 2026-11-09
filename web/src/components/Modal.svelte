<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  let {
    open,
    title,
    onclose,
    children,
    footer,
  }: {
    open: boolean;
    title: string;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
  } = $props();

  $effect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onclose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  });
</script>

{#if open}
  <div class="modal-layer">
    <button class="modal-backdrop" type="button" aria-label="Fechar" onclick={onclose}></button>
    <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
      <header class="modal-head">
        <h2>{title}</h2>
        <button class="btn btn--icon btn--ghost" type="button" aria-label="Fechar" onclick={onclose}>
          <Icon name="close" />
        </button>
      </header>
      <div class="modal-body">
        {@render children()}
      </div>
      {#if footer}
        <footer class="modal-foot">
          {@render footer()}
        </footer>
      {/if}
    </div>
  </div>
{/if}
