<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { formatMoney, fromMinorUnits, toMinorUnits, todayISO } from "../lib/format";
  import { toasts } from "../lib/toast.svelte";
  import type { Account, Category, Transaction } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";

  let {
    open,
    transaction = null,
    accounts,
    categories,
    onclose,
    onsaved,
  }: {
    open: boolean;
    transaction?: Transaction | null;
    accounts: readonly Account[];
    categories: readonly Category[];
    onclose: () => void;
    onsaved: () => void;
  } = $props();

  let type = $state<"income" | "expense" | "transfer">("expense");
  let accountId = $state("");
  let destinationAccountId = $state("");
  let categoryId = $state("");
  let amount = $state("");
  let description = $state("");
  let transactionDate = $state(todayISO());
  let isCleared = $state(false);
  let installments = $state("1");
  let saving = $state(false);
  let error = $state<string | null>(null);

  const editing = $derived(transaction !== null);
  const isTransfer = $derived(type === "transfer");
  const isInstallment = $derived(transaction?.installment !== null && transaction?.installment !== undefined);
  const selectedAccount = $derived(accounts.find((item) => item.id === accountId) ?? null);
  const canInstallments = $derived(
    !editing && type === "expense" && selectedAccount?.type === "credit_card",
  );
  const categoryOptions = $derived(
    categories.filter(
      (category) =>
        (category.type === "income" || category.type === "expense") &&
        category.type === type &&
        (category.isActive || category.id === categoryId),
    ),
  );
  const destinationOptions = $derived(
    accounts.filter(
      (account) =>
        account.isActive &&
        account.id !== accountId &&
        account.currencyCode === selectedAccount?.currencyCode,
    ),
  );
  const accountOptions = $derived(
    isTransfer && !editing ? accounts.filter((account) => account.isActive) : accounts,
  );
  const currencyCode = $derived(selectedAccount?.currencyCode ?? "BRL");
  const totalInstallments = $derived(Number.parseInt(installments, 10) || 1);

  $effect(() => {
    if (!open) return;

    error = null;

    if (transaction) {
      type = transaction.type;
      accountId = transaction.accountId;
      destinationAccountId = "";
      categoryId = transaction.categoryId ?? "";
      amount = fromMinorUnits(Math.abs(transaction.amountMinor));
      description = transaction.description ?? "";
      transactionDate = transaction.transactionDate;
      isCleared = transaction.isCleared;
      installments = "1";
      return;
    }

    type = "expense";
    accountId = accounts.find((item) => item.isActive)?.id ?? "";
    destinationAccountId = "";
    categoryId = "";
    amount = "";
    description = "";
    transactionDate = todayISO();
    isCleared = false;
    installments = "1";
  });

  $effect(() => {
    const selected = categories.find((item) => item.id === categoryId);

    if (selected && selected.type !== type) {
      categoryId = "";
    }
  });

  // Ao entrar no modo transferência, escolhe um destino válido e assume
  // compensação imediata, que é o padrão do backend.
  $effect(() => {
    if (!open || editing || !isTransfer) return;

    if (!destinationOptions.some((account) => account.id === destinationAccountId)) {
      destinationAccountId = destinationOptions[0]?.id ?? "";
    }

    isCleared = true;
  });

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (saving) return;

    error = null;

    const amountMinor = toMinorUnits(amount);

    if (amountMinor <= 0) {
      error = "Informe um valor maior que zero.";
      return;
    }

    if (accountId === "") {
      error = "Selecione uma conta.";
      return;
    }

    if (!editing && isTransfer && destinationAccountId === "") {
      error = "Selecione a conta de destino.";
      return;
    }

    if (!editing && isTransfer && destinationAccountId === accountId) {
      error = "A conta de destino precisa ser diferente da origem.";
      return;
    }

    if (transactionDate === "") {
      error = "Informe a data da transação.";
      return;
    }

    if (canInstallments && totalInstallments > 1) {
      if (totalInstallments < 2 || totalInstallments > 48) {
        error = "O parcelamento deve ficar entre 2 e 48 vezes.";
        return;
      }

      if (amountMinor < totalInstallments) {
        error = "O valor total precisa ser maior ou igual ao número de parcelas.";
        return;
      }
    }

    saving = true;

    try {
      if (transaction) {
        const patch: Record<string, unknown> = {
          description: description.trim() === "" ? null : description.trim(),
          isCleared,
        };

        if (!isTransfer) {
          patch.categoryId = categoryId === "" ? null : categoryId;
        }

        if (!isInstallment) {
          patch.transactionDate = transactionDate;
        }

        if (!isTransfer && !isInstallment) {
          patch.amountMinor = amountMinor;
        }

        await api<{ transaction: Transaction }>(`/transactions/${transaction.id}`, {
          method: "PATCH",
          body: patch,
        });

        toasts.success("Transação atualizada");
      } else if (isTransfer) {
        await api<{ transferGroupId: string; from: Transaction; to: Transaction }>(
          "/transactions/transfer",
          {
            method: "POST",
            body: {
              fromAccountId: accountId,
              toAccountId: destinationAccountId,
              amountMinor,
              description: description.trim() === "" ? null : description.trim(),
              transactionDate,
              isCleared,
            },
          },
        );

        toasts.success("Transferência registrada");
      } else {
        const payload = await api<{ transactions: Transaction[] }>("/transactions", {
          method: "POST",
          body: {
            accountId,
            categoryId: categoryId === "" ? null : categoryId,
            type,
            amountMinor,
            description: description.trim() === "" ? null : description.trim(),
            transactionDate,
            isCleared,
            ...(canInstallments && totalInstallments > 1
              ? { installments: { totalInstallments } }
              : {}),
          },
        });

        toasts.success(
          payload.transactions.length > 1
            ? `Parcelamento criado em ${payload.transactions.length} vezes`
            : "Transação criada",
        );
      }

      onsaved();
      onclose();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      saving = false;
    }
  }
</script>

<Modal {open} title={editing ? "Editar transação" : "Nova transação"} {onclose}>
  <form class="form" onsubmit={handleSubmit} novalidate>
    {#if error}
      <div class="form-error" role="alert">
        <Icon name="alert" size={18} />
        <span>{error}</span>
      </div>
    {/if}

    <div class="form-grid form-grid--two">
      <label class="field">
        <span>Tipo</span>
        {#if editing}
          <select class="select" disabled>
            <option>
              {type === "transfer" ? "Transferência" : type === "income" ? "Receita" : "Despesa"}
            </option>
          </select>
        {:else}
          <select class="select" bind:value={type}>
            <option value="expense">Despesa</option>
            <option value="income">Receita</option>
            <option value="transfer">Transferência</option>
          </select>
        {/if}
      </label>

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
            disabled={editing && (isTransfer || isInstallment)}
            bind:value={amount}
          />
        </span>
        {#if editing && isInstallment}
          <small class="hint">O valor de uma parcela não pode ser alterado individualmente.</small>
        {/if}
      </label>
    </div>

    <div class="form-grid" class:form-grid--two={!(isTransfer && editing)}>
      <label class="field">
        <span>{isTransfer && !editing ? "Conta de origem" : "Conta"}</span>
        <select class="select" bind:value={accountId} disabled={editing} required>
          {#if accountOptions.length === 0}
            <option value="">Nenhuma conta disponível</option>
          {/if}
          {#each accountOptions as account (account.id)}
            <option value={account.id} disabled={!account.isActive && !editing}>
              {account.name}{account.isActive ? "" : " (inativa)"}
            </option>
          {/each}
        </select>
      </label>

      {#if isTransfer && !editing}
        <label class="field">
          <span>Conta de destino</span>
          <select class="select" bind:value={destinationAccountId} required>
            {#if destinationOptions.length === 0}
              <option value="">Nenhuma conta compatível</option>
            {/if}
            {#each destinationOptions as account (account.id)}
              <option value={account.id}>{account.name}</option>
            {/each}
          </select>
          <small class="hint">Transferências exigem contas ativas com a mesma moeda.</small>
        </label>
      {:else if !isTransfer}
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
      {/if}
    </div>

    <label class="field">
      <span>Descrição</span>
      <input
        class="input"
        type="text"
        placeholder="Ex.: Mercado da semana"
        maxlength="500"
        bind:value={description}
      />
    </label>

    <div class="form-grid form-grid--two">
      <label class="field">
        <span>Data</span>
        <input
          class="input"
          type="date"
          required
          disabled={editing && isInstallment}
          bind:value={transactionDate}
        />
        {#if editing && isInstallment}
          <small class="hint">A data de uma parcela não pode ser alterada individualmente.</small>
        {/if}
      </label>

      {#if canInstallments}
        <label class="field">
          <span>Parcelas</span>
          <input
            class="input"
            type="number"
            min="2"
            max="48"
            step="1"
            bind:value={installments}
          />
          <small class="hint">
            O valor informado é o total. {#if totalInstallments > 1}
              Cada parcela fica em {formatMoney(
                Math.floor(toMinorUnits(amount) / totalInstallments),
                currencyCode,
              )}.
            {/if}
          </small>
        </label>
      {:else}
        <label class="checkbox checkbox--field">
          <input type="checkbox" bind:checked={isCleared} />
          <span>Já compensada</span>
        </label>
      {/if}
    </div>

    {#if canInstallments}
      <label class="checkbox">
        <input type="checkbox" bind:checked={isCleared} />
        <span>A primeira parcela já está compensada</span>
      </label>
    {/if}

    <div class="form-actions">
      <button class="btn btn--ghost" type="button" onclick={onclose} disabled={saving}>Cancelar</button>
      <button class="btn btn--primary" type="submit" disabled={saving}>
        {#if saving}<Spinner label="Salvando" />{/if}
        {editing ? "Salvar alterações" : isTransfer ? "Registrar transferência" : "Registrar transação"}
      </button>
    </div>
  </form>
</Modal>
