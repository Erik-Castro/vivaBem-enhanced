import { z } from "zod";
import { uuidv7 } from "../../shared/utils/uuid.ts";
import type { AiToolRegistry } from "../ai.registry.ts";
import { type AiToolDependencies, asSeverity, asString, notify } from "./deps.ts";

const notifyAdminParameters = z.object({
  title: z.string().min(1).max(160).describe("Título curto e específico"),
  message: z.string().min(1).max(2_000).describe("Detalhes com números concretos"),
  severity: z.enum(["low", "medium", "high", "critical"]).default("low"),
});

const invalidateSessionParameters = z.object({
  sessionId: z.string().min(1).describe("ID da sessão suspeita"),
  reason: z.string().min(1).max(500).describe("Motivo da invalidação"),
});

const blockIpParameters = z.object({
  ipAddress: z.string().min(3).max(64).describe("Endereço IP a bloquear"),
  reason: z.string().min(1).max(500).describe("Motivo do bloqueio"),
  durationHours: z.number().int().min(1).max(168).default(24),
});

export function registerSecurityTools(
  registry: AiToolRegistry,
  dependencies: AiToolDependencies,
): void {
  registry.register({
    name: "notify_admin",
    description: "Notifica o usuário sobre um evento de segurança relevante.",
    category: "security",
    risk: "low",
    parameters: notifyAdminParameters,
    cooldownSeconds: 300,
    executor: (args, context) => {
      const result = notify(dependencies, context, {
        category: "security",
        severity: asSeverity(args.severity),
        title: asString(args.title, "Alerta de segurança"),
        message: asString(args.message, "Verifique a atividade da sua conta"),
        link: "/settings/sessions",
      });
      return result;
    },
  });

  registry.register({
    name: "invalidate_session",
    description: "Revoga uma sessão suspeita do próprio usuário.",
    category: "security",
    risk: "high",
    parameters: invalidateSessionParameters,
    cooldownSeconds: 60,
    executor: (args, context) => {
      const sessionId = asString(args.sessionId, "");
      if (sessionId === "") {
        return { success: false, message: "sessionId ausente" };
      }

      const revoked = dependencies.auth.revokeUserSession(
        context.userId,
        sessionId,
        context.now,
      );

      if (!revoked) {
        return { success: false, message: "Sessão não encontrada ou já revogada" };
      }

      dependencies.logger.info("ai_session_invalidated", {
        userId: context.userId,
        sessionId,
        reason: asString(args.reason, "não informado"),
      });

      return { success: true, message: "Sessão revogada", data: { sessionId } };
    },
  });

  registry.register({
    name: "block_ip",
    description: "Bloqueia temporariamente um IP com tentativas abusivas.",
    category: "security",
    risk: "high",
    parameters: blockIpParameters,
    cooldownSeconds: 60,
    executor: (args, context) => {
      const ipAddress = asString(args.ipAddress, "");
      if (ipAddress === "") {
        return { success: false, message: "ipAddress ausente" };
      }

      const durationHours = typeof args.durationHours === "number"
        ? Math.min(168, Math.max(1, Math.trunc(args.durationHours)))
        : 24;
      const expiresAt = new Date(
        new Date(context.now).getTime() + durationHours * 3_600_000,
      ).toISOString();

      dependencies.blocklist.block({
        id: uuidv7(),
        ipAddress,
        reason: asString(args.reason, "Bloqueio solicitado pela IA"),
        expiresAt,
        now: context.now,
      });

      dependencies.logger.warn("ai_ip_blocked", {
        userId: context.userId,
        ipAddress,
        expiresAt,
      });

      return {
        success: true,
        message: "IP bloqueado",
        data: { ipAddress, expiresAt },
      };
    },
  });
}
