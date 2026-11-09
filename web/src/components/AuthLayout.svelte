<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import type { IconName } from "../lib/icons";

  let {
    title,
    subtitle,
    children,
    footer,
  }: {
    title: string;
    subtitle: string;
    children: Snippet;
    footer?: Snippet;
  } = $props();

  const highlights: { icon: IconName; text: string }[] = [
    { icon: "wallet", text: "Contas, transações e categorias em um só lugar" },
    { icon: "chart", text: "Resumo mensal claro, sem planilhas" },
    { icon: "heart", text: "Hábitos e metas para sustentar a mudança" },
  ];
</script>

<div class="auth-page">
  <aside class="auth-aside">
    <a class="auth-brand" href="#/login">
      <span class="brand-mark"><Icon name="check" size={18} /></span>
      <span>Viva Bem</span>
    </a>

    <div class="auth-pitch">
      <p class="eyebrow">Finanças + hábitos</p>
      <h1>Cuide do seu dinheiro.<br />Construa bons hábitos.</h1>
      <p class="auth-pitch__text">
        Uma visão simples do que entra, do que sai e do que você está construindo todos os dias.
      </p>
    </div>

    <ul class="auth-highlights">
      {#each highlights as highlight}
        <li>
          <span class="auth-highlights__icon"><Icon name={highlight.icon} size={18} /></span>
          {highlight.text}
        </li>
      {/each}
    </ul>

    <p class="auth-aside__foot">Viva Bem · seus dados ficam com você</p>
  </aside>

  <main class="auth-main">
    <div class="auth-card">
      <div class="auth-card__brand">
        <span class="brand-mark"><Icon name="check" size={18} /></span>
        <span>Viva Bem</span>
      </div>
      <header class="auth-card__head">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </header>
      {@render children()}
      {#if footer}<div class="auth-card__foot">{@render footer()}</div>{/if}
    </div>
  </main>
</div>
