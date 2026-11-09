<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { formatDate, todayISO } from "../lib/format";
  import { habitRecurrenceLabel, habitTypeLabel, weekdayOptions } from "../lib/labels";
  import { toasts } from "../lib/toast.svelte";
  import type {
    Habit,
    HabitCalendar,
    HabitCalendarDay,
    HabitLog,
    HabitStreak,
    HabitTrigger,
  } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";

  let {
    open,
    habit = null,
    triggers,
    onclose,
    onchanged,
  }: {
    open: boolean;
    habit?: Habit | null;
    triggers: readonly HabitTrigger[];
    onclose: () => void;
    onchanged: () => void;
  } = $props();

  let month = $state(todayISO().slice(0, 7));
  let calendar = $state<HabitCalendar | null>(null);
  let logs = $state<HabitLog[]>([]);
  let streak = $state<HabitStreak | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let selectedDate = $state(todayISO());
  let value = $state("1");
  let note = $state("");
  let triggerId = $state("");
  let replacementUsed = $state(false);
  let saving = $state(false);
  let removing = $state<string | null>(null);

  const today = todayISO();
  const habitTriggers = $derived(
    habit === null ? [] : triggers.filter((trigger) => trigger.badHabitId === habit.id),
  );
  const leadingBlanks = $derived.by(() => {
    if (calendar === null || calendar.days.length === 0) return [];
    const first = calendar.days[0]?.date ?? `${month}-01`;
    return Array.from({ length: isoWeekday(first) - 1 }, (_, index) => index);
  });
  const monthLabel = $derived(formatMonth(month));

  $effect(() => {
    if (!open || habit === null) return;

    month = todayISO().slice(0, 7);
    void loadMonth(month);
  });

  function isoWeekday(date: string): number {
    const parsed = new Date(`${date}T00:00:00Z`);
    return ((parsed.getUTCDay() + 6) % 7) + 1;
  }

  function monthEnd(target: string): string {
    const [year, monthNumber] = target.split("-").map(Number);

    if (!year || !monthNumber) return `${target}-01`;

    return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  }

  function shiftMonth(delta: number): void {
    const [year, monthNumber] = month.split("-").map(Number);

    if (!year || !monthNumber) return;

    const next = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
    month = next.toISOString().slice(0, 7);
    void loadMonth(month);
  }

  function formatMonth(target: string): string {
    const [year, monthNumber] = target.split("-").map(Number);

    if (!year || !monthNumber) return target;

    return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
      new Date(Date.UTC(year, monthNumber - 1, 1)),
    );
  }

  function defaultValue(current: Habit): string {
    return String(current.habitType === "bad" ? 0 : current.dailyTarget);
  }

  function applyDay(next: string): void {
    if (habit === null) return;

    selectedDate = next;

    const log = logs.find((entry) => entry.logDate === next);

    if (log) {
      value = String(log.value);
      note = log.note ?? "";
      triggerId = log.triggerId ?? "";
      replacementUsed = log.replacementUsed;
      return;
    }

    value = defaultValue(habit);
    note = "";
    triggerId = "";
    replacementUsed = false;
  }

  async function loadMonth(target: string): Promise<void> {
    if (habit === null) return;

    loading = true;
    error = null;

    try {
      const from = `${target}-01`;
      const to = monthEnd(target);
      const [calendarPayload, logsPayload, streakPayload] = await Promise.all([
        api<{ calendar: HabitCalendar }>(`/habits/${habit.id}/calendar`, {
          query: { from, to },
        }),
        api<{ logs: HabitLog[] }>(`/habits/${habit.id}/logs`, {
          query: { from, to, limit: 100 },
        }),
        api<{ streak: HabitStreak }>(`/habits/${habit.id}/streak`),
      ]);

      calendar = calendarPayload.calendar;
      logs = logsPayload.logs;
      streak = streakPayload.streak;

      const preferred = today >= from && today <= to ? today : from;
      applyDay(preferred);
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  function dayClass(day: HabitCalendarDay): string {
    const classes = ["habit-day", `habit-day--${day.status}`];

    if (day.date === selectedDate) classes.push("habit-day--selected");
    if (day.date === today) classes.push("habit-day--today");

    return classes.join(" ");
  }

  function dayLabel(day: HabitCalendarDay): string {
    if (day.status === "not_scheduled") return "Fora da agenda";
    if (day.status === "pending") return "Pendente";
    if (day.status === "missed") return habit?.habitType === "bad" ? "Recaída" : "Perdido";
    return habit?.habitType === "bad" ? "Dia limpo" : "Cumprido";
  }

  async function saveLog(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (habit === null || saving) return;

    error = null;

    const numeric = Number(value);

    if (!Number.isFinite(numeric) || numeric < 0) {
      error = "Informe um valor válido.";
      return;
    }

    saving = true;

    try {
      await api(`/habits/${habit.id}/logs`, {
        method: "POST",
        body: {
          logDate: selectedDate,
          value: numeric,
          note: note.trim() === "" ? null : note.trim(),
          triggerId: triggerId === "" ? null : triggerId,
          replacementUsed: triggerId !== "" && replacementUsed,
        },
      });

      toasts.success("Registro salvo");
      await loadMonth(month);
      onchanged();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      saving = false;
    }
  }

  async function deleteLog(logId: string): Promise<void> {
    if (habit === null) return;
    if (!window.confirm("Remover este registro? O streak será recalculado.")) return;

    removing = logId;

    try {
      await api(`/habits/${habit.id}/logs/${logId}`, { method: "DELETE" });
      toasts.success("Registro removido");
      await loadMonth(month);
      onchanged();
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      removing = null;
    }
  }
</script>

<Modal {open} title={habit ? habit.name : "Detalhes do hábito"} {onclose}>
  {#if habit === null}
    <p class="muted">Selecione um hábito.</p>
  {:else}
    <div class="habit-detail">
      <div class="habit-detail__badges">
        <span class="badge {habit.habitType === "good" ? "badge--active" : "badge--danger"}">
          {habitTypeLabel(habit.habitType)}
        </span>
        <span class="badge badge--soon">
          {habitRecurrenceLabel(habit)}
        </span>
        {#if habit.dailyTarget > 1}
          <span class="badge badge--pending">
            Meta {habit.dailyTarget}{habit.targetUnit ? ` ${habit.targetUnit}` : ""}
          </span>
        {/if}
      </div>

      {#if streak}
        <div class="grid grid--stats habit-streak">
          <div class="stat">
            <span class="stat__label">Sequência atual</span>
            <strong class="stat__value">{streak.currentStreak}</strong>
            <span class="stat__hint">
              {streak.completedToday ? "Hoje cumprido" : "Hoje pendente"}
            </span>
          </div>
          <div class="stat">
            <span class="stat__label">Recorde</span>
            <strong class="stat__value">{streak.longestStreak}</strong>
            <span class="stat__hint">
              {streak.lastCompletedDate
                ? `Último: ${formatDate(streak.lastCompletedDate)}`
                : "Sem registros"}
            </span>
          </div>
        </div>
      {/if}

      {#if error}
        <div class="form-error" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
        </div>
      {/if}

      <div class="habit-calendar">
        <div class="habit-calendar__head">
          <button
            class="btn btn--icon btn--ghost btn--sm"
            type="button"
            aria-label="Mês anterior"
            onclick={() => shiftMonth(-1)}
          >
            <Icon name="chevronLeft" size={16} />
          </button>
          <strong class="habit-calendar__month">{monthLabel}</strong>
          <button
            class="btn btn--icon btn--ghost btn--sm"
            type="button"
            aria-label="Próximo mês"
            onclick={() => shiftMonth(1)}
          >
            <Icon name="chevronRight" size={16} />
          </button>
        </div>

        <div class="habit-calendar__weekdays" aria-hidden="true">
          {#each weekdayOptions as day (day.value)}
            <span>{day.short}</span>
          {/each}
        </div>

        <div class="habit-calendar__grid">
          {#each leadingBlanks as blank (`blank-${blank}`)}
            <span class="habit-day habit-day--blank"></span>
          {/each}
          {#each calendar?.days ?? [] as day (day.date)}
            <button
              class={dayClass(day)}
              type="button"
              disabled={!day.scheduled || day.date > today}
              aria-pressed={day.date === selectedDate}
              aria-label={`${formatDate(day.date)} — ${dayLabel(day)}`}
              title={`${formatDate(day.date)} — ${dayLabel(day)}`}
              onclick={() => applyDay(day.date)}
            >
              {Number(day.date.slice(8, 10))}
            </button>
          {/each}
        </div>

        <div class="habit-calendar__legend">
          <span><i class="dot dot--completed"></i>{habit.habitType === "bad"
              ? "Dia limpo"
              : "Cumprido"}</span>
          <span><i class="dot dot--pending"></i>Pendente</span>
          <span><i class="dot dot--missed"></i>{habit.habitType === "bad"
              ? "Recaída"
              : "Perdido"}</span>
        </div>
      </div>

      {#if loading}
        <p class="muted">Carregando registros…</p>
      {:else}
        <form class="habit-log-form" onsubmit={saveLog} novalidate>
          <div class="habit-log-form__head">
            <h3>Registro de {formatDate(selectedDate)}</h3>
          </div>

          <div class="form-grid form-grid--two">
            {#if habit.habitType === "bad"}
              <label class="field">
                <span>Resultado</span>
                <select class="select" bind:value={value}>
                  <option value="0">Dia limpo</option>
                  <option value="1">Recaída</option>
                </select>
              </label>
            {:else}
              <label class="field">
                <span>Progresso</span>
                <input class="input" type="number" min="0" max="1000000" bind:value={value} />
                <small class="hint">
                  Meta diária: {habit.dailyTarget}{habit.targetUnit ? ` ${habit.targetUnit}` : ""}.
                </small>
              </label>
            {/if}

            <label class="field">
              <span>Nota (opcional)</span>
              <input
                class="input"
                type="text"
                maxlength="500"
                placeholder="Como foi?"
                bind:value={note}
              />
            </label>
          </div>

          {#if habitTriggers.length > 0}
            <div class="form-grid form-grid--two">
              <label class="field">
                <span>Gatilho (opcional)</span>
                <select class="select" bind:value={triggerId}>
                  <option value="">Sem gatilho</option>
                  {#each habitTriggers as trigger (trigger.id)}
                    <option value={trigger.id}>{trigger.triggerDescription}</option>
                  {/each}
                </select>
              </label>

              {#if triggerId !== ""}
                <label class="checkbox checkbox--field">
                  <input type="checkbox" bind:checked={replacementUsed} />
                  <span>Usei a substituição</span>
                </label>
              {/if}
            </div>
          {/if}

          <div class="form-actions">
            <button class="btn btn--primary btn--sm" type="submit" disabled={saving}>
              {#if saving}<Spinner label="Salvando" />{/if}
              Salvar registro
            </button>
          </div>
        </form>
      {/if}

      <div class="habit-history">
        <h3>Registros do mês</h3>
        {#if logs.length === 0}
          <p class="muted">Nenhum registro neste mês.</p>
        {:else}
          <ul class="habit-history__list">
            {#each logs as log (log.id)}
              <li class="habit-history__row">
                <div class="habit-history__main">
                  <strong>{formatDate(log.logDate)}</strong>
                  <span class="muted">
                    {habit.habitType === "bad"
                      ? log.value <= 0
                        ? "Dia limpo"
                        : "Recaída"
                      : `${log.value}${habit.targetUnit ? ` ${habit.targetUnit}` : ""}`}
                  </span>
                  {#if log.note}
                    <span class="hint">{log.note}</span>
                  {/if}
                </div>
                <button
                  class="btn btn--icon btn--ghost btn--sm"
                  type="button"
                  title="Remover registro"
                  aria-label="Remover registro"
                  disabled={removing === log.id}
                  onclick={() => deleteLog(log.id)}
                >
                  <Icon name="trash" size={15} />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}
</Modal>
