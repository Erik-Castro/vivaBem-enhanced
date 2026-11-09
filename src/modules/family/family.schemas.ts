import { z } from "@hono/zod-openapi";
import { MetaSchema } from "../../http/openapi.ts";
import { FAMILY_LINK_STATUSES } from "./family.repository.ts";

export const FamilyLinkStatusSchema = z.enum(FAMILY_LINK_STATUSES);

export const FamilyPartnerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
  })
  .openapi("FamilyPartner");

export const FamilyLinkSchema = z
  .object({
    id: z.string(),
    status: FamilyLinkStatusSchema,
    role: z.enum(["requester", "addressee"]),
    partner: FamilyPartnerSchema,
    createdAt: z.string(),
    respondedAt: z.string().nullable(),
  })
  .openapi("FamilyLink");

export const FamilyInviteRequestSchema = z
  .object({
    email: z.email().max(320).openapi({ description: "E-mail do usuário convidado" }),
  })
  .openapi("FamilyInviteRequest");

export const FamilyLinksResponseSchema = z
  .object({
    data: z.object({
      incoming: z.array(FamilyLinkSchema),
      outgoing: z.array(FamilyLinkSchema),
      active: z.array(FamilyLinkSchema),
    }),
    meta: MetaSchema,
  })
  .openapi("FamilyLinksResponse");

export const FamilyLinkResponseSchema = z
  .object({
    data: z.object({ link: FamilyLinkSchema }),
    meta: MetaSchema,
  })
  .openapi("FamilyLinkResponse");

export const FamilyLinkParamsSchema = z.object({ id: z.string().min(1) });

export const FamilyCurrencyTotalSchema = z
  .object({
    currencyCode: z.string(),
    incomeMinor: z.number().int(),
    expenseMinor: z.number().int(),
    transferNetMinor: z.number().int(),
    netMinor: z.number().int(),
    transactionCount: z.number().int().nonnegative(),
  })
  .openapi("FamilyCurrencyTotal");

export const FamilyCountsSchema = z
  .object({
    activeAccounts: z.number().int().nonnegative(),
    activeHabits: z.number().int().nonnegative(),
    habitLogs: z.number().int().nonnegative(),
    activeGoals: z.number().int().nonnegative(),
    unlockedAchievements: z.number().int().nonnegative(),
  })
  .openapi("FamilyCounts");

export const FamilySummaryResponseSchema = z
  .object({
    data: z.object({
      partner: FamilyPartnerSchema,
      period: z.object({ from: z.string(), to: z.string() }),
      totals: z.array(FamilyCurrencyTotalSchema),
      counts: FamilyCountsSchema,
    }),
    meta: MetaSchema,
  })
  .openapi("FamilySummaryResponse");

export const FamilyRevokeResponseSchema = z
  .object({
    data: z.object({ revoked: z.literal(true) }),
    meta: MetaSchema,
  })
  .openapi("FamilyRevokeResponse");
