<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { fromMinorUnits, todayISO, toMinorUnits } from "../lib/format";
  import { recurringFrequencyOptions } from "../lib/labels";
  import { toasts } from "../lib/toast.svelte";
  import type {
    Account,
    Category,
    Recurring,
    RecurringFrequency,
    RecurringType,
  } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";

  let {
    open,
    recurring = null,
    accounts,
    categories,
    onclose,
    onsaved,
  }: {
    open: boolean;
    recurring?: Recurring | null;
    accounts: readonly Account[];
    categories: readonly Category[];
    onclose: () => void;
    onsaved: (recurring: Recurring) => void;
  } = $props();

  let accountId = $state("");
  let type = $state<RecurringType>("expense");
  let amount = $state("0,00");
  let categoryId = $state("");
  let description = $state("");
  let frequency = $state<RecurringFrequency>("monthly");
  let interval = $state(1);
  let dayOfMonth = $state(1);
  let startDate = $state(todayISO());
  let endDate = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);

  const editing = $derived(recurring !== null);
  const activeAccounts = $derived(accounts.filter((account) => account.isActive));
  const selectedAccount = $derived(accounts.find((account) => account.id === accountId) ?? null);
  const currencyCode = $derived(selectedAccount?.currencyCode ?? "BRL");
  const usesDayOfMonth = $derived(frequency === "monthly" || frequency === "yearly");
  const categoryOptions = $derived(
    categories.filter(
      (category) => category.type === type && (category.isActive || category.id === categoryId),
    ),
  );

  $effect(() => {
    if (!open) return;

    error = null;

    if (recurring) {
      accountId = recurring.accountId;
      type = recurring.type;
      amount = fromMinorUnits(recurring.amountMinor);
      categoryId = recurring.categoryId ?? "";
      description = recurring.description ?? "";
      frequency = recurring.frequency;
      interval = recurring.interval;
      dayOfMonth = recurring.dayOfMonth ?? Number(recurring.startDate.slice(8, 10));
      startDate = recurring.startDate;
      endDate = recurring.endDate ?? "";
      return;
    }

    accountId = activeAccounts[0]?.id ?? "";
    type = "expense";
    amount = "0,00";
    categoryId = "";
    description = "";
    frequency = "monthly";
    interval = 1;
    dayOfMonth = Number(todayISO().slice(8, 10));
    startDate = todayISO();
    endDate = "";
  });

  function changeType(next: RecurringType): void {
    type = next;

    const selected = categories.find((category) => category.id === categoryId);

    if (selected && selected.type !== next) categoryId = "";
  }

  function changeFrequency(next: RecurringFrequency): void {
    frequency = next;

    // Mantém o dia-alvo coerente com a data de início ao voltar para mensal/anual.
    if ((next === "monthly" || next === "yearly") && startDate !== "") {
      dayOfMonth = Number(startDate.slice(8, 10));
    }
  }

  function changeStartDate(next: string): void {
    startDate = next;

    if (usesDayOfMonth && next !== "") dayOfMonth = Number(next.slice(8, 10));
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (saving) return;

    error = null;

    if (accountId === "") {
      error = "Selecione a conta da recorrência.";
      return;
    }

    const amountMinor = toMinorUnits(amount);

    if (amountMinor <= 0) {
      error = "Informe um valor maior que zero.";
      return;
    }

    if (startDate === "") {
      error = "Informe a data de início.";
      return;
    }

    if (endDate !== "" && endDate < startDate) {
      error = "A data final precisa ser igual ou posterior à data inicial.";
      return;
    }

    if (!Number.isInteger(interval) || interval < 1 || interval > 60) {
      error = "O intervalo deve ficar entre 1 e 60.";
      return;
    }

    if (usesDayOfMonth && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) {
      error = "O dia do mês deve ficar entre 1 e 31.";
      return;
    }

    const body = {
      accountId,
      categoryId: categoryId === "" ? null : categoryId,
      type,
      amountMinor,
      description: description.trim() === "" ? null : description.trim(),
      frequency,
      interval: Number(interval),
      dayOfMonth: usesDayOfMonth ? Number(dayOfMonth) : null,
      startDate,
      endDate: endDate === "" ? null : endDate,
    };

    saving = true;

    try {
      if (recurring) {
        const result = await api<{ recurring: Recurring }>(`/recurring/${recurring.id}`, {
          method: "PATCH",
          body,
        });

        toasts.success("Recorrência atualizada");
        onsaved(result.recurring);
      } else {
        const result = await api<{ recurring: Recurring }>("/recurring", {
          method: "POST",
          body,
        });

        toasts.success("Recorrência criada");
        onsaved(result.recurring);
      }

      onclose();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      saving = false;
    }
  }
</script>

<Modal {open} title={editing ? "Editar recorrência" : "Nova recorrência"} {onclose}>
  <form class="form" onsubmit={handleSubmit} novalidate>
    {#if error}
      <div class="form-error" role="alert">
        <Icon name="alert" size={18} />
        <span>{error}</span>
      </div>
    {/if}

    <div class="form-grid form-grid--two">
      <label class="field">
        <span>Conta</span>
        <select class="select" bind:value={accountId} required>
          <option value="">Selecione</option>
          {#each activeAccounts as account (account.id)}
            <option value={account.id}>{account.name} · {account.currencyCode}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span>Tipo</span>
        <select
          class="select"
          value={type}
          onchange={(event) => changeType(event.currentTarget.value as RecurringType)}
        >
          <option value="expense">Despesa</option>
          <option value="income">Receita</option>
        </select>
      </label>
    </div>

    <div class="form-grid form-grid--two">
      <label class="field">
        <span>Valor ({currencyCode})</span>
        <span class="money-input">
          <span class="money-input__prefix">{currencyCode}</span>
          <input
            class="input"
            type="text"
            inputmode="decimal"
            placeholder="0,00"
            required
            bind:value={amount}
          />
        </span>
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
      </label>
    </div>

    <label class="field">
      <span>Descrição</span>
      <input
        class="input"
        type="text"
        placeholder="Ex.: Aluguel do apartamento"
        maxlength="500"
        bind:value={description}
      />
    </label>

    <div class="form-grid form-grid--two">
      <label class="field">
        <span>Frequência</span>
        <select
          class="select"
          value={frequency}
          onchange={(event) => changeFrequency(event.currentTarget.value as RecurringFrequency)}
        >
          {#each recurringFrequencyOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span>A cada</span>
        <input class="input" type="number" min="1" max="60" step="1" bind:value={interval} />
        <small class="hint">
          {interval > 1 ? "Intervalo entre ocorrências." : "Padrão: uma vez por período."}
        </small>
      </label>
    </div>

    {#if usesDayOfMonth}
      <label class="field">
        <span>Dia do mês</span>
        <input class="input" type="number" min="1" max="31" step="1" bind:value={dayOfMonth} />
        <small class="hint">
          Meses mais curtos ajustam para o último dia disponível (ex.: 31 vira 28/29/30).
        </small>
      </label>
    {/if}

    <div class="form-grid form-grid--two">
      <label class="field">
        <span>Início</span>
        <input
          class="input"
          type="date"
          required
          value={startDate}
          onchange={(event) => changeStartDate(event.currentTarget.value)}
        />
      </label>

      <label class="field">
        <span>Fim (opcional)</span>
        <input class="input" type="date" bind:value={endDate} />
      </label>
    </div>

    <p class="hint">
      O lançamento da próxima ocorrência é criado no boot, no catch-up diário ou em
      "Executar agora".
    </p>

    <div class="form-actions">
      <button class="btn btn--ghost" type="button" onclick={onclose} disabled={saving}>
        Cancelar
      </button>
      <button class="btn btn--primary" type="submit" disabled={saving}>
        {#if saving}<Spinner label="Salvando" />{/if}
        {editing ? "Salvar alterações" : "Criar recorrência"}
      </button>
    </div>
  </form>
</Modal>
