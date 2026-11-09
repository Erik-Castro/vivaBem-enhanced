<script lang="ts">
  import Icon from "../components/Icon.svelte";
</script>

<div class="card">
  <div class="soon">
    <span class="soon__icon"><Icon name="search" size={30} /></span>
    <h3>Página não encontrada</h3>
    <p>O endereço que você abriu não existe ou foi movido.</p>
    <a class="btn btn--primary" href="#/dashboard">
      <Icon name="arrowLeft" size={18} />
      Ir para o painel
    </a>
  </div>
</div>
