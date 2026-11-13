<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "../components/Icon.svelte";
  import Spinner from "../components/Spinner.svelte";
  import { api, errorMessage } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { formatDateTime } from "../lib/format";
  import { currencyOptions, localeOptions, timezoneOptions } from "../lib/labels";
  import { push } from "../lib/push.svelte";
  import { router } from "../lib/router.svelte";
  import { toasts } from "../lib/toast.svelte";
  import type { MePayload, Session } from "../lib/types";

  let name = $state("");
  let baseCurrency = $state("BRL");
  let locale = $state("pt-BR");
  let timezone = $state("America/Sao_Paulo");
  let aiEnabled = $state(false);
  let savingProfile = $state(false);
  let savingPreferences = $state(false);
  let profileError = $state<string | null>(null);
  let preferencesError = $state<string | null>(null);
  let sessions = $state<Session[]>([]);
  let sessionsLoading = $state(true);
  let sessionsError = $state<string | null>(null);

  const timezoneChoices = $derived.by(() => {
    const choices: { value: string; label: string }[] = timezoneOptions.map((option) => ({
      value: option.value,
      label: option.label,
    }));

    if (!choices.some((option) => option.value === timezone)) {
      choices.unshift({ value: timezone, label: timezone });
    }

    return choices;
  });

  $effect(() => {
    const user = auth.user;

    if (!user) return;

    name = user.name;
    baseCurrency = user.preferences.baseCurrency;
    locale = user.preferences.locale;
    timezone = user.preferences.timezone;
    aiEnabled = user.preferences.aiEnabled;
  });

  async function saveProfile(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (savingProfile) return;

    profileError = null;

    if (name.trim().length === 0) {
      profileError = "Informe seu nome.";
      return;
    }

    savingProfile = true;

    try {
      const result = await api<MePayload>("/me", {
        method: "PATCH",
        body: { name: name.trim() },
      });
      auth.updateUser(result.user);
      toasts.success("Perfil atualizado");
    } catch (cause) {
      profileError = errorMessage(cause);
    } finally {
      savingProfile = false;
    }
  }

  async function savePreferences(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (savingPreferences) return;

    preferencesError = null;
    savingPreferences = true;

    try {
      const result = await api<MePayload>("/me/preferences", {
        method: "PATCH",
        body: { timezone, baseCurrency, locale, aiEnabled },
      });
      auth.updateUser(result.user);
      toasts.success("Preferências atualizadas");
    } catch (cause) {
      preferencesError = errorMessage(cause);
    } finally {
      savingPreferences = false;
    }
  }

  async function loadSessions(): Promise<void> {
    sessionsLoading = true;
    sessionsError = null;

    try {
      const payload = await api<{ sessions: Session[] }>("/me/sessions");
      sessions = payload.sessions;
    } catch (cause) {
      sessionsError = errorMessage(cause);
    } finally {
      sessionsLoading = false;
    }
  }

  async function revoke(session: Session): Promise<void> {
    if (!window.confirm("Encerrar esta sessão? Você precisará entrar novamente nela.")) return;

    try {
      await api(`/me/sessions/${session.id}`, { method: "DELETE" });

      if (session.current) {
        await auth.logout();
        router.navigate("/login");
        toasts.push("Sessão encerrada", "info");
        return;
      }

      toasts.success("Sessão encerrada");
      await loadSessions();
    } catch (cause) {
      toasts.error(errorMessage(cause));
    }
  }

  function deviceLabel(session: Session): string {
    if (!session.userAgent) return "Dispositivo desconhecido";

    if (/mobile|android|iphone/i.test(session.userAgent)) return "Celular";
    if (/ipad|tablet/i.test(session.userAgent)) return "Tablet";
    if (/firefox/i.test(session.userAgent)) return "Firefox";
    if (/edg/i.test(session.userAgent)) return "Edge";
    if (/chrome/i.test(session.userAgent)) return "Chrome";
    if (/safari/i.test(session.userAgent)) return "Safari";

    return "Navegador";
  }

  async function togglePush(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const wantsEnabled = input.checked;
    const ok = wantsEnabled ? await push.enable() : await push.disable();

    // O checkbox reflete o estado real: reverte quando a operação falhou.
    input.checked = push.subscribed;

    if (ok && wantsEnabled) {
      toasts.success("Notificações push ativadas");
    } else if (ok) {
      toasts.push("Notificações push desativadas", "info");
    } else if (push.blocked) {
      toasts.error("Permissão de notificações bloqueada no navegador.");
    } else if (push.error) {
      toasts.error(push.error);
    }
  }

  async function sendTestPush(): Promise<void> {
    const ok = await push.sendTest();

    if (ok) {
      toasts.success("Aviso de teste enfileirado");
    } else if (push.error) {
      toasts.error(push.error);
    }
  }

  onMount(() => {
    void loadSessions();
    // Revalida permissão e vínculo: o usuário pode ter mudado de ideia nas
    // configurações do navegador desde o boot.
    void push.refresh();
  });
</script>

<div class="page-head">
  <div>
    <p class="eyebrow">Sua conta</p>
    <h2>Configurações</h2>
    <p class="page-subtitle">Perfil, preferências regionais e sessões ativas.</p>
  </div>
</div>

<div class="settings-grid">
  <section class="card">
    <header class="card-head">
      <div>
        <h3>Perfil</h3>
        <p>Como você aparece dentro do Viva Bem.</p>
      </div>
    </header>

    <form class="form" onsubmit={saveProfile} novalidate>
      {#if profileError}
        <div class="form-error" role="alert">
          <Icon name="alert" size={18} />
          <span>{profileError}</span>
        </div>
      {/if}

      <label class="field">
        <span>Nome</span>
        <input class="input" type="text" maxlength="120" required bind:value={name} />
      </label>

      <label class="field">
        <span>E-mail</span>
        <input class="input" type="email" value={auth.user?.email ?? ""} disabled />
        <small class="hint">O e-mail de acesso não pode ser alterado por aqui.</small>
      </label>

      <div class="form-actions form-actions--start">
        <button class="btn btn--primary" type="submit" disabled={savingProfile}>
          {#if savingProfile}<Spinner label="Salvando" />{/if}
          Salvar perfil
        </button>
      </div>
    </form>
  </section>

  <section class="card">
    <header class="card-head">
      <div>
        <h3>Preferências</h3>
        <p>Moeda, idioma e fuso usados nos resumos e datas.</p>
      </div>
    </header>

    <form class="form" onsubmit={savePreferences} novalidate>
      {#if preferencesError}
        <div class="form-error" role="alert">
          <Icon name="alert" size={18} />
          <span>{preferencesError}</span>
        </div>
      {/if}

      <div class="form-grid form-grid--two">
        <label class="field">
          <span>Moeda base</span>
          <select class="select" bind:value={baseCurrency}>
            {#each currencyOptions as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>

        <label class="field">
          <span>Idioma</span>
          <select class="select" bind:value={locale}>
            {#each localeOptions as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>
      </div>

      <label class="field">
        <span>Fuso horário</span>
        <select class="select" bind:value={timezone}>
          {#each timezoneChoices as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>

      <label class="switch-row">
        <span>
          <strong>Análises com IA</strong>
          <small>
            Permite que insights e correlações sejam gerados a partir dos seus dados. A IA é
            opcional e pode ser desligada a qualquer momento.
          </small>
        </span>
        <input type="checkbox" class="switch" bind:checked={aiEnabled} />
      </label>

      <div class="form-actions form-actions--start">
        <button class="btn btn--primary" type="submit" disabled={savingPreferences}>
          {#if savingPreferences}<Spinner label="Salvando" />{/if}
          Salvar preferências
        </button>
      </div>
    </form>
  </section>
</div>

<section class="card">
  <header class="card-head">
    <div>
      <h3>Notificações push</h3>
      <p>Avisos de orçamento, metas e conquistas mesmo com o app fechado.</p>
    </div>
  </header>

  {#if !push.supported}
    <p class="muted">
      Este navegador não suporta notificações push. No iPhone, instale o app na tela de início
      para habilitar.
    </p>
  {:else if !push.enabled}
    <p class="muted">As notificações push estão desativadas neste servidor.</p>
  {:else if push.blocked}
    <div class="notice notice--error" role="alert">
      <Icon name="alert" />
      <div>
        <strong>Permissão bloqueada</strong>
        <p>Libere as notificações para este site nas configurações do navegador.</p>
      </div>
    </div>
  {:else}
    <div class="stack">
      <label class="switch-row">
        <span>
          <strong>Receber notificações neste dispositivo</strong>
          <small>
            O navegador pedirá permissão na primeira ativação. Você pode desativar a qualquer
            momento.
          </small>
        </span>
        <input
          type="checkbox"
          class="switch"
          checked={push.subscribed}
          disabled={push.busy}
          onchange={togglePush}
        />
      </label>

      {#if push.subscribed}
        <div class="form-actions form-actions--start">
          <button class="btn btn--soft" type="button" onclick={sendTestPush} disabled={push.busy}>
            {#if push.busy}<Spinner label="Enviando" />{/if}
            Enviar aviso de teste
          </button>
        </div>
      {/if}
    </div>
  {/if}

  {#if push.error && !push.blocked}
    <div class="form-error" role="alert">
      <Icon name="alert" size={18} />
      <span>{push.error}</span>
    </div>
  {/if}
</section>

<section class="card">
  <header class="card-head">
    <div>
      <h3>Sessões ativas</h3>
      <p>Revogue acessos que você não reconhece.</p>
    </div>
    <button class="btn btn--ghost btn--sm" type="button" onclick={loadSessions} disabled={sessionsLoading}>
      <Icon name="refresh" size={16} />
      Atualizar
    </button>
  </header>

  {#if sessionsLoading}
    <div class="skeleton skeleton--row" aria-hidden="true"></div>
    <div class="skeleton skeleton--row" aria-hidden="true"></div>
  {:else if sessionsError}
    <div class="notice notice--error" role="alert">
      <Icon name="alert" />
      <div>
        <strong>Não foi possível carregar as sessões</strong>
        <p>{sessionsError}</p>
      </div>
      <button class="btn btn--soft" type="button" onclick={loadSessions}>Tentar novamente</button>
    </div>
  {:else if sessions.length === 0}
    <p class="muted">Nenhuma sessão ativa.</p>
  {:else}
    <div class="session-list">
      {#each sessions as session (session.id)}
        <div class="session-row">
          <span class="session-icon"><Icon name="lock" size={18} /></span>
          <div class="session-main">
            <strong>
              {deviceLabel(session)}
              {#if session.current}<span class="badge badge--active">esta sessão</span>{/if}
            </strong>
            <span class="muted">
              {session.ipAddress ?? "IP desconhecido"} · iniciada em {formatDateTime(session.createdAt)}
              {#if session.lastUsedAt}· usada em {formatDateTime(session.lastUsedAt)}{/if}
            </span>
          </div>
          <button class="btn btn--ghost btn--sm" type="button" onclick={() => revoke(session)}>
            Revogar
          </button>
        </div>
      {/each}
    </div>
  {/if}
</section>
