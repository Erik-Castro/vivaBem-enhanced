import { assertEquals } from "@std/assert";
import { createTestApp, type TestApp } from "../helpers/app.ts";
import { AuthTestClient } from "../helpers/auth-client.ts";
import { addDays, isoWeekday, todayUtc } from "../../src/shared/utils/date.ts";

const PASSWORD = "senha-super-segura";

async function register(
  app: TestApp["app"],
  email = "habits@example.com",
): Promise<AuthTestClient> {
  const client = new AuthTestClient(app);
  await client.bootstrapCsrf();

  const response = await client.request("/api/v1/auth/register", {
    method: "POST",
    body: { name: "Ana", email, password: PASSWORD },
  });
  assertEquals(response.status, 201);

  return client;
}

async function createHabit(
  client: AuthTestClient,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await client.request("/api/v1/habits", { method: "POST", body });
  const json = await response.json();
  assertEquals(response.status, 201, JSON.stringify(json));
  return json.data.habit;
}

async function createLog(
  client: AuthTestClient,
  habitId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await client.request(`/api/v1/habits/${habitId}/logs`, {
    method: "POST",
    body,
  });
  const json = await response.json();
  assertEquals(response.status, 201, JSON.stringify(json));
  return json.data.log;
}

function backdateHabit(testApp: TestApp, habitId: string, date: string): void {
  testApp.database.db
    .prepare<[string, string]>("UPDATE habits SET created_at = ? WHERE id = ?")
    .run(`${date}T12:00:00.000Z`, habitId);
}

function datesWithWeekdays(from: string, to: string, weekdays: readonly number[]): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (weekdays.includes(isoWeekday(date))) dates.push(date);
  }
  return dates;
}

Deno.test("rotas de hábitos exigem autenticação", async () => {
  const testApp = await createTestApp();

  try {
    for (
      const path of [
        "/api/v1/habits",
        "/api/v1/habits/unknown",
        "/api/v1/habits/unknown/streak",
        "/api/v1/habits/unknown/calendar",
        "/api/v1/habit-triggers",
      ]
    ) {
      const response = await testApp.app.request(path);
      assertEquals(response.status, 401, path);
      assertEquals((await response.json()).error.code, "UNAUTHORIZED");
    }
  } finally {
    testApp.cleanup();
  }
});

Deno.test("CRUD de hábito valida frequência e mantém um log por dia", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const today = todayUtc();

    const habit = await createHabit(client, {
      name: "Beber água",
      habitType: "good",
      frequencyType: "daily",
      dailyTarget: 2,
      color: "#22C55E",
    });

    assertEquals(habit.daysOfWeek, []);
    assertEquals(habit.orderIndex, 0);
    assertEquals(habit.isActive, true);
    assertEquals(habit.color, "#22c55e");

    const second = await createHabit(client, {
      name: "Ler",
      habitType: "good",
      frequencyType: "daily",
    });
    assertEquals(second.orderIndex, 1);

    for (
      const body of [
        { name: "Semanal inválido", habitType: "good", frequencyType: "weekly" },
        { name: "Semanal duplo", habitType: "good", frequencyType: "weekly", daysOfWeek: [1, 2] },
        { name: "Diário com dias", habitType: "good", frequencyType: "daily", daysOfWeek: [1] },
        { name: "Custom vazio", habitType: "good", frequencyType: "custom" },
      ]
    ) {
      const response = await client.request("/api/v1/habits", { method: "POST", body });
      assertEquals(response.status, 400, JSON.stringify(body));
    }

    const weekly = await createHabit(client, {
      name: "Revisão semanal",
      habitType: "good",
      frequencyType: "weekly",
      daysOfWeek: [1],
    });
    assertEquals(weekly.daysOfWeek, [1]);

    const renamed = await client.request(`/api/v1/habits/${habit.id}`, {
      method: "PATCH",
      body: { name: "Beber 2L de água" },
    });
    assertEquals(renamed.status, 200);
    assertEquals((await renamed.json()).data.habit.name, "Beber 2L de água");

    const firstLogResponse = await client.request(`/api/v1/habits/${habit.id}/logs`, {
      method: "POST",
      body: { logDate: today, value: 2, note: "Meta batida" },
    });
    const firstLog = await firstLogResponse.json();
    assertEquals(firstLogResponse.status, 201, JSON.stringify(firstLog));
    assertEquals(firstLog.data.log.value, 2);
    assertEquals(firstLog.data.log.note, "Meta batida");

    const updatedLogResponse = await client.request(`/api/v1/habits/${habit.id}/logs`, {
      method: "POST",
      body: { logDate: today, value: 3 },
    });
    const updatedLog = await updatedLogResponse.json();
    assertEquals(updatedLogResponse.status, 200, JSON.stringify(updatedLog));
    assertEquals(updatedLog.data.log.id, firstLog.data.log.id);
    assertEquals(updatedLog.data.log.value, 3);
    assertEquals(updatedLog.data.log.note, null);

    const listResponse = await client.request(`/api/v1/habits/${habit.id}/logs`);
    const listed = await listResponse.json();
    assertEquals(listed.data.logs.length, 1);
    assertEquals(listed.meta.hasMore, false);

    const futureResponse = await client.request(`/api/v1/habits/${habit.id}/logs`, {
      method: "POST",
      body: { logDate: addDays(today, 1) },
    });
    assertEquals(futureResponse.status, 400);

    const deleteLogResponse = await client.request(
      `/api/v1/habits/${habit.id}/logs/${firstLog.data.log.id}`,
      { method: "DELETE" },
    );
    assertEquals(deleteLogResponse.status, 204);

    const emptyLogs = await (await client.request(`/api/v1/habits/${habit.id}/logs`)).json();
    assertEquals(emptyLogs.data.logs.length, 0);

    const restoredResponse = await client.request(`/api/v1/habits/${habit.id}/logs`, {
      method: "POST",
      body: { logDate: today, value: 2 },
    });
    const restored = await restoredResponse.json();
    assertEquals(restoredResponse.status, 201);
    assertEquals(restored.data.log.id, firstLog.data.log.id);

    const typeChange = await client.request(`/api/v1/habits/${habit.id}`, {
      method: "PATCH",
      body: { habitType: "bad" },
    });
    assertEquals(typeChange.status, 409);

    const deleteResponse = await client.request(`/api/v1/habits/${habit.id}`, {
      method: "DELETE",
    });
    assertEquals(deleteResponse.status, 204);

    const inactive = await (await client.request(`/api/v1/habits/${habit.id}`)).json();
    assertEquals(inactive.data.habit.isActive, false);

    const activeList = await (await client.request("/api/v1/habits")).json();
    assertEquals(activeList.data.habits.length, 2);

    const allList = await (await client.request("/api/v1/habits?includeInactive=true")).json();
    assertEquals(allList.data.habits.length, 3);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("streak diário e calendário refletem logs e o dia corrente", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const today = todayUtc();
    const start = addDays(today, -3);

    const habit = await createHabit(client, {
      name: "Caminhar",
      habitType: "good",
      frequencyType: "daily",
    });
    backdateHabit(testApp, habit.id as string, start);

    for (const date of [addDays(today, -3), addDays(today, -2), addDays(today, -1)]) {
      await createLog(client, habit.id as string, { logDate: date });
    }

    const streakResponse = await client.request(
      `/api/v1/habits/${habit.id}/streak?date=${today}`,
    );
    const streak = (await streakResponse.json()).data.streak;

    assertEquals(streakResponse.status, 200);
    assertEquals(streak.currentStreak, 3);
    assertEquals(streak.longestStreak, 3);
    assertEquals(streak.lastCompletedDate, addDays(today, -1));
    assertEquals(streak.scheduledToday, true);
    assertEquals(streak.completedToday, false);

    const calendarResponse = await client.request(
      `/api/v1/habits/${habit.id}/calendar?from=${addDays(today, -4)}&to=${addDays(today, 1)}` +
        `&date=${today}`,
    );
    const calendar = (await calendarResponse.json()).data.calendar;

    assertEquals(calendarResponse.status, 200);
    assertEquals(calendar.days.map((day: { status: string }) => day.status), [
      "not_scheduled",
      "completed",
      "completed",
      "completed",
      "pending",
      "pending",
    ]);

    await createLog(client, habit.id as string, { logDate: today });

    const afterLog = await (
      await client.request(`/api/v1/habits/${habit.id}/streak?date=${today}`)
    ).json();
    assertEquals(afterLog.data.streak.currentStreak, 4);
    assertEquals(afterLog.data.streak.longestStreak, 4);
    assertEquals(afterLog.data.streak.completedToday, true);
    assertEquals(afterLog.data.streak.lastCompletedDate, today);

    const afterCalendar = await (
      await client.request(
        `/api/v1/habits/${habit.id}/calendar?from=${today}&to=${today}&date=${today}`,
      )
    ).json();
    assertEquals(afterCalendar.data.calendar.days[0].status, "completed");
  } finally {
    testApp.cleanup();
  }
});

Deno.test("streak semanal e personalizado pulam dias não agendados", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const today = todayUtc();
    const lastMonday = addDays(today, -(isoWeekday(today) - 1));

    const weekly = await createHabit(client, {
      name: "Revisão",
      habitType: "good",
      frequencyType: "weekly",
      daysOfWeek: [1],
    });
    const weeklyStart = addDays(lastMonday, -14);
    backdateHabit(testApp, weekly.id as string, weeklyStart);

    const weeklyDates = datesWithWeekdays(weeklyStart, today, [1]);
    for (const date of weeklyDates) {
      await createLog(client, weekly.id as string, { logDate: date });
    }

    const weeklyStreak = await (
      await client.request(`/api/v1/habits/${weekly.id}/streak?date=${today}`)
    ).json();
    assertEquals(weeklyStreak.data.streak.currentStreak, weeklyDates.length);
    assertEquals(weeklyStreak.data.streak.longestStreak, weeklyDates.length);

    const custom = await createHabit(client, {
      name: "Academia",
      habitType: "good",
      frequencyType: "custom",
      daysOfWeek: [1, 3],
    });
    const customStart = addDays(lastMonday, -7);
    backdateHabit(testApp, custom.id as string, customStart);

    const customDates = datesWithWeekdays(customStart, today, [1, 3]);
    for (const date of customDates) {
      await createLog(client, custom.id as string, { logDate: date });
    }

    const customStreak = await (
      await client.request(`/api/v1/habits/${custom.id}/streak?date=${today}`)
    ).json();
    assertEquals(customStreak.data.streak.currentStreak, customDates.length);
    assertEquals(customStreak.data.streak.longestStreak, customDates.length);

    const weekdays = await (
      await client.request(
        `/api/v1/habits/${custom.id}/calendar?from=${customStart}&to=${today}&date=${today}`,
      )
    ).json();
    assertEquals(
      weekdays.data.calendar.days.every((day: { scheduled: boolean; completed: boolean }) =>
        !day.scheduled || day.completed
      ),
      true,
    );
  } finally {
    testApp.cleanup();
  }
});

Deno.test("hábito ruim conta dias limpos e quebra ao registrar uma recaída", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const today = todayUtc();
    const start = addDays(today, -3);

    const habit = await createHabit(client, {
      name: "Sem açúcar",
      habitType: "bad",
      frequencyType: "daily",
    });
    backdateHabit(testApp, habit.id as string, start);

    const clean = await (
      await client.request(`/api/v1/habits/${habit.id}/streak?date=${today}`)
    ).json();
    assertEquals(clean.data.streak.currentStreak, 4);
    assertEquals(clean.data.streak.longestStreak, 4);
    assertEquals(clean.data.streak.completedToday, true);

    await createLog(client, habit.id as string, { logDate: addDays(today, -1), value: 1 });

    const afterSlip = await (
      await client.request(`/api/v1/habits/${habit.id}/streak?date=${today}`)
    ).json();
    assertEquals(afterSlip.data.streak.currentStreak, 1);
    assertEquals(afterSlip.data.streak.longestStreak, 2);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("gatilhos exigem hábito ruim e substituição boa, e vinculam logs", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);
    const today = todayUtc();

    const bad = await createHabit(client, {
      name: "Roer unhas",
      habitType: "bad",
      frequencyType: "daily",
    });
    const replacement = await createHabit(client, {
      name: "Respirar fundo",
      habitType: "good",
      frequencyType: "daily",
    });
    const otherGood = await createHabit(client, {
      name: "Alongar",
      habitType: "good",
      frequencyType: "daily",
    });

    const createResponse = await client.request("/api/v1/habit-triggers", {
      method: "POST",
      body: {
        badHabitId: bad.id,
        replacementHabitId: replacement.id,
        triggerDescription: "Ansiedade",
        alternativeAction: "Respirar por 1 minuto",
      },
    });
    const trigger = (await createResponse.json()).data.trigger;
    assertEquals(createResponse.status, 201, JSON.stringify(trigger));
    assertEquals(trigger.badHabitName, "Roer unhas");
    assertEquals(trigger.replacementHabitName, "Respirar fundo");

    for (
      const body of [
        { badHabitId: replacement.id, triggerDescription: "Tipo errado" },
        {
          badHabitId: bad.id,
          replacementHabitId: bad.id,
          triggerDescription: "Substituição igual",
        },
        {
          badHabitId: bad.id,
          replacementHabitId: bad.id,
          triggerDescription: "Ruim como substituição",
        },
      ]
    ) {
      const response = await client.request("/api/v1/habit-triggers", {
        method: "POST",
        body,
      });
      assertEquals(response.status, 400, JSON.stringify(body));
    }

    const updatedResponse = await client.request(`/api/v1/habit-triggers/${trigger.id}`, {
      method: "PATCH",
      body: { alternativeAction: "Beber água" },
    });
    assertEquals(updatedResponse.status, 200);
    assertEquals((await updatedResponse.json()).data.trigger.alternativeAction, "Beber água");

    const badLog = await createLog(client, bad.id as string, {
      logDate: today,
      value: 1,
      triggerId: trigger.id,
      replacementUsed: true,
    });
    assertEquals(badLog.triggerId, trigger.id);
    assertEquals(badLog.replacementUsed, true);

    const replacementLog = await createLog(client, replacement.id as string, {
      logDate: today,
      triggerId: trigger.id,
      replacementUsed: true,
    });
    assertEquals(replacementLog.triggerId, trigger.id);

    const wrongLog = await client.request(`/api/v1/habits/${otherGood.id}/logs`, {
      method: "POST",
      body: { logDate: today, triggerId: trigger.id },
    });
    assertEquals(wrongLog.status, 400);

    const orphanReplacement = await client.request(`/api/v1/habits/${replacement.id}/logs`, {
      method: "POST",
      body: { logDate: today, replacementUsed: true },
    });
    assertEquals(orphanReplacement.status, 400);

    const listResponse = await client.request("/api/v1/habit-triggers");
    assertEquals((await listResponse.json()).data.triggers.length, 1);

    const deleteResponse = await client.request(`/api/v1/habit-triggers/${trigger.id}`, {
      method: "DELETE",
    });
    assertEquals(deleteResponse.status, 204);
    assertEquals(
      (await (await client.request("/api/v1/habit-triggers")).json()).data.triggers.length,
      0,
    );

    const secondTrigger = await (
      await client.request("/api/v1/habit-triggers", {
        method: "POST",
        body: {
          badHabitId: bad.id,
          replacementHabitId: otherGood.id,
          triggerDescription: "Tédio",
        },
      })
    ).json();
    await client.request(`/api/v1/habits/${bad.id}`, { method: "DELETE" });

    const afterDelete = await (await client.request("/api/v1/habit-triggers")).json();
    assertEquals(afterDelete.data.triggers.length, 0, JSON.stringify(secondTrigger));
  } finally {
    testApp.cleanup();
  }
});

Deno.test("stacking valida ciclos e profundidade e desativa a árvore em cascata", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);

    const root = await createHabit(client, {
      name: "Nível 0",
      habitType: "good",
      frequencyType: "daily",
    });

    const chain = [root];
    for (let level = 1; level <= 5; level++) {
      const habit = await createHabit(client, {
        name: `Nível ${level}`,
        habitType: "good",
        frequencyType: "daily",
        parentHabitId: chain[level - 1]?.id,
      });
      chain.push(habit);
    }

    const tooDeep = await client.request("/api/v1/habits", {
      method: "POST",
      body: {
        name: "Nível 6",
        habitType: "good",
        frequencyType: "daily",
        parentHabitId: chain[5]?.id,
      },
    });
    assertEquals(tooDeep.status, 400);

    const cycle = await client.request(`/api/v1/habits/${root.id}`, {
      method: "PATCH",
      body: { parentHabitId: chain[5]?.id },
    });
    assertEquals(cycle.status, 400);

    const selfParent = await client.request(`/api/v1/habits/${root.id}`, {
      method: "PATCH",
      body: { parentHabitId: root.id },
    });
    assertEquals(selfParent.status, 400);

    const missingParent = await client.request("/api/v1/habits", {
      method: "POST",
      body: {
        name: "Órfão",
        habitType: "good",
        frequencyType: "daily",
        parentHabitId: "00000000-0000-7000-8000-000000000000",
      },
    });
    assertEquals(missingParent.status, 400);

    const deleteResponse = await client.request(`/api/v1/habits/${root.id}`, {
      method: "DELETE",
    });
    assertEquals(deleteResponse.status, 204);

    const descendants = await (
      await client.request("/api/v1/habits?includeInactive=true")
    ).json();
    assertEquals(descendants.data.habits.length, 6);
    assertEquals(
      descendants.data.habits.every((habit: { isActive: boolean }) => !habit.isActive),
      true,
    );

    const active = await (await client.request("/api/v1/habits")).json();
    assertEquals(active.data.habits.length, 0);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("reordenação reposiciona o hábito e reindexa os irmãos", async () => {
  const testApp = await createTestApp();

  try {
    const client = await register(testApp.app);

    const first = await createHabit(client, {
      name: "Primeiro",
      habitType: "good",
      frequencyType: "daily",
    });
    const second = await createHabit(client, {
      name: "Segundo",
      habitType: "good",
      frequencyType: "daily",
    });
    const third = await createHabit(client, {
      name: "Terceiro",
      habitType: "good",
      frequencyType: "daily",
    });

    const response = await client.request(`/api/v1/habits/${first.id}/reorder`, {
      method: "POST",
      body: { orderIndex: 2 },
    });
    const habits = (await response.json()).data.habits;

    assertEquals(response.status, 200);
    assertEquals(habits.map((habit: { id: string }) => habit.id), [
      second.id,
      third.id,
      first.id,
    ]);
    assertEquals(habits.map((habit: { orderIndex: number }) => habit.orderIndex), [0, 1, 2]);
  } finally {
    testApp.cleanup();
  }
});

Deno.test("hábitos e gatilhos são isolados por usuário", async () => {
  const testApp = await createTestApp();

  try {
    const owner = await register(testApp.app, "owner@example.com");
    const stranger = await register(testApp.app, "stranger@example.com");

    const habit = await createHabit(owner, {
      name: "Privado",
      habitType: "good",
      frequencyType: "daily",
    });
    const bad = await createHabit(owner, {
      name: "Ruim privado",
      habitType: "bad",
      frequencyType: "daily",
    });
    const trigger = await (
      await owner.request("/api/v1/habit-triggers", {
        method: "POST",
        body: { badHabitId: bad.id, triggerDescription: "Gatilho privado" },
      })
    ).json();

    for (
      const path of [
        `/api/v1/habits/${habit.id}`,
        `/api/v1/habits/${habit.id}/logs`,
        `/api/v1/habits/${habit.id}/streak`,
        `/api/v1/habits/${habit.id}/calendar`,
      ]
    ) {
      const response = await stranger.request(path);
      assertEquals(response.status, 404, path);
    }

    const patch = await stranger.request(`/api/v1/habits/${habit.id}`, {
      method: "PATCH",
      body: { name: "Invadido" },
    });
    assertEquals(patch.status, 404);

    const log = await stranger.request(`/api/v1/habits/${habit.id}/logs`, {
      method: "POST",
      body: { logDate: todayUtc() },
    });
    assertEquals(log.status, 404);

    const reorder = await stranger.request(`/api/v1/habits/${habit.id}/reorder`, {
      method: "POST",
      body: { orderIndex: 0 },
    });
    assertEquals(reorder.status, 404);

    const strangerTrigger = await stranger.request(`/api/v1/habit-triggers/${trigger.id}`, {
      method: "PATCH",
      body: { alternativeAction: "Invadido" },
    });
    assertEquals(strangerTrigger.status, 404);

    const strangerDelete = await stranger.request(`/api/v1/habit-triggers/${trigger.id}`, {
      method: "DELETE",
    });
    assertEquals(strangerDelete.status, 404);

    const strangerList = await (await stranger.request("/api/v1/habit-triggers")).json();
    assertEquals(strangerList.data.triggers.length, 0);

    const strangerCreate = await stranger.request("/api/v1/habit-triggers", {
      method: "POST",
      body: { badHabitId: bad.id, triggerDescription: "Gatilho alheio" },
    });
    assertEquals(strangerCreate.status, 404);
  } finally {
    testApp.cleanup();
  }
});
