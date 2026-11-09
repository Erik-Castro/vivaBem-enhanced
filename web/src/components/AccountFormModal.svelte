<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { accountTypeOptions } from "../lib/labels";
  import { fromMinorUnits, toMinorUnits } from "../lib/format";
  import { toasts } from "../lib/toast.svelte";
  import type { Account, AccountType } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";

  let {
    open,
    account = null,
    onclose,
    onsaved,
  }: {
    open: boolean;
    account?: Account | null;
    onclose: () => void;
    onsaved: (account: Account) => void;
  } = $props();

  let name = $state("");
  let type = $state<AccountType>("checking");
  let currencyCode = $state("BRL");
  let closingDay = $state(1);
  let dueDay = $state(10);
  let limit = $state("0,00");
  let saving = $state(false);
  let error = $state<string | null>(null);

  const editing = $derived(account !== null);
  const isCard = $derived(type === "credit_card");

  $effect(() => {
    if (!open) return;

    error = null;

    if (account) {
      name = account.name;
      type = account.type;
      currencyCode = account.currencyCode;
      closingDay = account.creditCard?.closingDay ?? 1;
      dueDay = account.creditCard?.dueDay ?? 10;
      limit = fromMinorUnits(account.creditCard?.limitMinor ?? 0);
      return;
    }

    name = "";
    type = "checking";
    currencyCode = "BRL";
    closingDay = 1;
    dueDay = 10;
    limit = "0,00";
  });

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (saving) return;

    error = null;

    if (name.trim().length === 0) {
      error = "Dê um nome para a conta.";
      return;
    }

    if (isCard && (closingDay < 1 || closingDay > 31 || dueDay < 1 || dueDay > 31)) {
      error = "Os dias de fechamento e vencimento devem ficar entre 1 e 31.";
      return;
    }

    const limitMinor = toMinorUnits(limit);

    if (isCard && limitMinor < 0) {
      error = "O limite não pode ser negativo.";
      return;
    }

    const creditCard = isCard
      ? { closingDay: Number(closingDay), dueDay: Number(dueDay), limitMinor }
      : undefined;

    saving = true;

    try {
      if (account) {
        const result = await api<{ account: Account }>(`/accounts/${account.id}`, {
          method: "PATCH",
          body: {
            name: name.trim(),
            currencyCode,
            isActive: account.isActive,
            ...(creditCard ? { creditCard } : {}),
          },
        });

        toasts.success("Conta atualizada");
        onsaved(result.account);
      } else {
        const result = await api<{ account: Account }>("/accounts", {
          method: "POST",
          body: {
            name: name.trim(),
            type,
            currencyCode,
            ...(creditCard ? { creditCard } : {}),
          },
        });

        toasts.success("Conta criada");
        onsaved(result.account);
      }

      onclose();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      saving = false;
    }
  }
</script>

<Modal {open} title={editing ? "Editar conta" : "Nova conta"} {onclose}>
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
        placeholder="Ex.: Conta do dia a dia"
        maxlength="120"
        required
        bind:value={name}
      />
    </label>

    <div class="form-grid form-grid--two">
      <label class="field">
        <span>Tipo</span>
        <select class="select" bind:value={type} disabled={editing}>
          {#each accountTypeOptions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
        {#if editing}<small class="hint">O tipo não pode ser alterado.</small>{/if}
      </label>

      <label class="field">
        <span>Moeda</span>
        <select class="select" bind:value={currencyCode}>
          <option value="BRL">Real (BRL)</option>
          <option value="USD">Dólar (USD)</option>
          <option value="EUR">Euro (EUR)</option>
        </select>
        {#if editing}<small class="hint">Só muda se ainda não houver transações.</small>{/if}
      </label>
    </div>

    {#if isCard}
      <fieldset class="fieldset">
        <legend>Detalhes do cartão</legend>
        <div class="form-grid form-grid--three">
          <label class="field">
            <span>Fechamento</span>
            <input class="input" type="number" min="1" max="31" bind:value={closingDay} />
          </label>

          <label class="field">
            <span>Vencimento</span>
            <input class="input" type="number" min="1" max="31" bind:value={dueDay} />
          </label>

          <label class="field">
            <span>Limite</span>
            <span class="money-input">
              <span class="money-input__prefix">R$</span>
              <input
                class="input"
                type="text"
                inputmode="decimal"
                placeholder="0,00"
                bind:value={limit}
              />
            </span>
          </label>
        </div>
      </fieldset>
    {/if}

    <div class="form-actions">
      <button class="btn btn--ghost" type="button" onclick={onclose} disabled={saving}>Cancelar</button>
      <button class="btn btn--primary" type="submit" disabled={saving}>
        {#if saving}<Spinner label="Salvando" />{/if}
        {editing ? "Salvar alterações" : "Criar conta"}
      </button>
    </div>
  </form>
</Modal>
