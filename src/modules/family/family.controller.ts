import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import type { AppEnv } from "../../http/types.ts";
import {
  FamilyInviteRequestSchema,
  FamilyLinkParamsSchema,
  FamilyLinkResponseSchema,
  FamilyLinksResponseSchema,
  FamilyRevokeResponseSchema,
  FamilySummaryResponseSchema,
} from "./family.schemas.ts";
import type { FamilyService } from "./family.service.ts";

const json = <Schema extends z.ZodType>(schema: Schema) => ({
  "application/json": { schema },
});

const errorResponses = {
  400: { description: "Dados inválidos", content: json(ErrorResponseSchema) },
  401: { description: "Não autenticado", content: json(ErrorResponseSchema) },
  403: { description: "Origem/CSRF inválido", content: json(ErrorResponseSchema) },
  404: { description: "Usuário ou vínculo não encontrado", content: json(ErrorResponseSchema) },
  409: { description: "Vínculo já existente ou encerrado", content: json(ErrorResponseSchema) },
} as const;

const security = [{ cookieAuth: [] }];

const inviteRoute = createRoute({
  method: "post",
  path: "/api/v1/family/invite",
  tags: ["Family"],
  summary: "Convida um usuário para um vínculo familiar",
  description: "Um usuário só pode ter um vínculo pendente ou ativo por vez. Convidar " +
    "alguém que já recusou reabre o mesmo vínculo.",
  security,
  request: { body: { content: json(FamilyInviteRequestSchema) } },
  responses: {
    201: { description: "Convite criado", content: json(FamilyLinkResponseSchema) },
    ...errorResponses,
  },
});

const listRoute = createRoute({
  method: "get",
  path: "/api/v1/family",
  tags: ["Family"],
  summary: "Lista convites recebidos, enviados e vínculos ativos",
  security,
  responses: {
    200: { description: "Vínculos familiares", content: json(FamilyLinksResponseSchema) },
    ...errorResponses,
  },
});

const summaryRoute = createRoute({
  method: "get",
  path: "/api/v1/family/summary",
  tags: ["Family"],
  summary: "Resumo agregado do parceiro no mês corrente",
  description: "Expõe apenas totais por moeda e contagens do mês corrente; nenhuma " +
    "transação, conta ou categoria individual do parceiro é revelada.",
  security,
  responses: {
    200: { description: "Resumo do parceiro", content: json(FamilySummaryResponseSchema) },
    ...errorResponses,
  },
});

const acceptRoute = createRoute({
  method: "post",
  path: "/api/v1/family/{id}/accept",
  tags: ["Family"],
  summary: "Aceita um convite familiar",
  security,
  request: { params: FamilyLinkParamsSchema },
  responses: {
    200: { description: "Convite aceito", content: json(FamilyLinkResponseSchema) },
    ...errorResponses,
  },
});

const rejectRoute = createRoute({
  method: "post",
  path: "/api/v1/family/{id}/reject",
  tags: ["Family"],
  summary: "Recusa um convite familiar",
  security,
  request: { params: FamilyLinkParamsSchema },
  responses: {
    200: { description: "Convite recusado", content: json(FamilyLinkResponseSchema) },
    ...errorResponses,
  },
});

const revokeRoute = createRoute({
  method: "delete",
  path: "/api/v1/family/{id}",
  tags: ["Family"],
  summary: "Encerra um convite pendente ou um vínculo ativo",
  security,
  request: { params: FamilyLinkParamsSchema },
  responses: {
    200: { description: "Vínculo encerrado", content: json(FamilyRevokeResponseSchema) },
    ...errorResponses,
  },
});

export interface FamilyControllerDependencies {
  readonly service: FamilyService;
  readonly config: AppConfig;
}

export function registerFamilyRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: FamilyControllerDependencies,
): void {
  const { service } = dependencies;

  app.openapi(inviteRoute, (c) => {
    const link = service.invite(c.get("userId") ?? "", c.req.valid("json").email);
    return c.json(
      { data: { link }, meta: { requestId: c.get("requestId") } },
      201,
    );
  });

  app.openapi(listRoute, (c) => {
    const links = service.list(c.get("userId") ?? "");
    return c.json(
      { data: links, meta: { requestId: c.get("requestId") } },
      200,
    );
  });

  app.openapi(summaryRoute, (c) => {
    return c.json(
      { data: service.summary(c.get("userId") ?? ""), meta: { requestId: c.get("requestId") } },
      200,
    );
  });

  app.openapi(acceptRoute, (c) => {
    const link = service.accept(c.get("userId") ?? "", c.req.valid("param").id);
    return c.json(
      { data: { link }, meta: { requestId: c.get("requestId") } },
      200,
    );
  });

  app.openapi(rejectRoute, (c) => {
    const link = service.reject(c.get("userId") ?? "", c.req.valid("param").id);
    return c.json(
      { data: { link }, meta: { requestId: c.get("requestId") } },
      200,
    );
  });

  app.openapi(revokeRoute, (c) => {
    service.revoke(c.get("userId") ?? "", c.req.valid("param").id);
    return c.json(
      { data: { revoked: true as const }, meta: { requestId: c.get("requestId") } },
      200,
    );
  });
}
