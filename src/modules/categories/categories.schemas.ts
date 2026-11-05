import { z } from "@hono/zod-openapi";
import { MetaSchema } from "../../http/openapi.ts";
import { CATEGORY_TYPES } from "./categories.repository.ts";

export const CategoryTypeSchema = z.enum(CATEGORY_TYPES);

export const CategoryColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use uma cor hexadecimal no formato #RRGGBB");

export const CategorySchema = z
  .object({
    id: z.string(),
    parentId: z.string().nullable(),
    name: z.string(),
    type: CategoryTypeSchema,
    color: z.string().nullable(),
    icon: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Category");

export interface CategoryNodeView {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly type: "income" | "expense" | "transfer";
  readonly color: string | null;
  readonly icon: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly children: CategoryNodeView[];
}

export const CategoryNodeSchema: z.ZodType<CategoryNodeView> = z
  .object({
    id: z.string(),
    parentId: z.string().nullable(),
    name: z.string(),
    type: CategoryTypeSchema,
    color: z.string().nullable(),
    icon: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    get children() {
      return z.array(CategoryNodeSchema);
    },
  })
  .openapi("CategoryNode");

export const CreateCategoryRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    type: CategoryTypeSchema,
    parentId: z.string().min(1).nullable().optional(),
    color: CategoryColorSchema.nullable().optional(),
    icon: z.string().trim().max(64).nullable().optional(),
  })
  .openapi("CreateCategoryRequest");

export const UpdateCategoryRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    parentId: z.string().min(1).nullable().optional(),
    color: CategoryColorSchema.nullable().optional(),
    icon: z.string().trim().max(64).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Informe ao menos um campo",
  })
  .openapi("UpdateCategoryRequest");

export const CategoryQuerySchema = z
  .object({
    type: CategoryTypeSchema.optional(),
    includeInactive: z.preprocess((value) => {
      if (value === "true" || value === true) return true;
      if (value === "false" || value === false) return false;
      return value;
    }, z.boolean().default(false)),
  })
  .openapi("CategoryQuery");

export const CategoryResponseSchema = z
  .object({
    data: z.object({ category: CategorySchema }),
    meta: MetaSchema,
  })
  .openapi("CategoryResponse");

export const CategoriesResponseSchema = z
  .object({
    data: z.object({ categories: z.array(CategorySchema) }),
    meta: MetaSchema,
  })
  .openapi("CategoriesResponse");

export const CategoryTreeResponseSchema = z
  .object({
    data: z.object({ categories: z.array(CategoryNodeSchema) }),
    meta: MetaSchema,
  })
  .openapi("CategoryTreeResponse");
