<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { toasts } from "../lib/toast.svelte";
  import type { FamilyLink } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";

  let {
    open,
    onclose,
    oninvited,
  }: {
    open: boolean;
    onclose: () => void;
    oninvited: (link: FamilyLink) => void;
  } = $props();

  let email = $state("");
  let sending = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (!open) return;

    email = "";
    error = null;
  });

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (sending) return;

    error = null;

    const target = email.trim();
    if (target === "") {
      error = "Informe o e-mail da pessoa.";
      return;
    }

    sending = true;

    try {
      const result = await api<{ link: FamilyLink }>("/family/invite", {
        method: "POST",
        body: { email: target },
      });

      toasts.success("Convite enviado");
      oninvited(result.link);
      onclose();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      sending = false;
    }
  }
</script>

<Modal {open} title="Convidar para a família" {onclose}>
  <form class="form" onsubmit={handleSubmit} novalidate>
    <p class="hint">
      A outra pessoa precisa ter uma conta no Viva Bem. Ela recebe uma notificação
      e só compartilha o resumo depois de aceitar.
    </p>

    {#if error}
      <div class="form-error" role="alert">
        <Icon name="alert" size={18} />
        <span>{error}</span>
      </div>
    {/if}

    <label class="field">
      <span>E-mail</span>
      <input
        class="input"
        type="email"
        autocomplete="email"
        placeholder="parceiro@exemplo.com"
        maxlength="320"
        required
        bind:value={email}
      />
    </label>

    <div class="form-actions">
      <button class="btn btn--ghost" type="button" onclick={onclose} disabled={sending}>
        Cancelar
      </button>
      <button class="btn btn--primary" type="submit" disabled={sending}>
        {#if sending}<Spinner label="Enviando" />{/if}
        Enviar convite
      </button>
    </div>
  </form>
</Modal>
