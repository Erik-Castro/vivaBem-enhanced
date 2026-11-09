<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import {
    formatDate,
    formatDateTime,
    formatMoney,
    formatPercent,
    formatQuantity,
    todayISO,
    toMinorUnits,
  } from "../lib/format";
  import { investmentOperationLabel, investmentOperationOptions } from "../lib/labels";
  import { toasts } from "../lib/toast.svelte";
  import type {
    Account,
    Investment,
    InvestmentOperationType,
    InvestmentPosition,
    InvestmentQuote,
    InvestmentTransaction,
  } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";

  let {
    open,
    investment = null,
    accounts,
    onclose,
    onchanged,
  }: {
    open: boolean;
    investment?: Investment | null;
    accounts: readonly Account[];
    onclose: () => void;
    onchanged: () => void;
  } = $props();

  let position = $state<InvestmentPosition | null>(null);
  let transactions = $state<InvestmentTransaction[]>([]);
  let quotes = $state<InvestmentQuote[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let showOperationForm = $state(false);
  let showQuoteForm = $state(false);
  let operationType = $state<InvestmentOperationType>("buy");
  let accountId = $state("");
  let quantity = $state("");
  let unitPrice = $state("");
  let fees = $state("");
  let operationDate = $state(todayISO());
  let quotePrice = $state("");
  let quoteSource = $state("");
  let saving = $state(false);
  let formError = $state<string | null>(null);

  const availableAccounts = $derived(
    investment === null
      ? []
      : accounts.filter(
        (account) => account.isActive && account.currencyCode === investment.currencyCode,
      ),
  );
  const needsQuantity = $derived(operationType !== "fee");
  const needsPrice = $derived(operationType !== "fee");

  $effect(() => {
    if (!open || investment === null) return;

    showOperationForm = false;
    showQuoteForm = false;
    formError = null;
    operationType = "buy";
    quantity = "";
    unitPrice = "";
    fees = "";
    operationDate = todayISO();
    quotePrice = "";
    quoteSource = "";
    accountId = availableAccounts[0]?.id ?? "";

    void load(investment.id);
  });

  async function load(investmentId: string): Promise<void> {
    loading = true;
    error = null;

    try {
      const [perfPayload, txPayload, quotePayload] = await Promise.all([
        api<{ performance: InvestmentPosition }>(`/investments/${investmentId}/performance`),
        api<{ transactions: InvestmentTransaction[] }>(
          `/investments/${investmentId}/transactions`,
          { query: { limit: 50 } },
        ),
        api<{ quotes: InvestmentQuote[] }>(`/investments/${investmentId}/quotes`, {
          query: { limit: 50 },
        }),
      ]);

      position = perfPayload.performance;
      transactions = txPayload.transactions;
      quotes = quotePayload.quotes;
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  function resetForms(): void {
    formError = null;
    showOperationForm = false;
    showQuoteForm = false;
  }

  async function saveOperation(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (investment === null || saving) return;

    formError = null;

    if (accountId === "") {
      formError = "Selecione a conta da operação.";
      return;
    }

    const numericQuantity = Number(quantity.replace(",", "."));
    const unitPriceMinor = toMinorUnits(unitPrice);
    const feesMinor = fees.trim() === "" ? 0 : toMinorUnits(fees);

    if (needsQuantity && (!Number.isFinite(numericQuantity) || numericQuantity <= 0)) {
      formError = "Informe a quantidade da operação.";
      return;
    }

    if (needsPrice && unitPriceMinor <= 0) {
      formError = "Informe o preço unitário.";
      return;
    }

    if (operationType === "fee" && feesMinor <= 0) {
      formError = "Informe a taxa da operação.";
      return;
    }

    saving = true;

    try {
      await api(`/investments/${investment.id}/transactions`, {
        method: "POST",
        body: {
          accountId,
          operationType,
          quantity: needsQuantity ? numericQuantity : undefined,
          unitPriceMinor: needsPrice ? unitPriceMinor : undefined,
          feesMinor,
          operationDate,
        },
      });

      toasts.success("Operação registrada");
      showOperationForm = false;
      quantity = "";
      unitPrice = "";
      fees = "";
      await load(investment.id);
      onchanged();
    } catch (cause) {
      formError = errorMessage(cause);
    } finally {
      saving = false;
    }
  }

  async function saveQuote(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (investment === null || saving) return;

    formError = null;

    const priceMinor = toMinorUnits(quotePrice);

    if (priceMinor <= 0) {
      formError = "Informe o preço da cotação.";
      return;
    }

    saving = true;

    try {
      await api(`/investments/${investment.id}/quotes`, {
        method: "POST",
        body: {
          priceMinor,
          source: quoteSource.trim() === "" ? null : quoteSource.trim(),
        },
      });

      toasts.success("Cotação registrada");
      showQuoteForm = false;
      quotePrice = "";
      quoteSource = "";
      await load(investment.id);
      onchanged();
    } catch (cause) {
      formError = errorMessage(cause);
    } finally {
      saving = false;
    }
  }

  function operationQuantity(transaction: InvestmentTransaction): string {
    if (transaction.operationType === "fee") return "—";
    return formatQuantity(transaction.quantity);
  }

  function operationPrice(transaction: InvestmentTransaction): string {
    if (transaction.operationType === "fee") return "—";
    return formatMoney(transaction.unitPriceMinor, investment?.currencyCode ?? "BRL");
  }

  function pnlClass(value: number): string {
    if (value > 0) return "value--positive";
    if (value < 0) return "value--negative";
    return "muted";
  }
</script>

<Modal {open} title={investment ? `${investment.ticker} — ${investment.name}` : "Ativo"} {onclose}>
  {#if investment === null}
    <p class="muted">Selecione um ativo.</p>
  {:else}
    <div class="investment-detail">
      <div class="investment-detail__badges">
        <span class="badge badge--soon">{investment.assetClass}</span>
        <span class="badge badge--pending">{investment.currencyCode}</span>
        {#if position && position.operationCount > 0}
          <span class="badge badge--active">{position.operationCount} operação(ões)</span>
        {/if}
      </div>

      {#if loading}
        <p class="muted">Carregando o ativo…</p>
      {:else if error}
        <div class="form-error" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
        </div>
      {:else if position}
        <div class="grid grid--stats investment-stats">
          <div class="stat">
            <span class="stat__label">Quantidade</span>
            <strong class="stat__value">{formatQuantity(position.quantity)}</strong>
            <span class="stat__hint">Preço médio {formatMoney(position.averageCostMinor, investment.currencyCode)}</span>
          </div>
          <div class="stat">
            <span class="stat__label">Preço atual</span>
            <strong class="stat__value">
              {position.currentPriceMinor === null
                ? "Sem cotação"
                : formatMoney(position.currentPriceMinor, investment.currencyCode)}
            </strong>
            <span class="stat__hint">
              {position.quoteQuotedAt
                ? `Em ${formatDateTime(position.quoteQuotedAt)}`
                : "Registre uma cotação"}
            </span>
          </div>
          <div class="stat">
            <span class="stat__label">Valor de mercado</span>
            <strong class="stat__value">
              {position.marketValueMinor === null
                ? "—"
                : formatMoney(position.marketValueMinor, investment.currencyCode)}
            </strong>
            <span class="stat__hint">Custo {formatMoney(position.costBasisMinor, investment.currencyCode)}</span>
          </div>
          <div class="stat">
            <span class="stat__label">Resultado total</span>
            <strong class="stat__value {pnlClass(position.totalPnlMinor)}">
              {formatMoney(position.totalPnlMinor, investment.currencyCode)}
            </strong>
            <span class="stat__hint {pnlClass(position.returnPercent)}">
              {formatPercent(position.returnPercent)} de retorno
            </span>
          </div>
        </div>

        <div class="investment-detail__breakdown">
          <span>Investido {formatMoney(position.investedMinor, investment.currencyCode)}</span>
          <span>Proventos {formatMoney(position.dividendsMinor, investment.currencyCode)}</span>
          <span>Taxas {formatMoney(position.feesMinor, investment.currencyCode)}</span>
          <span>Realizado {formatMoney(position.realizedPnlMinor, investment.currencyCode)}</span>
        </div>

        {#if formError}
          <div class="form-error" role="alert">
            <Icon name="alert" size={18} />
            <span>{formError}</span>
          </div>
        {/if}

        <div class="investment-detail__section">
          <div class="investment-detail__section-head">
            <h3>Operações</h3>
            <button
              class="btn btn--soft btn--sm"
              type="button"
              onclick={() => {
                resetForms();
                showOperationForm = true;
              }}
            >
              <Icon name="plus" size={15} />
              Nova operação
            </button>
          </div>

          {#if showOperationForm}
            <form class="investment-form" onsubmit={saveOperation} novalidate>
              <div class="form-grid form-grid--two">
                <label class="field">
                  <span>Tipo</span>
                  <select class="select" bind:value={operationType}>
                    {#each investmentOperationOptions as option (option.value)}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                </label>

                <label class="field">
                  <span>Conta</span>
                  <select class="select" bind:value={accountId}>
                    <option value="">Selecione</option>
                    {#each availableAccounts as account (account.id)}
                      <option value={account.id}>{account.name}</option>
                    {/each}
                  </select>
                  {#if availableAccounts.length === 0}
                    <small class="hint">
                      Crie uma conta ativa em {investment.currencyCode} para registrar operações.
                    </small>
                  {/if}
                </label>
              </div>

              <div class="form-grid form-grid--two">
                {#if needsQuantity}
                  <label class="field">
                    <span>Quantidade</span>
                    <input
                      class="input"
                      type="text"
                      inputmode="decimal"
                      placeholder="10"
                      bind:value={quantity}
                    />
                  </label>
                {/if}

                {#if needsPrice}
                  <label class="field">
                    <span>
                      {operationType === "dividend" ? "Valor por unidade" : "Preço unitário"}
                    </span>
                    <input
                      class="input"
                      type="text"
                      inputmode="decimal"
                      placeholder="0,00"
                      bind:value={unitPrice}
                    />
                  </label>
                {/if}

                <label class="field">
                  <span>Taxas (opcional)</span>
                  <input
                    class="input"
                    type="text"
                    inputmode="decimal"
                    placeholder="0,00"
                    bind:value={fees}
                  />
                </label>

                <label class="field">
                  <span>Data</span>
                  <input class="input" type="date" max={todayISO()} bind:value={operationDate} />
                </label>
              </div>

              <div class="form-actions">
                <button
                  class="btn btn--ghost btn--sm"
                  type="button"
                  onclick={() => (showOperationForm = false)}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button class="btn btn--primary btn--sm" type="submit" disabled={saving}>
                  {#if saving}<Spinner label="Salvando" />{/if}
                  Registrar operação
                </button>
              </div>
            </form>
          {/if}

          {#if transactions.length === 0}
            <p class="muted">Nenhuma operação registrada.</p>
          {:else}
            <ul class="investment-history">
              {#each transactions as transaction (transaction.id)}
                <li class="investment-history__row">
                  <span class="badge badge--soon">{investmentOperationLabel(transaction.operationType)}</span>
                  <div class="investment-history__main">
                    <strong>{operationQuantity(transaction)}</strong>
                    <span class="muted">{operationPrice(transaction)}</span>
                    <span class="hint">
                      {formatDate(transaction.operationDate)} · {transaction.accountName}
                      {#if transaction.feesMinor > 0}
                        · taxas {formatMoney(transaction.feesMinor, investment.currencyCode)}
                      {/if}
                    </span>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <div class="investment-detail__section">
          <div class="investment-detail__section-head">
            <h3>Cotações</h3>
            <button
              class="btn btn--soft btn--sm"
              type="button"
              onclick={() => {
                resetForms();
                showQuoteForm = true;
              }}
            >
              <Icon name="plus" size={15} />
              Nova cotação
            </button>
          </div>

          {#if showQuoteForm}
            <form class="investment-form" onsubmit={saveQuote} novalidate>
              <div class="form-grid form-grid--two">
                <label class="field">
                  <span>Preço</span>
                  <input
                    class="input"
                    type="text"
                    inputmode="decimal"
                    placeholder="0,00"
                    required
                    bind:value={quotePrice}
                  />
                </label>

                <label class="field">
                  <span>Fonte (opcional)</span>
                  <input
                    class="input"
                    type="text"
                    maxlength="60"
                    placeholder="B3, corretora…"
                    bind:value={quoteSource}
                  />
                </label>
              </div>

              <div class="form-actions">
                <button
                  class="btn btn--ghost btn--sm"
                  type="button"
                  onclick={() => (showQuoteForm = false)}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button class="btn btn--primary btn--sm" type="submit" disabled={saving}>
                  {#if saving}<Spinner label="Salvando" />{/if}
                  Registrar cotação
                </button>
              </div>
            </form>
          {/if}

          {#if quotes.length === 0}
            <p class="muted">Nenhuma cotação registrada.</p>
          {:else}
            <ul class="investment-history">
              {#each quotes as quote (quote.id)}
                <li class="investment-history__row">
                  <div class="investment-history__main">
                    <strong>{formatMoney(quote.priceMinor, investment.currencyCode)}</strong>
                    <span class="hint">
                      {formatDateTime(quote.quotedAt)}
                      {#if quote.source}
                        · {quote.source}
                      {/if}
                    </span>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</Modal>
