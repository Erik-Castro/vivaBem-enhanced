import { z } from "@hono/zod-openapi";
import { MetaSchema } from "../../http/openapi.ts";

export const UserPreferencesSchema = z
  .object({
    timezone: z.string().min(1).max(64),
    baseCurrency: z.string().regex(/^[A-Z]{3}$/),
    locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
    aiEnabled: z.boolean(),
  })
  .openapi("UserPreferences");

export const UserSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    avatarUrl: z.url().nullable(),
    subscriptionTier: z.enum(["free", "premium"]),
    emailVerified: z.boolean(),
    createdAt: z.string(),
    preferences: UserPreferencesSchema,
  })
  .openapi("User");

export const RegisterRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.email().max(320),
    password: z.string().min(8).max(200),
  })
  .openapi("RegisterRequest");

export const LoginRequestSchema = z
  .object({
    email: z.email().max(320),
    password: z.string().min(1).max(200),
  })
  .openapi("LoginRequest");

export const AuthResponseSchema = z
  .object({
    data: z.object({
      user: UserSchema,
      csrfToken: z.string(),
    }),
    meta: MetaSchema,
  })
  .openapi("AuthResponse");

export const CsrfResponseSchema = z
  .object({
    data: z.object({
      csrfToken: z.string(),
    }),
    meta: MetaSchema,
  })
  .openapi("CsrfResponse");

export const MeResponseSchema = z
  .object({
    data: z.object({
      user: UserSchema,
      stats: z.object({
        activeSessions: z.number().int().nonnegative(),
      }),
    }),
    meta: MetaSchema,
  })
  .openapi("MeResponse");

export const UpdateMeRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    avatarUrl: z.url().max(2_048).nullable().optional(),
  })
  .refine((value) => value.name !== undefined || value.avatarUrl !== undefined, {
    message: "Informe ao menos um campo",
  })
  .openapi("UpdateMeRequest");

export const UpdatePreferencesRequestSchema = z
  .object({
    timezone: z
      .string()
      .min(1)
      .max(64)
      .refine(isValidTimezone, "Fuso horário inválido")
      .optional(),
    baseCurrency: z.string().regex(/^[A-Z]{3}$/, "Use um código ISO 4217, ex.: BRL").optional(),
    locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/, "Use o formato pt-BR").optional(),
    aiEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Informe ao menos um campo",
  })
  .openapi("UpdatePreferencesRequest");

export const SessionSchema = z
  .object({
    id: z.string(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
    expiresAt: z.string(),
    current: z.boolean(),
  })
  .openapi("Session");

export const SessionsResponseSchema = z
  .object({
    data: z.object({
      sessions: z.array(SessionSchema),
    }),
    meta: MetaSchema,
  })
  .openapi("SessionsResponse");

export const EmptyResponseSchema = z
  .object({
    data: z.object({ success: z.literal(true) }),
    meta: MetaSchema,
  })
  .openapi("EmptyResponse");

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
