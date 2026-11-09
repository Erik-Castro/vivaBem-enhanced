<script lang="ts">
  let { label = "Carregando" }: { label?: string } = $props();
</script>

<span class="spinner" role="status" aria-label={label}></span>
