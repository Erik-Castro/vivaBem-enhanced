import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import type { AppEnv } from "../../http/types.ts";
import { ExportJsonResponseSchema, ExportQuerySchema } from "./export.schemas.ts";
import type { ExportService } from "./export.service.ts";

const json = <Schema extends z.ZodType>(schema: Schema) => ({
  "application/json": { schema },
});

const errorResponses = {
  400: { description: "Formato inválido", content: json(ErrorResponseSchema) },
  401: { description: "Não autenticado", content: json(ErrorResponseSchema) },
  403: { description: "Origem/CSRF inválido", content: json(ErrorResponseSchema) },
} as const;

const security = [{ cookieAuth: [] }];

const exportRoute = createRoute({
  method: "get",
  path: "/api/v1/export",
  tags: ["Data"],
  summary: "Exporta os dados do usuário em JSON ou as transações em CSV",
  description: "`format=json` devolve perfil, preferências, finanças, planejamento, hábitos, " +
    "investimentos, conquistas, notificações, insights e vínculos familiares. " +
    "`format=csv` devolve as transações ativas com nomes de conta e categoria. " +
    "Segredos como hashes de senha, tokens de sessão e embeddings não são exportados.",
  security,
  request: { query: ExportQuerySchema },
  responses: {
    200: {
      description: "Arquivo de exportação",
      content: {
        "application/json": { schema: ExportJsonResponseSchema },
        "text/csv": { schema: z.string() },
      },
    },
    ...errorResponses,
  },
});

export interface ExportControllerDependencies {
  readonly service: ExportService;
  readonly config: AppConfig;
}

export function registerExportRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: ExportControllerDependencies,
): void {
  const { service } = dependencies;

  app.openapi(exportRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const format = c.req.valid("query").format;

    if (format === "csv") {
      return c.body(service.exportTransactionsCsv(userId), 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${service.fileName("csv")}"`,
      });
    }

    return c.json(
      {
        data: service.exportJson(userId),
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });
}
