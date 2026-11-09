import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppConfig } from "../../config.ts";
import { AppError } from "../../http/errors.ts";
import { ErrorResponseSchema } from "../../http/openapi.ts";
import type { AppEnv } from "../../http/types.ts";
import type { ImportService } from "./import.service.ts";
import {
  ImportCommitResponseSchema,
  ImportPreviewResponseSchema,
  ImportUploadSchema,
} from "./import.schemas.ts";
import type { ImportUpload } from "./import.types.ts";

const json = <Schema extends z.ZodType>(schema: Schema) => ({
  "application/json": { schema },
});

const errorResponses = {
  400: { description: "Dados inválidos", content: json(ErrorResponseSchema) },
  401: { description: "Não autenticado", content: json(ErrorResponseSchema) },
  403: { description: "Origem/CSRF inválido", content: json(ErrorResponseSchema) },
  404: { description: "Conta não encontrada", content: json(ErrorResponseSchema) },
  409: { description: "Conta inativa", content: json(ErrorResponseSchema) },
  413: { description: "Arquivo acima de 1 MB", content: json(ErrorResponseSchema) },
} as const;

const security = [{ cookieAuth: [] }];

const previewRoute = createRoute({
  method: "post",
  path: "/api/v1/import/preview",
  tags: ["Data"],
  summary: "Analisa um arquivo CSV/OFX sem gravar transações",
  description: "Recebe `multipart/form-data` com `accountId` e `file`. Detecta o formato pelo " +
    "conteúdo e marca as linhas que já existem na conta pelo `import_hash`.",
  security,
  request: {
    body: {
      required: true,
      content: { "multipart/form-data": { schema: ImportUploadSchema } },
    },
  },
  responses: {
    200: { description: "Prévia da importação", content: json(ImportPreviewResponseSchema) },
    ...errorResponses,
  },
});

const commitRoute = createRoute({
  method: "post",
  path: "/api/v1/import/commit",
  tags: ["Data"],
  summary: "Importa as transações de um arquivo CSV/OFX",
  description: "Idempotente: linhas cujo `import_hash` já existe na conta são ignoradas. " +
    "A importação inteira roda em uma única transação.",
  security,
  request: {
    body: {
      required: true,
      content: { "multipart/form-data": { schema: ImportUploadSchema } },
    },
  },
  responses: {
    200: { description: "Resultado da importação", content: json(ImportCommitResponseSchema) },
    ...errorResponses,
  },
});

export interface ImportControllerDependencies {
  readonly service: ImportService;
  readonly config: AppConfig;
}

/**
 * Converte o formulário em `ImportUpload`.
 *
 * O schema do OpenAPI usa `z.unknown()` no arquivo porque `File` não tem
 * representação Zod; a checagem real é feita aqui.
 */
async function toUpload(form: { accountId: string; file: unknown }): Promise<ImportUpload> {
  const file = form.file;
  if (!(file instanceof File)) {
    throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
      details: [{ path: "file", message: "Envie o arquivo no campo 'file'" }],
    });
  }

  return {
    accountId: form.accountId,
    fileName: file.name === "" ? null : file.name,
    content: await file.text(),
  };
}

export function registerImportRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: ImportControllerDependencies,
): void {
  const { service } = dependencies;

  app.openapi(previewRoute, async (c) => {
    const upload = await toUpload(c.req.valid("form"));
    const preview = await service.preview(c.get("userId") ?? "", upload);

    return c.json(
      { data: preview, meta: { requestId: c.get("requestId") } },
      200,
    );
  });

  app.openapi(commitRoute, async (c) => {
    const upload = await toUpload(c.req.valid("form"));
    const result = await service.commit(c.get("userId") ?? "", upload);

    return c.json(
      { data: result, meta: { requestId: c.get("requestId") } },
      200,
    );
  });
}
