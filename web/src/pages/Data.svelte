<script lang="ts">
  import { onMount } from "svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Icon from "../components/Icon.svelte";
  import { api, download, errorMessage } from "../lib/api";
  import { formatDate, formatMoney, todayISO } from "../lib/format";
  import { toasts } from "../lib/toast.svelte";
  import type { Account, ImportPreview, ImportResult } from "../lib/types";

  const MAX_FILE_BYTES = 1024 * 1024;

  type Tab = "import" | "export";

  let tab = $state<Tab>("import");
  let accounts = $state<Account[]>([]);
  let loadingAccounts = $state(true);

  let accountId = $state("");
  let file = $state<File | null>(null);
  let preview = $state<ImportPreview | null>(null);
  let result = $state<ImportResult | null>(null);
  let analyzing = $state(false);
  let importing = $state(false);
  let importError = $state<string | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  let exporting = $state<"json" | "csv" | null>(null);
  let exportError = $state<string | null>(null);

  const activeAccounts = $derived(accounts.filter((account) => account.isActive));
  const canAnalyze = $derived(accountId !== "" && file !== null && !analyzing);
  const canImport = $derived(
    preview !== null && preview.newRows > 0 && !importing && !analyzing,
  );
  const accountName = $derived(
    accounts.find((account) => account.id === accountId)?.name ?? "Conta",
  );

  async function loadAccounts(): Promise<void> {
    loadingAccounts = true;

    try {
      const payload = await api<{ accounts: Account[] }>("/accounts");
      accounts = payload.accounts;
      accountId = accounts.find((account) => account.isActive)?.id ?? "";
    } catch (cause) {
      importError = errorMessage(cause);
    } finally {
      loadingAccounts = false;
    }
  }

  function resetPreview(): void {
    preview = null;
    result = null;
    importError = null;
  }

  function pickFile(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const selected = input.files?.[0] ?? null;

    resetPreview();

    if (selected === null) {
      file = null;
      return;
    }

    if (selected.size > MAX_FILE_BYTES) {
      file = null;
      input.value = "";
      importError = "O arquivo deve ter no máximo 1 MB.";
      return;
    }

    file = selected;
  }

  function buildForm(): FormData {
    const form = new FormData();
    form.append("accountId", accountId);
    form.append("file", file as File);
    return form;
  }

  async function analyze(): Promise<void> {
    if (!canAnalyze) return;

    analyzing = true;
    importError = null;
    result = null;

    try {
      preview = await api<ImportPreview>("/import/preview", {
        method: "POST",
        form: buildForm(),
      });
    } catch (cause) {
      preview = null;
      importError = errorMessage(cause);
    } finally {
      analyzing = false;
    }
  }

  async function commit(): Promise<void> {
    if (!canImport) return;

    importing = true;
    importError = null;

    try {
      const committed = await api<ImportResult>("/import/commit", {
        method: "POST",
        form: buildForm(),
      });

      result = committed;
      preview = null;
      file = null;

      if (fileInput) fileInput.value = "";

      toasts.success(
        committed.imported === 1
          ? "1 transação importada"
          : `${committed.imported} transações importadas`,
      );
    } catch (cause) {
      importError = errorMessage(cause);
    } finally {
      importing = false;
    }
  }

  function saveBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function exportJson(): Promise<void> {
    if (exporting !== null) return;

    exporting = "json";
    exportError = null;

    try {
      const data = await api<unknown>("/export", { query: { format: "json" } });
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });

      saveBlob(blob, `vivabem-export-${todayISO()}.json`);
      toasts.success("Exportação JSON gerada");
    } catch (cause) {
      exportError = errorMessage(cause);
    } finally {
      exporting = null;
    }
  }

  async function exportCsv(): Promise<void> {
    if (exporting !== null) return;

    exporting = "csv";
    exportError = null;

    try {
      const { blob, fileName } = await download("/export", { format: "csv" });

      saveBlob(blob, fileName ?? `vivabem-transactions-${todayISO()}.csv`);
      toasts.success("Exportação CSV gerada");
    } catch (cause) {
      exportError = errorMessage(cause);
    } finally {
      exporting = null;
    }
  }

  onMount(loadAccounts);
</script>

<div class="page-head">
  <div>
    <p class="eyebrow">Dados</p>
    <h2>Importar e exportar</h2>
    <p class="page-subtitle">
      Traga extratos em CSV ou OFX e leve um backup completo dos seus dados.
    </p>
  </div>
</div>

<div class="tabs" role="tablist" aria-label="Seção de dados">
  <button
    class="tab"
    class:active={tab === "import"}
    type="button"
    role="tab"
    aria-selected={tab === "import"}
    onclick={() => (tab = "import")}
  >
    <Icon name="upload" size={16} />
    Importar
  </button>
  <button
    class="tab"
    class:active={tab === "export"}
    type="button"
    role="tab"
    aria-selected={tab === "export"}
    onclick={() => (tab = "export")}
  >
    <Icon name="download" size={16} />
    Exportar
  </button>
</div>

{#if tab === "import"}
  {#if loadingAccounts}
    <div class="card skeleton-card" aria-hidden="true">
      <span class="skeleton skeleton--title"></span>
      <span class="skeleton skeleton--row"></span>
    </div>
  {:else if activeAccounts.length === 0}
    <div class="card">
      <EmptyState
        icon="database"
        title="Nenhuma conta ativa"
        description="A importação precisa de uma conta ativa para receber as transações."
      >
        {#snippet action()}
          <a class="btn btn--soft" href="#/accounts">Ir para contas</a>
        {/snippet}
      </EmptyState>
    </div>
  {:else}
    <section class="card" aria-label="Arquivo de importação">
      <div class="card-head">
        <div>
          <h3>Arquivo</h3>
          <p>O formato é detectado pelo conteúdo, não pela extensão do arquivo.</p>
        </div>
      </div>

      <div class="form-grid form-grid--two">
        <label class="field">
          <span>Conta de destino</span>
          <select class="select" bind:value={accountId} onchange={resetPreview}>
            {#each activeAccounts as account (account.id)}
              <option value={account.id}>{account.name} · {account.currencyCode}</option>
            {/each}
          </select>
        </label>

        <label class="field">
          <span>Arquivo CSV ou OFX</span>
          <input
            class="input"
            type="file"
            accept=".csv,.ofx,text/csv,application/x-ofx,application/ofx"
            bind:this={fileInput}
            onchange={pickFile}
          />
          <small class="hint">Até 1 MB e 5.000 linhas.</small>
        </label>
      </div>

      {#if importError}
        <div class="form-error" role="alert">
          <Icon name="alert" size={18} />
          <span>{importError}</span>
        </div>
      {/if}

      <div class="form-actions">
        <button class="btn btn--primary" type="button" disabled={!canAnalyze} onclick={analyze}>
          {#if analyzing}
            <span class="spinner"></span>
            Analisando…
          {:else}
            <Icon name="search" size={16} />
            Analisar arquivo
          {/if}
        </button>
      </div>
    </section>

    {#if preview}
      <section class="card card--flush" aria-label="Prévia da importação">
        <div class="card-head card-head--flush">
          <div>
            <h3>{preview.fileName ?? "Prévia da importação"}</h3>
            <p>
              {preview.format.toUpperCase()} · {accountName} · {preview.validRows} linha(s) válida(s)
            </p>
          </div>
          <div class="data-summary">
            <span class="badge badge--active">{preview.newRows} nova(s)</span>
            <span class="badge badge--inactive">{preview.duplicateRows} duplicada(s)</span>
            {#if preview.errors.length > 0}
              <span class="badge badge--danger">{preview.errors.length} erro(s)</span>
            {/if}
          </div>
        </div>

        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">Linha</th>
                <th scope="col">Data</th>
                <th scope="col">Tipo</th>
                <th scope="col">Valor</th>
                <th scope="col">Descrição</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {#each preview.rows as row (row.importHash)}
                <tr class:data-row--duplicate={row.duplicate}>
                  <td>{row.line}</td>
                  <td>{formatDate(row.transactionDate)}</td>
                  <td>{row.type === "income" ? "Receita" : "Despesa"}</td>
                  <td class="data-table__amount">
                    {row.type === "income" ? "+" : "−"}{formatMoney(
                      row.amountMinor,
                      preview.currencyCode,
                    )}
                  </td>
                  <td class="data-table__wrap">{row.description ?? "—"}</td>
                  <td>
                    <span class={row.duplicate ? "badge badge--inactive" : "badge badge--active"}>
                      {row.duplicate ? "Duplicada" : "Nova"}
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        {#if preview.totalRows > preview.rows.length}
          <p class="card-note">
            Exibindo as primeiras {preview.rows.length} linhas de {preview.totalRows}; os totais
            cobrem o arquivo inteiro.
          </p>
        {/if}

        {#if preview.errors.length > 0}
          <div class="data-errors">
            <strong>Linhas com erro</strong>
            <ul>
              {#each preview.errors as rowError (`${rowError.line}-${rowError.message}`)}
                <li>Linha {rowError.line}: {rowError.message}</li>
              {/each}
            </ul>
          </div>
        {/if}

        <div class="data-foot">
          <span class="muted">
            {preview.duplicateRows > 0
              ? "Linhas duplicadas serão ignoradas na importação."
              : "Nenhuma duplicata encontrada."}
          </span>
          <div class="form-actions">
            <button class="btn btn--ghost" type="button" onclick={resetPreview} disabled={importing}>
              Cancelar
            </button>
            <button class="btn btn--primary" type="button" disabled={!canImport} onclick={commit}>
              {#if importing}
                <span class="spinner"></span>
                Importando…
              {:else}
                Importar {preview.newRows} transação(ões)
              {/if}
            </button>
          </div>
        </div>
      </section>
    {/if}

    {#if result}
      <div class="notice" role="status">
        <Icon name="check" />
        <div>
          <strong>Importação concluída</strong>
          <p>
            {result.imported} transação(ões) importada(s) e {result.skipped} ignorada(s) em {accountName}.
          </p>
        </div>
        <a class="btn btn--soft" href="#/transactions">Ver transações</a>
      </div>
    {/if}
  {/if}
{:else}
  <div class="data-grid">
    <section class="card data-card">
      <span class="data-card__icon"><Icon name="database" size={22} /></span>
      <h3>Backup completo (JSON)</h3>
      <p class="muted">
        Perfil, preferências, finanças, planejamento, hábitos, investimentos, conquistas,
        notificações, insights e vínculos familiares.
      </p>
      <p class="hint">
        Senhas, tokens de sessão e embeddings nunca entram no arquivo.
      </p>
      <button class="btn btn--primary" type="button" disabled={exporting !== null} onclick={exportJson}>
        {#if exporting === "json"}
          <span class="spinner"></span>
          Gerando…
        {:else}
          <Icon name="download" size={16} />
          Baixar JSON
        {/if}
      </button>
    </section>

    <section class="card data-card">
      <span class="data-card__icon"><Icon name="arrows" size={22} /></span>
      <h3>Transações (CSV)</h3>
      <p class="muted">Transações ativas com data, tipo, valor, conta e categoria.</p>
      <p class="hint">Bom para abrir no Excel, LibreOffice ou Google Sheets.</p>
      <button class="btn btn--soft" type="button" disabled={exporting !== null} onclick={exportCsv}>
        {#if exporting === "csv"}
          <span class="spinner"></span>
          Gerando…
        {:else}
          <Icon name="download" size={16} />
          Baixar CSV
        {/if}
      </button>
    </section>
  </div>

  {#if exportError}
    <div class="form-error" role="alert">
      <Icon name="alert" size={18} />
      <span>{exportError}</span>
    </div>
  {/if}
{/if}
