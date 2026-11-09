import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppConfig } from "../config.ts";
import { API_VERSION, APP_VERSION } from "../version.ts";
import type { AppEnv } from "./types.ts";

export const MetaSchema = z
  .object({
    requestId: z.string(),
  })
  .openapi("Meta");

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.array(z.unknown()).optional(),
      requestId: z.string(),
    }),
  })
  .openapi("ErrorResponse");

export const HealthResponseSchema = z
  .object({
    data: z.object({
      status: z.literal("ok"),
      version: z.string(),
      uptimeSeconds: z.number().int().nonnegative(),
    }),
    meta: MetaSchema,
  })
  .openapi("HealthResponse");

export const ReadyResponseSchema = z
  .object({
    data: z.object({
      status: z.enum(["ready", "not_ready"]),
      checks: z.object({
        database: z.enum(["ok", "error"]),
        migrations: z.number().int().nonnegative(),
      }),
    }),
    meta: MetaSchema,
  })
  .openapi("ReadyResponse");

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Liveness probe",
  description: "Retorna 200 enquanto o processo estiver vivo.",
  responses: {
    200: {
      description: "Processo saudável",
      content: { "application/json": { schema: HealthResponseSchema } },
    },
  },
});

export const readyRoute = createRoute({
  method: "get",
  path: "/ready",
  tags: ["System"],
  summary: "Readiness probe",
  description: "Verifica a conexão com o banco e as migrações aplicadas.",
  responses: {
    200: {
      description: "Pronto para receber tráfego",
      content: { "application/json": { schema: ReadyResponseSchema } },
    },
    503: {
      description: "Ainda não está pronto",
      content: { "application/json": { schema: ReadyResponseSchema } },
    },
  },
});

export function registerOpenApiDocument(app: OpenAPIHono<AppEnv>, config: AppConfig): void {
  app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "vb_access",
    description: "Access token JWT em cookie HttpOnly.",
  });

  app.doc31(`/api/${API_VERSION}/openapi.json`, {
    openapi: "3.1.0",
    info: {
      title: "Viva Bem API",
      version: APP_VERSION,
      description: "API de finanças pessoais e hábitos do Viva Bem. " +
        "Todas as respostas de sucesso usam `{ data, meta }`; erros usam `{ error }`.",
    },
    servers: [{ url: config.appOrigin, description: config.env }],
    tags: [
      { name: "System", description: "Saúde e prontidão do serviço" },
      { name: "Auth", description: "Registro, login, refresh e logout" },
      { name: "Users", description: "Perfil, preferências e sessões" },
      { name: "Accounts", description: "Contas, cartões e saldos" },
      { name: "Categories", description: "Categorias e árvore de categorias" },
      { name: "Transactions", description: "Transações, transferências e resumos" },
      { name: "Recurring", description: "Recorrências e próximas ocorrências" },
      { name: "Budgets", description: "Orçamentos, limites e alertas" },
      { name: "Goals", description: "Metas e contribuições" },
      { name: "Habits", description: "Hábitos, logs, streaks, calendário e gatilhos" },
      {
        name: "Investments",
        description: "Ativos, operações, cotações, posições e performance",
      },
      {
        name: "Achievements",
        description: "Catálogo de conquistas, desbloqueios e progresso",
      },
      {
        name: "Notifications",
        description: "Notificações do usuário, leitura e contagem",
      },
      {
        name: "Data",
        description: "Importação CSV/OFX e exportação dos dados do usuário",
      },
      {
        name: "Family",
        description: "Convites, vínculo familiar e resumo agregado do parceiro",
      },
    ],
  });
}
