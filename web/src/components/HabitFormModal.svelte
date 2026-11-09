<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { habitFrequencyOptions, habitTypeOptions, weekdayOptions } from "../lib/labels";
  import { toasts } from "../lib/toast.svelte";
  import type { Habit, HabitFrequencyType, HabitType } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";

  let {
    open,
    habit = null,
    habits,
    onclose,
    onsaved,
  }: {
    open: boolean;
    habit?: Habit | null;
    habits: readonly Habit[];
    onclose: () => void;
    onsaved: (habit: Habit) => void;
  } = $props();

  let name = $state("");
  let description = $state("");
  let habitType = $state<HabitType>("good");
  let frequencyType = $state<HabitFrequencyType>("daily");
  let daysOfWeek = $state<number[]>([]);
  let dailyTarget = $state(1);
  let targetUnit = $state("");
  let color = $state("#22c55e");
  let parentHabitId = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);

  const editing = $derived(habit !== null);
  const parentOptions = $derived(
    habits.filter(
      (option) =>
        option.isActive &&
        option.id !== habit?.id &&
        option.habitType === habitType,
    ),
  );
  const needsDays = $derived(frequencyType === "weekly" || frequencyType === "custom");

  $effect(() => {
    if (!open) return;

    error = null;

    if (habit) {
      name = habit.name;
      description = habit.description ?? "";
      habitType = habit.habitType;
      frequencyType = habit.frequencyType;
      daysOfWeek = [...habit.daysOfWeek];
      dailyTarget = habit.dailyTarget;
      targetUnit = habit.targetUnit ?? "";
      color = habit.color ?? "#22c55e";
      parentHabitId = habit.parentHabitId ?? "";
      return;
    }

    name = "";
    description = "";
    habitType = "good";
    frequencyType = "daily";
    daysOfWeek = [];
    dailyTarget = 1;
    targetUnit = "";
    color = "#22c55e";
    parentHabitId = "";
  });

  function changeFrequency(next: HabitFrequencyType): void {
    frequencyType = next;

    if (next === "daily") {
      daysOfWeek = [];
    } else if (next === "weekly" && daysOfWeek.length !== 1) {
      daysOfWeek = daysOfWeek.length > 0 ? daysOfWeek.slice(0, 1) : [1];
    }
  }

  function toggleDay(day: number): void {
    if (frequencyType === "daily") return;

    if (frequencyType === "weekly") {
      daysOfWeek = [day];
      return;
    }

    daysOfWeek = daysOfWeek.includes(day)
      ? daysOfWeek.filter((entry) => entry !== day)
      : [...daysOfWeek, day].sort((a, b) => a - b);
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (saving) return;

    error = null;

    if (name.trim().length === 0) {
      error = "Dê um nome ao hábito.";
      return;
    }

    if (needsDays && daysOfWeek.length === 0) {
      error = "Escolha ao menos um dia da semana.";
      return;
    }

    if (dailyTarget < 1) {
      error = "A meta diária precisa ser maior que zero.";
      return;
    }

    const body = {
      name: name.trim(),
      description: description.trim() === "" ? null : description.trim(),
      color,
      habitType,
      frequencyType,
      daysOfWeek: needsDays ? daysOfWeek : [],
      dailyTarget,
      targetUnit: targetUnit.trim() === "" ? null : targetUnit.trim(),
      parentHabitId: parentHabitId === "" ? null : parentHabitId,
    };

    saving = true;

    try {
      const result = editing && habit
        ? await api<{ habit: Habit }>(`/habits/${habit.id}`, { method: "PATCH", body })
        : await api<{ habit: Habit }>("/habits", { method: "POST", body });

      toasts.success(editing ? "Hábito atualizado" : "Hábito criado");
      onsaved(result.habit);
      onclose();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      saving = false;
    }
  }
</script>

<Modal {open} title={editing ? "Editar hábito" : "Novo hábito"} {onclose}>
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
        placeholder="Ex.: Beber 2L de água"
        maxlength="100"
        required
        bind:value={name}
      />
    </label>

    <label class="field">
      <span>Descrição (opcional)</span>
      <textarea
        class="textarea"
        rows="2"
        maxlength="500"
        placeholder="Por que este hábito importa?"
        bind:value={description}
      ></textarea>
    </label>

    <div class="form-grid form-grid--two">
      <label class="field">
        <span>Tipo</span>
        <select class="select" bind:value={habitType}>
          {#each habitTypeOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
        {#if editing}
          <small class="hint">O tipo não muda depois de existirem registros.</small>
        {/if}
      </label>

      <label class="field">
        <span>Frequência</span>
        <select
          class="select"
          value={frequencyType}
          onchange={(event) =>
            changeFrequency((event.currentTarget as HTMLSelectElement).value as HabitFrequencyType)}
        >
          {#each habitFrequencyOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>
    </div>

    {#if needsDays}
      <div class="field">
        <span>Dias da semana</span>
        <div class="weekday-picker" role="group" aria-label="Dias da semana">
          {#each weekdayOptions as day (day.value)}
            <button
              class="weekday-picker__day"
              class:active={daysOfWeek.includes(day.value)}
              type="button"
              aria-pressed={daysOfWeek.includes(day.value)}
              title={day.label}
              onclick={() => toggleDay(day.value)}
            >
              {day.short}
            </button>
          {/each}
        </div>
        <small class="hint">
          {frequencyType === "weekly"
            ? "Hábitos semanais usam exatamente um dia."
            : "Marque todos os dias em que o hábito deve acontecer."}
        </small>
      </div>
    {/if}

    <div class="form-grid form-grid--three">
      <label class="field">
        <span>Meta diária</span>
        <input class="input" type="number" min="1" max="1000000" bind:value={dailyTarget} />
      </label>

      <label class="field">
        <span>Unidade (opcional)</span>
        <input
          class="input"
          type="text"
          maxlength="50"
          placeholder="vezes, páginas…"
          bind:value={targetUnit}
        />
      </label>

      <label class="field">
        <span>Cor</span>
        <input class="input input--color" type="color" bind:value={color} />
      </label>
    </div>

    <label class="field">
      <span>Hábito pai (opcional)</span>
      <select class="select" bind:value={parentHabitId}>
        <option value="">Sem hábito pai</option>
        {#each parentOptions as option (option.id)}
          <option value={option.id}>{option.name}</option>
        {/each}
      </select>
      <small class="hint">Empilhe hábitos para criar rotinas encadeadas (até 5 níveis).</small>
    </label>

    <div class="form-actions">
      <button class="btn btn--ghost" type="button" onclick={onclose} disabled={saving}>
        Cancelar
      </button>
      <button class="btn btn--primary" type="submit" disabled={saving}>
        {#if saving}<Spinner label="Salvando" />{/if}
        {editing ? "Salvar alterações" : "Criar hábito"}
      </button>
    </div>
  </form>
</Modal>
