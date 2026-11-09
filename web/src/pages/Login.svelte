<script lang="ts">
  import AuthLayout from "../components/AuthLayout.svelte";
  import Icon from "../components/Icon.svelte";
  import Spinner from "../components/Spinner.svelte";
  import { errorMessage } from "../lib/api";
  import { auth } from "../lib/auth.svelte";
  import { router } from "../lib/router.svelte";

  let email = $state("");
  let password = $state("");
  let error = $state<string | null>(null);
  let submitting = $state(false);

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (submitting) return;

    error = null;
    submitting = true;

    try {
      await auth.login(email.trim(), password);
      router.navigate("/dashboard");
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      submitting = false;
    }
  }
</script>

<AuthLayout title="Entrar" subtitle="Use seu e-mail e senha para acessar sua conta.">
  <form class="form" onsubmit={handleSubmit} novalidate>
    {#if error}
      <div class="form-error" role="alert">
        <Icon name="alert" size={18} />
        <span>{error}</span>
      </div>
    {/if}

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

    <label class="field">
      <span>Senha</span>
      <span class="input-wrap">
        <Icon name="lock" size={18} />
        <input
          class="input input--icon"
          type="password"
          name="password"
          autocomplete="current-password"
          placeholder="Sua senha"
          required
          bind:value={password}
        />
      </span>
    </label>

    <button class="btn btn--primary btn--block" type="submit" disabled={submitting}>
      {#if submitting}
        <Spinner label="Entrando" />
        Entrando…
      {:else}
        Entrar
        <Icon name="arrowRight" size={18} />
      {/if}
    </button>
  </form>

  {#snippet footer()}
    <p>Não tem conta? <a href="#/register">Criar conta</a></p>
  {/snippet}
</AuthLayout>
