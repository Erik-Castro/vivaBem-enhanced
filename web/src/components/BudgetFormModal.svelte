<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { formatMoney, fromMinorUnits, todayISO, toMinorUnits } from "../lib/format";
  import { toasts } from "../lib/toast.svelte";
  import type { Budget, BudgetPeriodType, Category } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";

  let {
    open,
    budget = null,
    categories,
    defaultCurrency = "BRL",
    defaultStartDate = todayISO(),
    onclose,
    onsaved,
  }: {
    open: boolean;
    budget?: Budget | null;
    categories: readonly Category[];
    defaultCurrency?: string;
    defaultStartDate?: string;
    onclose: () => void;
    onsaved: (budget: Budget) => void;
  } = $props();

  let name = $state("");
  let categoryId = $state("");
  let limit = $state("0,00");
  let currencyCode = $state("BRL");
  let periodType = $state<BudgetPeriodType>("monthly");
  let startDate = $state(todayISO());
  let endDate = $state("");
  let alertThreshold = $state(80);
  let saving = $state(false);
  let error = $state<string | null>(null);

  const editing = $derived(budget !== null);
  const isCustom = $derived(periodType === "custom");
  const currencySymbol = $derived(
    currencyCode === "USD" ? "US$" : currencyCode === "EUR" ? "€" : "R$",
  );
  const categoryOptions = $derived(
    categories.filter(
      (category) =>
        category.type === "expense" &&
        (category.isActive || category.id === categoryId),
    ),
  );
  const periodOptions: readonly { value: BudgetPeriodType; label: string }[] = [
    { value: "monthly", label: "Mensal" },
    { value: "yearly", label: "Anual" },
    { value: "custom", label: "Personalizado" },
  ];

  $effect(() => {
    if (!open) return;

    error = null;

    if (budget) {
      name = budget.name;
      categoryId = budget.categoryId ?? "";
      limit = fromMinorUnits(budget.limitMinor);
      currencyCode = budget.currencyCode;
      periodType = budget.periodType;
      startDate = budget.startDate;
      endDate = budget.endDate ?? "";
      alertThreshold = budget.alertThreshold;
      return;
    }

    name = "";
    categoryId = "";
    limit = "0,00";
    currencyCode = defaultCurrency;
    periodType = "monthly";
    startDate = defaultStartDate;
    endDate = "";
    alertThreshold = 80;
  });

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (saving) return;

    error = null;

    if (name.trim().length === 0) {
      error = "Dê um nome para o orçamento.";
      return;
    }

    const limitMinor = toMinorUnits(limit);

    if (limitMinor <= 0) {
      error = "Informe um limite maior que zero.";
      return;
    }

    if (startDate === "") {
      error = "Informe a data de início.";
      return;
    }

    if (isCustom && endDate === "") {
      error = "Orçamentos personalizados exigem data final.";
      return;
    }

    if (isCustom && endDate < startDate) {
      error = "A data final precisa ser igual ou posterior à data inicial.";
      return;
    }

    if (!Number.isInteger(alertThreshold) || alertThreshold < 1 || alertThreshold > 100) {
      error = "O alerta deve ficar entre 1% e 100%.";
      return;
    }

    const body = {
      name: name.trim(),
      categoryId: categoryId === "" ? null : categoryId,
      limitMinor,
      currencyCode,
      periodType,
      startDate,
      endDate: isCustom ? endDate : null,
      alertThreshold: Number(alertThreshold),
    };

    saving = true;

    try {
      if (budget) {
        const result = await api<{ budget: Budget }>(`/budgets/${budget.id}`, {
          method: "PATCH",
          body,
        });

        toasts.success("Orçamento atualizado");
        onsaved(result.budget);
      } else {
        const result = await api<{ budget: Budget }>("/budgets", {
          method: "POST",
          body,
        });

        toasts.success("Orçamento criado");
        onsaved(result.budget);
      }

      onclose();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      saving = false;
    }
  }
</script>

<Modal {open} title={editing ? "Editar orçamento" : "Novo orçamento"} {onclose}>
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
        placeholder="Ex.: Mercado do mês"
        maxlength="120"
        required
        bind:value={name}
      />
    </label>

    <label class="field">
      <span>Categoria</span>
      <select class="select" bind:value={categoryId}>
        <option value="">Sem categoria</option>
        {#each categoryOptions as category (category.id)}
          <option value={category.id}>
            {category.name}{category.isActive ? "" : " (inativa)"}
          </option>
        {/each}
      </select>
      <small class="hint">O consumo soma a categoria e suas subcategorias.</small>
    </label>

    <div class="form-grid form-grid--two">
      <label class="field">
        <span>Limite</span>
        <span class="money-input">
          <span class="money-input__prefix">{currencySymbol}</span>
          <input
            class="input"
            type="text"
            inputmode="decimal"
            placeholder="0,00"
            bind:value={limit}
          />
        </span>
      </label>

      <label class="field">
        <span>Moeda</span>
        <select class="select" bind:value={currencyCode}>
          <option value="BRL">Real (BRL)</option>
          <option value="USD">Dólar (USD)</option>
          <option value="EUR">Euro (EUR)</option>
        </select>
      </label>
    </div>

    <div class="form-grid form-grid--two">
      <label class="field">
        <span>Período</span>
        <select class="select" bind:value={periodType}>
          {#each periodOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span>Alerta em</span>
        <input
          class="input"
          type="number"
          min="1"
          max="100"
          step="1"
          bind:value={alertThreshold}
        />
        <small class="hint">Aviso quando o consumo passar deste percentual.</small>
      </label>
    </div>

    <div class="form-grid" class:form-grid--two={isCustom}>
      <label class="field">
        <span>Início</span>
        <input class="input" type="date" required bind:value={startDate} />
      </label>

      {#if isCustom}
        <label class="field">
          <span>Fim</span>
          <input class="input" type="date" required bind:value={endDate} />
        </label>
      {/if}
    </div>

    {#if editing}
      <p class="hint">
        Limite atual: {formatMoney(budget?.limitMinor ?? 0, budget?.currencyCode ?? currencyCode)}
        por período.
      </p>
    {/if}

    <div class="form-actions">
      <button class="btn btn--ghost" type="button" onclick={onclose} disabled={saving}>Cancelar</button>
      <button class="btn btn--primary" type="submit" disabled={saving}>
        {#if saving}<Spinner label="Salvando" />{/if}
        {editing ? "Salvar alterações" : "Criar orçamento"}
      </button>
    </div>
  </form>
</Modal>
