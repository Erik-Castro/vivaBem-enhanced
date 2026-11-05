import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import type { AppEnv } from "../../http/types.ts";
import type { Habit, HabitLog, HabitTrigger } from "./habits.repository.ts";
import type { HabitCalendar, HabitsService } from "./habits.service.ts";
import type { HabitStreak } from "./habits.streak.ts";
import {
  CreateHabitRequestSchema,
  CreateHabitTriggerRequestSchema,
  HabitCalendarQuerySchema,
  HabitCalendarResponseSchema,
  HabitLogQuerySchema,
  HabitLogResponseSchema,
  HabitLogsResponseSchema,
  HabitQuerySchema,
  HabitResponseSchema,
  HabitsResponseSchema,
  HabitStreakQuerySchema,
  HabitStreakResponseSchema,
  HabitTriggerResponseSchema,
  HabitTriggersResponseSchema,
  ReorderHabitRequestSchema,
  UpdateHabitRequestSchema,
  UpdateHabitTriggerRequestSchema,
  UpsertHabitLogRequestSchema,
} from "./habits.schemas.ts";

const json = <Schema extends z.ZodType>(schema: Schema) => ({
  "application/json": { schema },
});

const errorResponses = {
  400: { description: "Dados inválidos", content: json(ErrorResponseSchema) },
  401: { description: "Não autenticado", content: json(ErrorResponseSchema) },
  403: { description: "Origem/CSRF inválido", content: json(ErrorResponseSchema) },
  404: { description: "Não encontrado", content: json(ErrorResponseSchema) },
  409: { description: "Conflito", content: json(ErrorResponseSchema) },
} as const;

const security = [{ cookieAuth: [] }];

const idParamsSchema = z.object({ id: z.string().min(1) });
const logParamsSchema = z.object({
  id: z.string().min(1),
  logId: z.string().min(1),
});

const listHabitsRoute = createRoute({
  method: "get",
  path: "/api/v1/habits",
  tags: ["Habits"],
  summary: "Lista os hábitos do usuário",
  security,
  request: { query: HabitQuerySchema },
  responses: {
    200: { description: "Hábitos", content: json(HabitsResponseSchema) },
    ...errorResponses,
  },
});

const createHabitRoute = createRoute({
  method: "post",
  path: "/api/v1/habits",
  tags: ["Habits"],
  summary: "Cria um hábito",
  security,
  request: { body: { content: json(CreateHabitRequestSchema) } },
  responses: {
    201: { description: "Hábito criado", content: json(HabitResponseSchema) },
    ...errorResponses,
  },
});

const getHabitRoute = createRoute({
  method: "get",
  path: "/api/v1/habits/{id}",
  tags: ["Habits"],
  summary: "Retorna um hábito",
  security,
  request: { params: idParamsSchema },
  responses: {
    200: { description: "Hábito", content: json(HabitResponseSchema) },
    ...errorResponses,
  },
});

const updateHabitRoute = createRoute({
  method: "patch",
  path: "/api/v1/habits/{id}",
  tags: ["Habits"],
  summary: "Atualiza um hábito",
  security,
  request: {
    params: idParamsSchema,
    body: { content: json(UpdateHabitRequestSchema) },
  },
  responses: {
    200: { description: "Hábito atualizado", content: json(HabitResponseSchema) },
    ...errorResponses,
  },
});

const deleteHabitRoute = createRoute({
  method: "delete",
  path: "/api/v1/habits/{id}",
  tags: ["Habits"],
  summary: "Desativa o hábito e seus descendentes",
  security,
  request: { params: idParamsSchema },
  responses: {
    204: { description: "Hábito desativado" },
    ...errorResponses,
  },
});

const reorderHabitRoute = createRoute({
  method: "post",
  path: "/api/v1/habits/{id}/reorder",
  tags: ["Habits"],
  summary: "Move o hábito na ordem de exibição",
  security,
  request: {
    params: idParamsSchema,
    body: { content: json(ReorderHabitRequestSchema) },
  },
  responses: {
    200: { description: "Hábitos reordenados", content: json(HabitsResponseSchema) },
    ...errorResponses,
  },
});

const upsertHabitLogRoute = createRoute({
  method: "post",
  path: "/api/v1/habits/{id}/logs",
  tags: ["Habits"],
  summary: "Registra ou atualiza o log do dia",
  security,
  request: {
    params: idParamsSchema,
    body: { content: json(UpsertHabitLogRequestSchema) },
  },
  responses: {
    200: { description: "Log do dia atualizado", content: json(HabitLogResponseSchema) },
    201: { description: "Log do dia criado", content: json(HabitLogResponseSchema) },
    ...errorResponses,
  },
});

const listHabitLogsRoute = createRoute({
  method: "get",
  path: "/api/v1/habits/{id}/logs",
  tags: ["Habits"],
  summary: "Lista os logs do hábito",
  security,
  request: { params: idParamsSchema, query: HabitLogQuerySchema },
  responses: {
    200: { description: "Logs", content: json(HabitLogsResponseSchema) },
    ...errorResponses,
  },
});

const deleteHabitLogRoute = createRoute({
  method: "delete",
  path: "/api/v1/habits/{id}/logs/{logId}",
  tags: ["Habits"],
  summary: "Remove um log do hábito",
  security,
  request: { params: logParamsSchema },
  responses: {
    204: { description: "Log removido" },
    ...errorResponses,
  },
});

const habitStreakRoute = createRoute({
  method: "get",
  path: "/api/v1/habits/{id}/streak",
  tags: ["Habits"],
  summary: "Streak corrente e recorde do hábito",
  security,
  request: { params: idParamsSchema, query: HabitStreakQuerySchema },
  responses: {
    200: { description: "Streak", content: json(HabitStreakResponseSchema) },
    ...errorResponses,
  },
});

const habitCalendarRoute = createRoute({
  method: "get",
  path: "/api/v1/habits/{id}/calendar",
  tags: ["Habits"],
  summary: "Calendário do hábito",
  security,
  request: { params: idParamsSchema, query: HabitCalendarQuerySchema },
  responses: {
    200: { description: "Calendário", content: json(HabitCalendarResponseSchema) },
    ...errorResponses,
  },
});

const listTriggersRoute = createRoute({
  method: "get",
  path: "/api/v1/habit-triggers",
  tags: ["Habits"],
  summary: "Lista os gatilhos do usuário",
  security,
  responses: {
    200: { description: "Gatilhos", content: json(HabitTriggersResponseSchema) },
    ...errorResponses,
  },
});

const createTriggerRoute = createRoute({
  method: "post",
  path: "/api/v1/habit-triggers",
  tags: ["Habits"],
  summary: "Cria um gatilho de substituição",
  security,
  request: { body: { content: json(CreateHabitTriggerRequestSchema) } },
  responses: {
    201: { description: "Gatilho criado", content: json(HabitTriggerResponseSchema) },
    ...errorResponses,
  },
});

const updateTriggerRoute = createRoute({
  method: "patch",
  path: "/api/v1/habit-triggers/{id}",
  tags: ["Habits"],
  summary: "Atualiza um gatilho",
  security,
  request: {
    params: idParamsSchema,
    body: { content: json(UpdateHabitTriggerRequestSchema) },
  },
  responses: {
    200: { description: "Gatilho atualizado", content: json(HabitTriggerResponseSchema) },
    ...errorResponses,
  },
});

const deleteTriggerRoute = createRoute({
  method: "delete",
  path: "/api/v1/habit-triggers/{id}",
  tags: ["Habits"],
  summary: "Remove um gatilho",
  security,
  request: { params: idParamsSchema },
  responses: {
    204: { description: "Gatilho removido" },
    ...errorResponses,
  },
});

export interface HabitsControllerDependencies {
  readonly service: HabitsService;
  readonly config: AppConfig;
}

/** Remove `userId` antes de expor o hábito na API. */
export function toHabitView(habit: Habit) {
  return {
    id: habit.id,
    name: habit.name,
    description: habit.description,
    color: habit.color,
    habitType: habit.habitType,
    frequencyType: habit.frequencyType,
    daysOfWeek: habit.daysOfWeek,
    dailyTarget: habit.dailyTarget,
    targetUnit: habit.targetUnit,
    orderIndex: habit.orderIndex,
    parentHabitId: habit.parentHabitId,
    isActive: habit.isActive,
    createdAt: habit.createdAt,
    updatedAt: habit.updatedAt,
  };
}

export function toHabitLogView(log: HabitLog) {
  return {
    id: log.id,
    habitId: log.habitId,
    logDate: log.logDate,
    value: log.value,
    note: log.note,
    triggerId: log.triggerId,
    replacementUsed: log.replacementUsed,
    createdAt: log.createdAt,
    updatedAt: log.updatedAt,
  };
}

export function toHabitTriggerView(trigger: HabitTrigger) {
  return {
    id: trigger.id,
    badHabitId: trigger.badHabitId,
    badHabitName: trigger.badHabitName,
    replacementHabitId: trigger.replacementHabitId,
    replacementHabitName: trigger.replacementHabitName,
    triggerDescription: trigger.triggerDescription,
    alternativeAction: trigger.alternativeAction,
    createdAt: trigger.createdAt,
    updatedAt: trigger.updatedAt,
  };
}

export function toHabitStreakView(streak: HabitStreak, habitId: string) {
  return {
    habitId,
    currentStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    lastCompletedDate: streak.lastCompletedDate,
    scheduledToday: streak.scheduledToday,
    completedToday: streak.completedToday,
  };
}

export function toHabitCalendarView(calendar: HabitCalendar) {
  return {
    habitId: calendar.habitId,
    from: calendar.from,
    to: calendar.to,
    days: calendar.days,
  };
}

export function registerHabitsRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: HabitsControllerDependencies,
): void {
  const { service } = dependencies;

  app.openapi(listHabitsRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const query = c.req.valid("query");
    const habits = service.list(userId, {
      includeInactive: query.includeInactive,
      parentHabitId: query.parentId,
      habitType: query.habitType,
    });

    return c.json(
      {
        data: { habits: habits.map(toHabitView) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(createHabitRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const habit = service.create(userId, c.req.valid("json"));

    return c.json(
      {
        data: { habit: toHabitView(habit) },
        meta: { requestId: c.get("requestId") },
      },
      201,
    );
  });

  app.openapi(getHabitRoute, (c) => {
    const habit = service.get(c.get("userId") ?? "", c.req.valid("param").id);

    return c.json(
      {
        data: { habit: toHabitView(habit) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(updateHabitRoute, (c) => {
    const habit = service.update(
      c.get("userId") ?? "",
      c.req.valid("param").id,
      c.req.valid("json"),
    );

    return c.json(
      {
        data: { habit: toHabitView(habit) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(deleteHabitRoute, (c) => {
    service.delete(c.get("userId") ?? "", c.req.valid("param").id);
    return c.body(null, 204);
  });

  app.openapi(reorderHabitRoute, (c) => {
    const habits = service.reorder(
      c.get("userId") ?? "",
      c.req.valid("param").id,
      c.req.valid("json").orderIndex,
    );

    return c.json(
      {
        data: { habits: habits.map(toHabitView) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(upsertHabitLogRoute, (c) => {
    const result = service.upsertLog(
      c.get("userId") ?? "",
      c.req.valid("param").id,
      c.req.valid("json"),
    );

    return c.json(
      {
        data: { log: toHabitLogView(result.log) },
        meta: { requestId: c.get("requestId") },
      },
      result.created ? 201 : 200,
    );
  });

  app.openapi(listHabitLogsRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    const page = service.listLogs(userId, params.id, {
      from: query.from,
      to: query.to,
      limit: query.limit,
      offset: query.offset,
    });

    return c.json(
      {
        data: { logs: page.logs.map(toHabitLogView) },
        meta: {
          requestId: c.get("requestId"),
          limit: query.limit,
          offset: query.offset,
          hasMore: page.hasMore,
        },
      },
      200,
    );
  });

  app.openapi(deleteHabitLogRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const params = c.req.valid("param");
    service.deleteLog(userId, params.id, params.logId);
    return c.body(null, 204);
  });

  app.openapi(habitStreakRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    const streak = service.streak(userId, params.id, query.date);

    return c.json(
      {
        data: { streak: toHabitStreakView(streak, params.id) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(habitCalendarRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    const calendar = service.calendar(
      userId,
      params.id,
      { from: query.from, to: query.to },
      query.date,
    );

    return c.json(
      {
        data: { calendar: toHabitCalendarView(calendar) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(listTriggersRoute, (c) => {
    const triggers = service.listTriggers(c.get("userId") ?? "");

    return c.json(
      {
        data: { triggers: triggers.map(toHabitTriggerView) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(createTriggerRoute, (c) => {
    const trigger = service.createTrigger(
      c.get("userId") ?? "",
      c.req.valid("json"),
    );

    return c.json(
      {
        data: { trigger: toHabitTriggerView(trigger) },
        meta: { requestId: c.get("requestId") },
      },
      201,
    );
  });

  app.openapi(updateTriggerRoute, (c) => {
    const trigger = service.updateTrigger(
      c.get("userId") ?? "",
      c.req.valid("param").id,
      c.req.valid("json"),
    );

    return c.json(
      {
        data: { trigger: toHabitTriggerView(trigger) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(deleteTriggerRoute, (c) => {
    service.deleteTrigger(c.get("userId") ?? "", c.req.valid("param").id);
    return c.body(null, 204);
  });
}
