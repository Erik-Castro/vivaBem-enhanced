<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { toasts } from "../lib/toast.svelte";
  import type { Habit, HabitTrigger } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";

  let {
    open,
    trigger = null,
    habits,
    onclose,
    onsaved,
  }: {
    open: boolean;
    trigger?: HabitTrigger | null;
    habits: readonly Habit[];
    onclose: () => void;
    onsaved: (trigger: HabitTrigger) => void;
  } = $props();

  let badHabitId = $state("");
  let replacementHabitId = $state("");
  let triggerDescription = $state("");
  let alternativeAction = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);

  const editing = $derived(trigger !== null);
  const badOptions = $derived(
    habits.filter(
      (habit) => habit.habitType === "bad" && (habit.isActive || habit.id === badHabitId),
    ),
  );
  const goodOptions = $derived(
    habits.filter(
      (habit) =>
        habit.habitType === "good" &&
        habit.id !== badHabitId &&
        (habit.isActive || habit.id === replacementHabitId),
    ),
  );

  $effect(() => {
    if (!open) return;

    error = null;

    if (trigger) {
      badHabitId = trigger.badHabitId;
      replacementHabitId = trigger.replacementHabitId ?? "";
      triggerDescription = trigger.triggerDescription;
      alternativeAction = trigger.alternativeAction ?? "";
      return;
    }

    badHabitId = "";
    replacementHabitId = "";
    triggerDescription = "";
    alternativeAction = "";
  });

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (saving) return;

    error = null;

    if (!editing && badHabitId === "") {
      error = "Escolha o hábito ruim que este gatilho acompanha.";
      return;
    }

    if (triggerDescription.trim().length === 0) {
      error = "Descreva o gatilho.";
      return;
    }

    const body = {
      replacementHabitId: replacementHabitId === "" ? null : replacementHabitId,
      triggerDescription: triggerDescription.trim(),
      alternativeAction:
        alternativeAction.trim() === "" ? null : alternativeAction.trim(),
    };

    saving = true;

    try {
      const result = editing && trigger
        ? await api<{ trigger: HabitTrigger }>(`/habit-triggers/${trigger.id}`, {
          method: "PATCH",
          body,
        })
        : await api<{ trigger: HabitTrigger }>("/habit-triggers", {
          method: "POST",
          body: { ...body, badHabitId },
        });

      toasts.success(editing ? "Gatilho atualizado" : "Gatilho criado");
      onsaved(result.trigger);
      onclose();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      saving = false;
    }
  }
</script>

<Modal {open} title={editing ? "Editar gatilho" : "Novo gatilho"} {onclose}>
  <form class="form" onsubmit={handleSubmit} novalidate>
    {#if error}
      <div class="form-error" role="alert">
        <Icon name="alert" size={18} />
        <span>{error}</span>
      </div>
    {/if}

    {#if editing}
      <p class="hint">Hábito ruim: {trigger?.badHabitName}</p>
    {:else}
      <label class="field">
        <span>Hábito ruim</span>
        <select class="select" bind:value={badHabitId} required>
          <option value="">Selecione</option>
          {#each badOptions as habit (habit.id)}
            <option value={habit.id}>{habit.name}</option>
          {/each}
        </select>
        {#if badOptions.length === 0}
          <small class="hint">Crie um hábito do tipo "ruim" antes de registrar gatilhos.</small>
        {/if}
      </label>
    {/if}

    <label class="field">
      <span>Gatilho</span>
      <input
        class="input"
        type="text"
        maxlength="500"
        placeholder="Ex.: Ansiedade depois do trabalho"
        required
        bind:value={triggerDescription}
      />
    </label>

    <label class="field">
      <span>Substituição (opcional)</span>
      <select class="select" bind:value={replacementHabitId}>
        <option value="">Sem hábito de substituição</option>
        {#each goodOptions as habit (habit.id)}
          <option value={habit.id}>{habit.name}</option>
        {/each}
      </select>
    </label>

    <label class="field">
      <span>Ação alternativa (opcional)</span>
      <textarea
        class="textarea"
        rows="2"
        maxlength="500"
        placeholder="O que fazer no lugar?"
        bind:value={alternativeAction}
      ></textarea>
    </label>

    <div class="form-actions">
      <button class="btn btn--ghost" type="button" onclick={onclose} disabled={saving}>
        Cancelar
      </button>
      <button class="btn btn--primary" type="submit" disabled={saving}>
        {#if saving}<Spinner label="Salvando" />{/if}
        {editing ? "Salvar alterações" : "Criar gatilho"}
      </button>
    </div>
  </form>
</Modal>
