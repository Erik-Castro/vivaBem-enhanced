<script lang="ts">
  import { onMount } from "svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import FamilyInviteModal from "../components/FamilyInviteModal.svelte";
  import Icon from "../components/Icon.svelte";
  import { api, errorMessage } from "../lib/api";
  import { formatDate, formatMoney } from "../lib/format";
  import { toasts } from "../lib/toast.svelte";
  import type { FamilyLink, FamilyLinks, FamilySummary } from "../lib/types";

  let links = $state<FamilyLinks>({ incoming: [], outgoing: [], active: [] });
  let summary = $state<FamilySummary | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let summaryError = $state<string | null>(null);
  let inviteOpen = $state(false);
  let busyId = $state<string | null>(null);

  const hasLinks = $derived(
    links.incoming.length + links.outgoing.length + links.active.length > 0,
  );
  // A API permite apenas um vínculo pendente ou ativo por usuário; com qualquer
  // convite em aberto o botão de convidar só produziria CONFLICT.
  const canInvite = $derived(
    links.incoming.length === 0 &&
      links.outgoing.length === 0 &&
      links.active.length === 0,
  );

  function periodLabel(iso: string): string {
    return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" })
      .format(new Date(`${iso}T00:00:00`));
  }

  async function load(): Promise<void> {
    loading = true;
    error = null;
    summaryError = null;

    try {
      const payload = await api<FamilyLinks>("/family");
      links = payload;

      if (payload.active.length > 0) {
        try {
          summary = await api<FamilySummary>("/family/summary");
        } catch (cause) {
          summary = null;
          summaryError = errorMessage(cause);
        }
      } else {
        summary = null;
      }
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  async function respond(link: FamilyLink, action: "accept" | "reject"): Promise<void> {
    if (busyId !== null) return;

    if (
      action === "reject" &&
      !window.confirm(`Recusar o convite de ${link.partner.name}?`)
    ) {
      return;
    }

    busyId = link.id;

    try {
      await api(`/family/${link.id}/${action}`, { method: "POST" });
      toasts.success(action === "accept" ? "Convite aceito" : "Convite recusado");
      await load();
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      busyId = null;
    }
  }

  async function revoke(link: FamilyLink): Promise<void> {
    if (busyId !== null) return;

    const active = link.status === "accepted";
    const question = active
      ? `Encerrar o vínculo familiar com ${link.partner.name}?`
      : `Cancelar o convite para ${link.partner.name}?`;

    if (!window.confirm(question)) return;

    busyId = link.id;

    try {
      await api(`/family/${link.id}`, { method: "DELETE" });
      toasts.success(active ? "Vínculo encerrado" : "Convite cancelado");
      await load();
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      busyId = null;
    }
  }

  onMount(load);
</script>

<div class="page-head">
  <div>
    <p class="eyebrow">Colaboração</p>
    <h2>Família</h2>
    <p class="page-subtitle">
      Compartilhe um resumo agregado do mês com uma pessoa de confiança.
    </p>
  </div>
  <div class="page-actions">
    <button
      class="btn btn--primary"
      type="button"
      disabled={!canInvite}
      title={canInvite
        ? undefined
        : "Encerre o convite ou o vínculo atual antes de convidar outra pessoa"}
      onclick={() => (inviteOpen = true)}
    >
      <Icon name="plus" size={18} />
      Convidar
    </button>
  </div>
</div>

<div class="notice">
  <Icon name="lock" />
  <div>
    <strong>Privacidade por padrão</strong>
    <p>
      O vínculo mostra apenas totais do mês e contagens do parceiro. Transações,
      contas, categorias e descrições individuais nunca são compartilhadas.
    </p>
  </div>
</div>

{#if loading}
  <div class="card skeleton-card" aria-hidden="true">
    <span class="skeleton skeleton--title"></span>
    <span class="skeleton skeleton--row"></span>
    <span class="skeleton skeleton--row"></span>
  </div>
{:else if error}
  <div class="notice notice--error" role="alert">
    <Icon name="alert" />
    <div>
      <strong>Não foi possível carregar a família</strong>
      <p>{error}</p>
    </div>
    <button class="btn btn--soft" type="button" onclick={() => void load()}>
      Tentar novamente
    </button>
  </div>
{:else}
  {#if links.incoming.length > 0}
    <section class="card card--flush" aria-label="Convites recebidos">
      <div class="card-head card-head--flush">
        <div>
          <h3>Convites recebidos</h3>
          <p>Aceitar compartilha apenas o resumo agregado do seu mês.</p>
        </div>
        <span class="badge badge--pending">{links.incoming.length}</span>
      </div>

      {#each links.incoming as link (link.id)}
        <div class="family-link">
          <span class="tx-icon" aria-hidden="true"><Icon name="mail" size={18} /></span>
          <div class="tx-main">
            <div class="tx-title"><strong>{link.partner.name}</strong></div>
            <span class="tx-meta">{link.partner.email} · convite de {formatDate(link.createdAt.slice(0, 10))}</span>
          </div>
          <div class="family-actions">
            <button
              class="btn btn--soft btn--sm"
              type="button"
              disabled={busyId !== null}
              onclick={() => void respond(link, "reject")}
            >
              Recusar
            </button>
            <button
              class="btn btn--primary btn--sm"
              type="button"
              disabled={busyId !== null}
              onclick={() => void respond(link, "accept")}
            >
              Aceitar
            </button>
          </div>
        </div>
      {/each}
    </section>
  {/if}

  {#if links.outgoing.length > 0}
    <section class="card card--flush" aria-label="Convites enviados">
      <div class="card-head card-head--flush">
        <div>
          <h3>Convites enviados</h3>
          <p>Aguardando a resposta da outra pessoa.</p>
        </div>
      </div>

      {#each links.outgoing as link (link.id)}
        <div class="family-link">
          <span class="tx-icon" aria-hidden="true"><Icon name="mail" size={18} /></span>
          <div class="tx-main">
            <div class="tx-title">
              <strong>{link.partner.name}</strong>
              <span class="badge badge--pending">Pendente</span>
            </div>
            <span class="tx-meta">{link.partner.email} · enviado em {formatDate(link.createdAt.slice(0, 10))}</span>
          </div>
          <div class="family-actions">
            <button
              class="btn btn--ghost btn--sm"
              type="button"
              disabled={busyId !== null}
              onclick={() => void revoke(link)}
            >
              Cancelar convite
            </button>
          </div>
        </div>
      {/each}
    </section>
  {/if}

  {#if links.active.length > 0}
    {#each links.active as link (link.id)}
      <section class="card" aria-label="Vínculo familiar">
        <div class="card-head">
          <div class="family-title">
            <span class="tx-icon tx-icon--income" aria-hidden="true">
              <Icon name="users" size={18} />
            </span>
            <div>
              <h3>{link.partner.name}</h3>
              <p>{link.partner.email} · vínculo ativo desde {formatDate(link.createdAt.slice(0, 10))}</p>
            </div>
          </div>
          <button
            class="btn btn--ghost btn--sm"
            type="button"
            disabled={busyId !== null}
            onclick={() => void revoke(link)}
          >
            Encerrar vínculo
          </button>
        </div>

        {#if summaryError}
          <div class="form-error" role="alert">
            <Icon name="alert" size={18} />
            <span>{summaryError}</span>
          </div>
        {:else if summary}
          <p class="family-period">
            Resumo de <strong>{periodLabel(summary.period.from)}</strong>
          </p>

          {#if summary.totals.length === 0}
            <p class="muted family-empty-period">
              Nenhuma transação do parceiro neste mês.
            </p>
          {:else}
            <div class="family-totals">
              {#each summary.totals as total (total.currencyCode)}
                <article class="family-total">
                  <span class="family-total__currency">{total.currencyCode}</span>
                  <dl class="family-total__rows">
                    <div>
                      <dt>Receitas</dt>
                      <dd class="positive">{formatMoney(total.incomeMinor, total.currencyCode)}</dd>
                    </div>
                    <div>
                      <dt>Despesas</dt>
                      <dd class="negative">{formatMoney(total.expenseMinor, total.currencyCode)}</dd>
                    </div>
                    <div>
                      <dt>Saldo do mês</dt>
                      <dd class:negative={total.netMinor < 0}>
                        {formatMoney(total.netMinor, total.currencyCode)}
                      </dd>
                    </div>
                    <div>
                      <dt>Transações</dt>
                      <dd>{total.transactionCount}</dd>
                    </div>
                  </dl>
                </article>
              {/each}
            </div>
          {/if}

          <dl class="family-counts">
            <div><dt>Contas ativas</dt><dd>{summary.counts.activeAccounts}</dd></div>
            <div><dt>Hábitos ativos</dt><dd>{summary.counts.activeHabits}</dd></div>
            <div><dt>Check-ins</dt><dd>{summary.counts.habitLogs}</dd></div>
            <div><dt>Metas ativas</dt><dd>{summary.counts.activeGoals}</dd></div>
            <div><dt>Conquistas</dt><dd>{summary.counts.unlockedAchievements}</dd></div>
          </dl>
        {:else}
          <div class="family-summary-loading">
            <span class="spinner"></span>
          </div>
        {/if}
      </section>
    {/each}
  {:else if !hasLinks}
    <div class="card">
      <EmptyState
        icon="users"
        title="Nenhum vínculo familiar"
        description="Convide alguém para acompanhar um resumo agregado do mês — sem expor transações individuais."
      >
        {#snippet action()}
          <button class="btn btn--primary" type="button" onclick={() => (inviteOpen = true)}>
            Convidar pessoa
          </button>
        {/snippet}
      </EmptyState>
    </div>
  {/if}
{/if}

<FamilyInviteModal
  open={inviteOpen}
  onclose={() => (inviteOpen = false)}
  oninvited={() => void load()}
/>
