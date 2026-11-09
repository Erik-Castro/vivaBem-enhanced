<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { formatDate, formatMoney, todayISO, toMinorUnits } from "../lib/format";
  import { toasts } from "../lib/toast.svelte";
  import type { Account, GoalProgress } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";

  let {
    open,
    progress,
    accounts,
    onclose,
    onchanged,
  }: {
    open: boolean;
    progress: GoalProgress | null;
    accounts: readonly Account[];
    onclose: () => void;
    onchanged: () => void;
  } = $props();

  let current = $state<GoalProgress | null>(null);
  let amount = $state("");
  let contributionDate = $state(todayISO());
  let accountId = $state("");
  let note = $state("");
  let saving = $state(false);
  let removing = $state<string | null>(null);
  let error = $state<string | null>(null);

  const goal = $derived(current?.goal ?? null);
  const currencyCode = $derived(goal?.currencyCode ?? "BRL");
  const currencySymbol = $derived(
    currencyCode === "USD" ? "US$" : currencyCode === "EUR" ? "€" : "R$",
  );
  const cancelled = $derived(goal?.status === "cancelled");
  const accountOptions = $derived(
    accounts.filter((account) => account.isActive || account.id === accountId),
  );
  const barWidth = $derived(
    current === null ? "0%" : `${Math.min(100, Math.max(3, Math.round(current.progressPercent)))}%`,
  );

  $effect(() => {
    if (!open) return;

    current = progress;
    amount = "";
    contributionDate = todayISO();
    accountId = "";
    note = "";
    error = null;
  });

  async function addContribution(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (saving || goal === null) return;

    error = null;

    const amountMinor = toMinorUnits(amount);

    if (amountMinor <= 0) {
      error = "Informe um valor maior que zero.";
      return;
    }

    if (contributionDate === "") {
      error = "Informe a data da contribuição.";
      return;
    }

    saving = true;

    try {
      const result = await api<{ progress: GoalProgress }>(
        `/goals/${goal.id}/contributions`,
        {
          method: "POST",
          body: {
            amountMinor,
            contributionDate,
            accountId: accountId === "" ? null : accountId,
            note: note.trim() === "" ? null : note.trim(),
          },
        },
      );

      current = result.progress;
      amount = "";
      note = "";
      toasts.success("Contribuição registrada");
      onchanged();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      saving = false;
    }
  }

  async function removeContribution(contributionId: string): Promise<void> {
    if (goal === null) return;
    if (!window.confirm("Remover esta contribuição? O progresso será recalculado.")) return;

    removing = contributionId;

    try {
      const result = await api<{ progress: GoalProgress }>(
        `/goals/${goal.id}/contributions/${contributionId}`,
        { method: "DELETE" },
      );

      current = result.progress;
      toasts.success("Contribuição removida");
      onchanged();
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      removing = null;
    }
  }
</script>

<Modal {open} title={goal ? goal.name : "Detalhes da meta"} {onclose}>
  {#if current === null}
    <p class="muted">Carregando…</p>
  {:else}
    <div class="goal-detail">
      <div class="goal-detail__summary">
        <div>
          <span class="stat__label">Contribuído</span>
          <strong class="stat__value">
            {formatMoney(current.contributedMinor, currencyCode)}
          </strong>
          <span class="hint">de {formatMoney(current.goal.targetAmountMinor, currencyCode)}</span>
        </div>
        <div class="right">
          <span class="badge {current.isCompleted ? 'badge--active' : 'badge--soon'}">
            {Math.round(current.progressPercent)}%
          </span>
        </div>
      </div>

      <div
        class="bar-track"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.min(100, Math.round(current.progressPercent))}
        aria-label="Progresso da meta"
      >
        <span
          class="bar-fill"
          class:bar-fill--success={current.isCompleted}
          style:width={barWidth}
        ></span>
      </div>

      <div class="goal-detail__meta">
        <span class:negative={current.remainingMinor > 0}>
          {current.remainingMinor > 0
            ? `${formatMoney(current.remainingMinor, currencyCode)} restantes`
            : "Meta atingida"}
        </span>
        <span>{current.contributionCount} contribuição(ões)</span>
        {#if current.goal.targetDate}
          <span>Alvo em {formatDate(current.goal.targetDate)}</span>
        {/if}
      </div>

      {#if cancelled}
        <div class="notice">
          <Icon name="alert" />
          <div>
            <strong>Meta cancelada</strong>
            <p>Metas canceladas não aceitam novas contribuições.</p>
          </div>
        </div>
      {:else}
        <form class="goal-contribution-form" onsubmit={addContribution} novalidate>
          {#if error}
            <div class="form-error" role="alert">
              <Icon name="alert" size={18} />
              <span>{error}</span>
            </div>
          {/if}

          <div class="form-grid form-grid--two">
            <label class="field">
              <span>Valor</span>
              <span class="money-input">
                <span class="money-input__prefix">{currencySymbol}</span>
                <input
                  class="input"
                  type="text"
                  inputmode="decimal"
                  placeholder="0,00"
                  bind:value={amount}
                />
              </span>
            </label>

            <label class="field">
              <span>Data</span>
              <input class="input" type="date" required bind:value={contributionDate} />
            </label>
          </div>

          <div class="form-grid form-grid--two">
            <label class="field">
              <span>Conta (opcional)</span>
              <select class="select" bind:value={accountId}>
                <option value="">Sem conta</option>
                {#each accountOptions as account (account.id)}
                  <option value={account.id}>
                    {account.name}{account.isActive ? "" : " (inativa)"}
                  </option>
                {/each}
              </select>
            </label>

            <label class="field">
              <span>Nota (opcional)</span>
              <input
                class="input"
                type="text"
                maxlength="500"
                placeholder="Ex.: décimo terceiro"
                bind:value={note}
              />
            </label>
          </div>

          <div class="form-actions">
            <button class="btn btn--primary btn--sm" type="submit" disabled={saving}>
              {#if saving}<Spinner label="Salvando" />{/if}
              Adicionar contribuição
            </button>
          </div>
        </form>
      {/if}

      <div class="goal-history">
        <h3>Histórico</h3>
        {#if current.contributions.length === 0}
          <p class="muted">Nenhuma contribuição registrada ainda.</p>
        {:else}
          <ul class="goal-history__list">
            {#each current.contributions as contribution (contribution.id)}
              <li class="goal-history__row">
                <div class="goal-history__main">
                  <strong>{formatMoney(contribution.amountMinor, currencyCode)}</strong>
                  <span class="muted">
                    {formatDate(contribution.contributionDate)}
                    {#if contribution.accountName}· {contribution.accountName}{/if}
                  </span>
                  {#if contribution.note}
                    <span class="hint">{contribution.note}</span>
                  {/if}
                </div>
                <button
                  class="btn btn--icon btn--ghost btn--sm"
                  type="button"
                  title="Remover contribuição"
                  aria-label="Remover contribuição"
                  disabled={removing === contribution.id}
                  onclick={() => removeContribution(contribution.id)}
                >
                  <Icon name="trash" size={15} />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}
</Modal>
