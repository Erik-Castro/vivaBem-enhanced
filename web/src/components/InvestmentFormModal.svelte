<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { assetClassSuggestions, currencyOptions } from "../lib/labels";
  import { toasts } from "../lib/toast.svelte";
  import type { Investment } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";

  let {
    open,
    investment = null,
    currencyLocked = false,
    onclose,
    onsaved,
  }: {
    open: boolean;
    investment?: Investment | null;
    currencyLocked?: boolean;
    onclose: () => void;
    onsaved: (investment: Investment) => void;
  } = $props();

  let ticker = $state("");
  let name = $state("");
  let assetClass = $state("");
  let currencyCode = $state("BRL");
  let saving = $state(false);
  let error = $state<string | null>(null);

  const editing = $derived(investment !== null);

  $effect(() => {
    if (!open) return;

    error = null;

    if (investment) {
      ticker = investment.ticker;
      name = investment.name;
      assetClass = investment.assetClass;
      currencyCode = investment.currencyCode;
      return;
    }

    ticker = "";
    name = "";
    assetClass = "";
    currencyCode = "BRL";
  });

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (saving) return;

    error = null;

    if (ticker.trim().length === 0 || name.trim().length === 0 || assetClass.trim().length === 0) {
      error = "Preencha ticker, nome e classe do ativo.";
      return;
    }

    const body = {
      ticker: ticker.trim().toUpperCase(),
      name: name.trim(),
      assetClass: assetClass.trim(),
      currencyCode,
    };

    saving = true;

    try {
      const result = editing && investment
        ? await api<{ investment: Investment }>(`/investments/${investment.id}`, {
          method: "PATCH",
          body,
        })
        : await api<{ investment: Investment }>("/investments", { method: "POST", body });

      toasts.success(editing ? "Ativo atualizado" : "Ativo criado");
      onsaved(result.investment);
      onclose();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      saving = false;
    }
  }
</script>

<Modal {open} title={editing ? "Editar ativo" : "Novo ativo"} {onclose}>
  <form class="form" onsubmit={handleSubmit} novalidate>
    {#if error}
      <div class="form-error" role="alert">
        <Icon name="alert" size={18} />
        <span>{error}</span>
      </div>
    {/if}

    <div class="form-grid form-grid--two">
      <label class="field">
        <span>Ticker</span>
        <input
          class="input input--ticker"
          type="text"
          maxlength="20"
          placeholder="PETR4"
          required
          bind:value={ticker}
        />
      </label>

      <label class="field">
        <span>Moeda</span>
        <select class="select" bind:value={currencyCode} disabled={editing && currencyLocked}>
          {#each currencyOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
        {#if editing && currencyLocked}
          <small class="hint">A moeda não muda depois de existirem operações.</small>
        {/if}
      </label>
    </div>

    <label class="field">
      <span>Nome</span>
      <input
        class="input"
        type="text"
        maxlength="120"
        placeholder="Petrobras PN"
        required
        bind:value={name}
      />
    </label>

    <label class="field">
      <span>Classe do ativo</span>
      <input
        class="input"
        type="text"
        maxlength="40"
        list="asset-classes"
        placeholder="Ações, FIIs, ETFs…"
        required
        bind:value={assetClass}
      />
      <datalist id="asset-classes">
        {#each assetClassSuggestions as suggestion (suggestion)}
          <option value={suggestion}></option>
        {/each}
      </datalist>
    </label>

    <div class="form-actions">
      <button class="btn btn--ghost" type="button" onclick={onclose} disabled={saving}>
        Cancelar
      </button>
      <button class="btn btn--primary" type="submit" disabled={saving}>
        {#if saving}<Spinner label="Salvando" />{/if}
        {editing ? "Salvar alterações" : "Criar ativo"}
      </button>
    </div>
  </form>
</Modal>
