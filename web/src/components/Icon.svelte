<script lang="ts">
  import { iconPaths, type IconName } from "../lib/icons";

  let {
    name,
    size = 20,
    strokeWidth = 1.8,
    label,
  }: {
    name: IconName;
    size?: number;
    strokeWidth?: number;
    label?: string;
  } = $props();

  const paths = $derived(iconPaths[name]);
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? "img" : undefined}
  aria-hidden={label ? undefined : "true"}
>
  {#if label}<title>{label}</title>{/if}
  {#each paths as path}
    <path d={path} />
  {/each}
</svg>
