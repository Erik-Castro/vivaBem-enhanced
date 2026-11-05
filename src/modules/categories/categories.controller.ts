import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import type { AppEnv } from "../../http/types.ts";
import type { Category } from "./categories.repository.ts";
import type { CategoriesService, CategoryNode } from "./categories.service.ts";
import {
  CategoriesResponseSchema,
  CategoryQuerySchema,
  CategoryResponseSchema,
  CategoryTreeResponseSchema,
  CreateCategoryRequestSchema,
  UpdateCategoryRequestSchema,
} from "./categories.schemas.ts";

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

const listCategoriesRoute = createRoute({
  method: "get",
  path: "/api/v1/categories",
  tags: ["Categories"],
  summary: "Lista as categorias do usuário",
  security,
  request: { query: CategoryQuerySchema },
  responses: {
    200: { description: "Categorias", content: json(CategoriesResponseSchema) },
    ...errorResponses,
  },
});

const categoryTreeRoute = createRoute({
  method: "get",
  path: "/api/v1/categories/tree",
  tags: ["Categories"],
  summary: "Retorna a árvore de categorias",
  security,
  request: { query: CategoryQuerySchema },
  responses: {
    200: { description: "Árvore de categorias", content: json(CategoryTreeResponseSchema) },
    ...errorResponses,
  },
});

const createCategoryRoute = createRoute({
  method: "post",
  path: "/api/v1/categories",
  tags: ["Categories"],
  summary: "Cria uma categoria",
  security,
  request: { body: { content: json(CreateCategoryRequestSchema) } },
  responses: {
    201: { description: "Categoria criada", content: json(CategoryResponseSchema) },
    ...errorResponses,
  },
});

const getCategoryRoute = createRoute({
  method: "get",
  path: "/api/v1/categories/{id}",
  tags: ["Categories"],
  summary: "Retorna uma categoria",
  security,
  request: { params: idParamsSchema },
  responses: {
    200: { description: "Categoria", content: json(CategoryResponseSchema) },
    ...errorResponses,
  },
});

const updateCategoryRoute = createRoute({
  method: "patch",
  path: "/api/v1/categories/{id}",
  tags: ["Categories"],
  summary: "Atualiza uma categoria",
  security,
  request: {
    params: idParamsSchema,
    body: { content: json(UpdateCategoryRequestSchema) },
  },
  responses: {
    200: { description: "Categoria atualizada", content: json(CategoryResponseSchema) },
    ...errorResponses,
  },
});

const deleteCategoryRoute = createRoute({
  method: "delete",
  path: "/api/v1/categories/{id}",
  tags: ["Categories"],
  summary: "Desativa uma categoria e sua subárvore",
  security,
  request: { params: idParamsSchema },
  responses: {
    204: { description: "Categoria desativada" },
    ...errorResponses,
  },
});

export interface CategoriesControllerDependencies {
  readonly service: CategoriesService;
  readonly config: AppConfig;
}

/** Remove `userId` antes de expor a categoria na API. */
export function toCategoryView(category: Category) {
  return {
    id: category.id,
    parentId: category.parentId,
    name: category.name,
    type: category.type,
    color: category.color,
    icon: category.icon,
    isActive: category.isActive,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

function toNodeView(node: CategoryNode): CategoryNode {
  return {
    ...toCategoryView(node),
    children: node.children.map(toNodeView),
  } as CategoryNode;
}

export function registerCategoriesRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: CategoriesControllerDependencies,
): void {
  const { service } = dependencies;

  app.openapi(listCategoriesRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const query = c.req.valid("query");
    const categories = service.list(userId, {
      type: query.type,
      includeInactive: query.includeInactive,
    });

    return c.json(
      {
        data: { categories: categories.map(toCategoryView) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(categoryTreeRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const query = c.req.valid("query");
    const tree = service.tree(userId, query.includeInactive);

    return c.json(
      {
        data: { categories: tree.map(toNodeView) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(createCategoryRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const category = service.create(userId, c.req.valid("json"));

    return c.json(
      {
        data: { category: toCategoryView(category) },
        meta: { requestId: c.get("requestId") },
      },
      201,
    );
  });

  app.openapi(getCategoryRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const category = service.get(userId, c.req.valid("param").id);

    return c.json(
      {
        data: { category: toCategoryView(category) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(updateCategoryRoute, (c) => {
    const userId = c.get("userId") ?? "";
    const category = service.update(userId, c.req.valid("param").id, c.req.valid("json"));

    return c.json(
      {
        data: { category: toCategoryView(category) },
        meta: { requestId: c.get("requestId") },
      },
      200,
    );
  });

  app.openapi(deleteCategoryRoute, (c) => {
    service.delete(c.get("userId") ?? "", c.req.valid("param").id);
    return c.body(null, 204);
  });
}
