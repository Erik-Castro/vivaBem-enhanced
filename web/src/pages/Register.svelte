<script lang="ts">
  import AuthLayout from "../components/AuthLayout.svelte";
  import Icon from "../components/Icon.svelte";
  import Spinner from "../components/Spinner.svelte";
  import { errorMessage } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { router } from "../lib/router.svelte";

  let name = $state("");
  let email = $state("");
  let password = $state("");
  let confirmation = $state("");
  let error = $state<string | null>(null);
  let submitting = $state(false);

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (submitting) return;

    error = null;

    if (name.trim().length === 0) {
      error = "Informe seu nome.";
      return;
    }

    if (password.length < 8) {
      error = "A senha precisa ter pelo menos 8 caracteres.";
      return;
    }

    if (password !== confirmation) {
      error = "As senhas não conferem.";
      return;
    }

    submitting = true;

    try {
      await auth.register(name.trim(), email.trim(), password);
      router.navigate("/dashboard");
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      submitting = false;
    }
  }
</script>

<AuthLayout title="Criar conta" subtitle="Comece a organizar suas finanças em poucos minutos.">
  <form class="form" onsubmit={handleSubmit} novalidate>
    {#if error}
      <div class="form-error" role="alert">
        <Icon name="alert" size={18} />
        <span>{error}</span>
      </div>
    {/if}

    <label class="field">
      <span>Nome</span>
      <span class="input-wrap">
        <Icon name="user" size={18} />
        <input
          class="input input--icon"
          type="text"
          name="name"
          autocomplete="name"
          placeholder="Como quer ser chamado?"
          maxlength="120"
          required
          bind:value={name}
        />
      </span>
    </label>

    <label class="field">
      <span>E-mail</span>
      <span class="input-wrap">
        <Icon name="mail" size={18} />
        <input
          class="input input--icon"
          type="email"
          name="email"
          autocomplete="email"
          placeholder="voce@exemplo.com"
          required
          bind:value={email}
        />
      </span>
    </label>

    <div class="form-grid form-grid--two">
      <label class="field">
        <span>Senha</span>
        <input
          class="input"
          type="password"
          name="password"
          autocomplete="new-password"
          placeholder="Mínimo de 8"
          minlength="8"
          required
          bind:value={password}
        />
      </label>

      <label class="field">
        <span>Confirmar senha</span>
        <input
          class="input"
          type="password"
          name="confirmation"
          autocomplete="new-password"
          placeholder="Repita a senha"
          minlength="8"
          required
          bind:value={confirmation}
        />
      </label>
    </div>

    <button class="btn btn--primary btn--block" type="submit" disabled={submitting}>
      {#if submitting}
        <Spinner label="Criando conta" />
        Criando conta…
      {:else}
        Criar conta
        <Icon name="arrowRight" size={18} />
      {/if}
    </button>
  </form>

  {#snippet footer()}
    <p>Já tem conta? <a href="#/login">Entrar</a></p>
  {/snippet}
</AuthLayout>
