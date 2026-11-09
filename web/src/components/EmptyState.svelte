<script lang="ts">
  import type { Snippet } from "svelte";
  import type { IconName } from "../lib/icons";
  import Icon from "./Icon.svelte";

  let {
    icon = "sparkles",
    title,
    description,
    action,
  }: {
    icon?: IconName;
    title: string;
    description?: string;
    action?: Snippet;
  } = $props();
</script>

<div class="empty">
  <span class="empty__icon"><Icon name={icon} size={26} /></span>
  <h3>{title}</h3>
  {#if description}<p>{description}</p>{/if}
  {#if action}<div class="empty__action">{@render action()}</div>{/if}
</div>
