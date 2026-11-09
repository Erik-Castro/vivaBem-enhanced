<script lang="ts">
  import { onMount } from "svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Icon from "../components/Icon.svelte";
  import InvestmentDetailModal from "../components/InvestmentDetailModal.svelte";
  import InvestmentFormModal from "../components/InvestmentFormModal.svelte";
  import { api, errorMessage } from "../lib/api";
  import { formatMoney, formatPercent, formatQuantity } from "../lib/format";
  import { toasts } from "../lib/toast.svelte";
  import type {
    Account,
    Investment,
    InvestmentPosition,
    PortfolioTotal,
  } from "../lib/types";

  type Tab = "portfolio" | "assets";

  let investments = $state<Investment[]>([]);
  let positions = $state<InvestmentPosition[]>([]);
  let totals = $state<PortfolioTotal[]>([]);
  let accounts = $state<Account[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let tab = $state<Tab>("portfolio");
  let formOpen = $state(false);
  let editingInvestment = $state<Investment | null>(null);
  let detailOpen = $state(false);
  let detailInvestment = $state<Investment | null>(null);
  let busy = $state<string | null>(null);

  const openPositions = $derived(positions.filter((position) => position.operationCount > 0));
  const positionByInvestment = $derived(
    new Map(positions.map((position) => [position.investmentId, position] as const)),
  );

  async function load(): Promise<void> {
    loading = true;
    error = null;

    try {
      const [assetsPayload, portfolioPayload, accountsPayload] = await Promise.all([
        api<{ investments: Investment[] }>("/investments"),
        api<{ positions: InvestmentPosition[]; totals: PortfolioTotal[] }>(
          "/investments/portfolio",
        ),
        api<{ accounts: Account[] }>("/accounts"),
      ]);

      investments = assetsPayload.investments;
      positions = portfolioPayload.positions;
      totals = portfolioPayload.totals;
      accounts = accountsPayload.accounts;
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  function openCreate(): void {
    editingInvestment = null;
    formOpen = true;
  }

  function openEdit(investment: Investment): void {
    editingInvestment = investment;
    formOpen = true;
  }

  function openDetail(investment: Investment): void {
    detailInvestment = investment;
    detailOpen = true;
  }

  function openDetailById(investmentId: string): void {
    const investment = investments.find((entry) => entry.id === investmentId);
    if (investment) openDetail(investment);
  }

  async function removeInvestment(investment: Investment): Promise<void> {
    if (
      !window.confirm(
        `Remover "${investment.ticker}"? As operações e cotações ficam preservadas para auditoria.`,
      )
    ) {
      return;
    }

    busy = investment.id;

    try {
      await api(`/investments/${investment.id}`, { method: "DELETE" });
      toasts.success("Ativo removido");
      await load();
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      busy = null;
    }
  }

  function pnlClass(value: number): string {
    if (value > 0) return "value--positive";
    if (value < 0) return "value--negative";
    return "muted";
  }

  onMount(load);
</script>

<div class="page-head">
  <div>
    <p class="eyebrow">Patrimônio</p>
    <h2>Investimentos</h2>
    <p class="page-subtitle">
      Registre operações, acompanhe cotações e veja a performance da carteira.
    </p>
  </div>
  <div class="page-actions">
    <button class="btn btn--primary" type="button" onclick={openCreate}>
      <Icon name="plus" size={18} />
      Novo ativo
    </button>
  </div>
</div>

<div class="toolbar">
  <div class="tabs" role="tablist" aria-label="Seções de investimentos">
    <button
      class="tab"
      class:active={tab === "portfolio"}
      type="button"
      role="tab"
      aria-selected={tab === "portfolio"}
      onclick={() => (tab = "portfolio")}
    >
      Carteira
      <span class="tab__count">{openPositions.length}</span>
    </button>
    <button
      class="tab"
      class:active={tab === "assets"}
      type="button"
      role="tab"
      aria-selected={tab === "assets"}
      onclick={() => (tab = "assets")}
    >
      Ativos
      <span class="tab__count">{investments.length}</span>
    </button>
  </div>
</div>

{#if loading}
  <div class="grid grid--cards">
    {#each [1, 2, 3] as item}
      <div class="card skeleton-card" aria-hidden="true">
        <span class="skeleton skeleton--title"></span>
        <span class="skeleton skeleton--text"></span>
        <span class="skeleton skeleton--value"></span>
        <span class="skeleton skeleton--row"></span>
      </div>
    {/each}
  </div>
{:else if error}
  <div class="notice notice--error" role="alert">
    <Icon name="alert" />
    <div>
      <strong>Não foi possível carregar os investimentos</strong>
      <p>{error}</p>
    </div>
    <button class="btn btn--soft" type="button" onclick={load}>Tentar novamente</button>
  </div>
{:else if investments.length === 0}
  <div class="card">
    <EmptyState
      icon="piggy"
      title="Nenhum ativo cadastrado"
      description="Cadastre um ativo, registre compras e vendas e acompanhe a valorização com cotações."
    >
      {#snippet action()}
        <button class="btn btn--primary" type="button" onclick={openCreate}>
          Criar ativo
        </button>
      {/snippet}
    </EmptyState>
  </div>
{:else if tab === "portfolio"}
  {#if openPositions.length === 0}
    <div class="card">
      <EmptyState
        icon="chart"
        title="Carteira vazia"
        description="Registre a primeira operação em um ativo para começar a acompanhar a carteira."
      >
        {#snippet action()}
          <button class="btn btn--soft" type="button" onclick={() => (tab = "assets")}>
            Ver ativos
          </button>
        {/snippet}
      </EmptyState>
    </div>
  {:else}
    <section class="grid grid--cards investment-totals" aria-label="Totais por moeda">
      {#each totals as total (total.currencyCode)}
        <article class="card investment-total">
          <header class="investment-total__head">
            <h3>{total.currencyCode}</h3>
            <span class="muted">
              {total.pricedCount} de {total.investmentCount} com cotação
            </span>
          </header>

          <div class="investment-total__value">
            <span class="stat__label">Valor de mercado</span>
            <strong>{formatMoney(total.marketValueMinor, total.currencyCode)}</strong>
          </div>

          <dl class="investment-total__rows">
            <div>
              <dt>Custo</dt>
              <dd>{formatMoney(total.costBasisMinor, total.currencyCode)}</dd>
            </div>
            <div>
              <dt>Resultado</dt>
              <dd class={pnlClass(total.totalPnlMinor)}>
                {formatMoney(total.totalPnlMinor, total.currencyCode)}
              </dd>
            </div>
            <div>
              <dt>Proventos</dt>
              <dd>{formatMoney(total.dividendsMinor, total.currencyCode)}</dd>
            </div>
            <div>
              <dt>Taxas</dt>
              <dd>{formatMoney(total.feesMinor, total.currencyCode)}</dd>
            </div>
          </dl>

          {#if !total.valuationComplete}
            <p class="hint">Há posições abertas sem cotação; o valor de mercado está incompleto.</p>
          {/if}
        </article>
      {/each}
    </section>

    <section class="card card--flush" aria-label="Posições">
      <ul class="investment-list">
        {#each openPositions as position (position.investmentId)}
          <li class="investment-row">
            <div class="investment-row__title">
              <span class="investment-ticker">{position.ticker}</span>
              <div class="investment-row__name">
                <strong>{position.name}</strong>
                <span class="hint">
                  {position.assetClass} · {formatQuantity(position.quantity)} un. · média
                  {formatMoney(position.averageCostMinor, position.currencyCode)}
                </span>
              </div>
            </div>

            <div class="investment-row__values">
              <div>
                <span class="stat__label">Mercado</span>
                <strong>
                  {position.marketValueMinor === null
                    ? "—"
                    : formatMoney(position.marketValueMinor, position.currencyCode)}
                </strong>
              </div>
              <div>
                <span class="stat__label">Resultado</span>
                <strong class={pnlClass(position.totalPnlMinor)}>
                  {formatMoney(position.totalPnlMinor, position.currencyCode)}
                </strong>
              </div>
              <div>
                <span class="stat__label">Retorno</span>
                <strong class={pnlClass(position.returnPercent)}>
                  {formatPercent(position.returnPercent)}
                </strong>
              </div>
            </div>

            <button
              class="btn btn--ghost btn--sm"
              type="button"
              onclick={() => openDetailById(position.investmentId)}
            >
              Detalhes
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
{:else}
  <section class="card card--flush" aria-label="Ativos">
    <ul class="investment-list">
      {#each investments as investment (investment.id)}
        {@const position = positionByInvestment.get(investment.id)}
        <li class="investment-row">
          <div class="investment-row__title">
            <span class="investment-ticker">{investment.ticker}</span>
            <div class="investment-row__name">
              <strong>{investment.name}</strong>
              <span class="hint">
                {investment.assetClass} · {investment.currencyCode}
                {#if position}
                  · {position.operationCount} operação(ões)
                {/if}
              </span>
            </div>
          </div>

          <div class="investment-row__actions">
            <button
              class="btn btn--ghost btn--sm"
              type="button"
              onclick={() => openDetail(investment)}
            >
              Detalhes
            </button>
            <button
              class="btn btn--icon btn--ghost btn--sm"
              type="button"
              title="Editar"
              aria-label={`Editar ${investment.ticker}`}
              onclick={() => openEdit(investment)}
            >
              <Icon name="edit" size={16} />
            </button>
            <button
              class="btn btn--icon btn--ghost btn--sm"
              type="button"
              title="Remover"
              aria-label={`Remover ${investment.ticker}`}
              disabled={busy === investment.id}
              onclick={() => removeInvestment(investment)}
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<InvestmentFormModal
  open={formOpen}
  investment={editingInvestment}
  currencyLocked={editingInvestment !== null &&
    (positionByInvestment.get(editingInvestment.id)?.operationCount ?? 0) > 0}
  onclose={() => {
    formOpen = false;
    editingInvestment = null;
  }}
  onsaved={() => void load()}
/>

<InvestmentDetailModal
  open={detailOpen}
  investment={detailInvestment}
  {accounts}
  onclose={() => {
    detailOpen = false;
    detailInvestment = null;
  }}
  onchanged={() => void load()}
/>
