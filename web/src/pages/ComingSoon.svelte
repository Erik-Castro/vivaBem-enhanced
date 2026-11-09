<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import type { IconName } from "../lib/icons";

  let {
    icon,
    title,
    description,
  }: {
    icon: IconName;
    title: string;
    description: string;
  } = $props();
</script>

<div class="page-head">
  <div>
    <p class="eyebrow">Próximas entregas</p>
    <h2>{title}</h2>
    <p class="page-subtitle">Esta área ainda está sendo construída.</p>
  </div>
</div>

<div class="card">
  <div class="soon">
    <span class="soon__icon"><Icon name={icon} size={30} /></span>
    <span class="badge badge--soon">em breve</span>
    <h3>{title}</h3>
    <p>{description}</p>
    <a class="btn btn--soft" href="#/dashboard">
      <Icon name="arrowLeft" size={18} />
      Voltar ao painel
    </a>
  </div>
</div>
