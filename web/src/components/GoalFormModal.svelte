<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { formatMoney, fromMinorUnits, toMinorUnits } from "../lib/format";
  import { currencyOptions } from "../lib/labels";
  import { toasts } from "../lib/toast.svelte";
  import type { Account, Goal } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";

  let {
    open,
    goal = null,
    accounts,
    currencyLocked = false,
    defaultCurrency = "BRL",
    onclose,
    onsaved,
  }: {
    open: boolean;
    goal?: Goal | null;
    accounts: readonly Account[];
    currencyLocked?: boolean;
    defaultCurrency?: string;
    onclose: () => void;
    onsaved: (goal: Goal) => void;
  } = $props();

  let name = $state("");
  let description = $state("");
  let targetAmount = $state("0,00");
  let currencyCode = $state("BRL");
  let targetDate = $state("");
  let targetAccountId = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);

  const editing = $derived(goal !== null);
  const currencySymbol = $derived(
    currencyCode === "USD" ? "US$" : currencyCode === "EUR" ? "€" : "R$",
  );
  const accountOptions = $derived(
    accounts.filter(
      (account) => account.isActive || account.id === targetAccountId,
    ),
  );

  $effect(() => {
    if (!open) return;

    error = null;

    if (goal) {
      name = goal.name;
      description = goal.description ?? "";
      targetAmount = fromMinorUnits(goal.targetAmountMinor);
      currencyCode = goal.currencyCode;
      targetDate = goal.targetDate ?? "";
      targetAccountId = goal.targetAccountId ?? "";
      return;
    }

    name = "";
    description = "";
    targetAmount = "0,00";
    currencyCode = defaultCurrency;
    targetDate = "";
    targetAccountId = "";
  });

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (saving) return;

    error = null;

    if (name.trim().length === 0) {
      error = "Dê um nome para a meta.";
      return;
    }

    const targetAmountMinor = toMinorUnits(targetAmount);

    if (targetAmountMinor <= 0) {
      error = "Informe um valor-alvo maior que zero.";
      return;
    }

    const body = {
      name: name.trim(),
      description: description.trim() === "" ? null : description.trim(),
      targetAmountMinor,
      currencyCode,
      targetDate: targetDate === "" ? null : targetDate,
      targetAccountId: targetAccountId === "" ? null : targetAccountId,
    };

    saving = true;

    try {
      const result = editing && goal
        ? await api<{ goal: Goal }>(`/goals/${goal.id}`, { method: "PATCH", body })
        : await api<{ goal: Goal }>("/goals", { method: "POST", body });

      toasts.success(editing ? "Meta atualizada" : "Meta criada");
      onsaved(result.goal);
      onclose();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      saving = false;
    }
  }
</script>

<Modal {open} title={editing ? "Editar meta" : "Nova meta"} {onclose}>
  <form class="form" onsubmit={handleSubmit} novalidate>
    {#if error}
      <div class="form-error" role="alert">
        <Icon name="alert" size={18} />
        <span>{error}</span>
      </div>
    {/if}

    <label class="field">
      <span>Nome</span>
      <input
        class="input"
        type="text"
        placeholder="Ex.: Reserva de emergência"
        maxlength="120"
        required
        bind:value={name}
      />
    </label>

    <label class="field">
      <span>Descrição (opcional)</span>
      <textarea
        class="textarea"
        rows="2"
        maxlength="1000"
        placeholder="Para que serve esta meta?"
        bind:value={description}
      ></textarea>
    </label>

    <div class="form-grid form-grid--two">
      <label class="field">
        <span>Valor-alvo</span>
        <span class="money-input">
          <span class="money-input__prefix">{currencySymbol}</span>
          <input
            class="input"
            type="text"
            inputmode="decimal"
            placeholder="0,00"
            bind:value={targetAmount}
          />
        </span>
      </label>

      <label class="field">
        <span>Moeda</span>
        <select class="select" bind:value={currencyCode} disabled={currencyLocked}>
          {#each currencyOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
        {#if currencyLocked}
          <small class="hint">A moeda não muda depois de receber contribuições.</small>
        {/if}
      </label>
    </div>

    <div class="form-grid form-grid--two">
      <label class="field">
        <span>Data-alvo (opcional)</span>
        <input class="input" type="date" bind:value={targetDate} />
      </label>

      <label class="field">
        <span>Conta vinculada (opcional)</span>
        <select class="select" bind:value={targetAccountId}>
          <option value="">Sem conta vinculada</option>
          {#each accountOptions as account (account.id)}
            <option value={account.id}>
              {account.name}{account.isActive ? "" : " (inativa)"}
            </option>
          {/each}
        </select>
      </label>
    </div>

    {#if editing}
      <p class="hint">
        Alvo atual: {formatMoney(goal?.targetAmountMinor ?? 0, goal?.currencyCode ?? currencyCode)}.
      </p>
    {/if}

    <div class="form-actions">
      <button class="btn btn--ghost" type="button" onclick={onclose} disabled={saving}>
        Cancelar
      </button>
      <button class="btn btn--primary" type="submit" disabled={saving}>
        {#if saving}<Spinner label="Salvando" />{/if}
        {editing ? "Salvar alterações" : "Criar meta"}
      </button>
    </div>
  </form>
</Modal>
