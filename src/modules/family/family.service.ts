import { AppError } from "../../http/errors.ts";
import { monthBounds, todayUtc } from "../../shared/utils/date.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";
import type { NotificationsRepository } from "../notifications/notifications.repository.ts";
import type {
  FamilyCounts,
  FamilyCurrencyTotal,
  FamilyLink,
  FamilyLinkWithPartner,
  FamilyRepository,
} from "./family.repository.ts";

export interface FamilyPartnerView {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface FamilyLinkView {
  readonly id: string;
  readonly status: FamilyLink["status"];
  readonly role: "requester" | "addressee";
  readonly partner: FamilyPartnerView;
  readonly createdAt: string;
  readonly respondedAt: string | null;
}

export interface FamilyLinksView {
  readonly incoming: FamilyLinkView[];
  readonly outgoing: FamilyLinkView[];
  readonly active: FamilyLinkView[];
}

export interface FamilySummary {
  readonly partner: FamilyPartnerView;
  readonly period: { readonly from: string; readonly to: string };
  readonly totals: FamilyCurrencyTotal[];
  readonly counts: FamilyCounts;
}

export class FamilyService {
  constructor(
    private readonly repository: FamilyRepository,
    private readonly notifications: NotificationsRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  invite(userId: string, email: string): FamilyLinkView {
    const normalized = email.trim().toLowerCase();
    const target = this.repository.findUserByEmail(normalized);

    if (target === undefined) {
      // Aceitável revelar a inexistência aqui: convidar exige conhecer o e-mail.
      throw new AppError("NOT_FOUND", "Nenhum usuário com este e-mail");
    }
    if (target.id === userId) {
      throw new AppError("VALIDATION_ERROR", "Não é possível convidar você mesmo", {
        details: [{ path: "email", message: "Use o e-mail de outra pessoa" }],
      });
    }
    if (
      this.repository.hasPendingOrActive(userId) ||
      this.repository.hasPendingOrActive(target.id)
    ) {
      throw new AppError("CONFLICT", "Já existe um vínculo familiar pendente ou ativo");
    }

    const nowIso = this.now().toISOString();
    const existing = this.repository.findByPair(userId, target.id);
    const link = existing === undefined
      ? this.repository.create({
        id: uuidv7(),
        requesterId: userId,
        addresseeId: target.id,
        now: nowIso,
      })
      : (this.repository.reopen(existing.id, userId, target.id, nowIso), {
        ...existing,
        requesterId: userId,
        addresseeId: target.id,
        status: "pending" as const,
        createdAt: nowIso,
        respondedAt: null,
      });

    this.#notify(
      target.id,
      "Novo convite familiar",
      "Você recebeu um convite para compartilhar um resumo financeiro.",
      nowIso,
    );

    return this.#view(userId, link);
  }

  accept(userId: string, linkId: string): FamilyLinkView {
    const link = this.#requireLink(userId, linkId);

    if (link.addresseeId !== userId) {
      throw new AppError("NOT_FOUND", "Convite não encontrado");
    }
    if (link.status !== "pending") {
      throw new AppError("CONFLICT", "Este convite não está mais pendente");
    }

    const nowIso = this.now().toISOString();
    this.repository.updateStatus(link.id, "accepted", nowIso);
    this.#notify(
      link.requesterId,
      "Convite familiar aceito",
      "Seu convite familiar foi aceito.",
      nowIso,
    );

    return this.#view(userId, { ...link, status: "accepted", respondedAt: nowIso });
  }

  reject(userId: string, linkId: string): FamilyLinkView {
    const link = this.#requireLink(userId, linkId);

    if (link.addresseeId !== userId) {
      throw new AppError("NOT_FOUND", "Convite não encontrado");
    }
    if (link.status !== "pending") {
      throw new AppError("CONFLICT", "Este convite não está mais pendente");
    }

    const nowIso = this.now().toISOString();
    this.repository.updateStatus(link.id, "rejected", nowIso);
    this.#notify(
      link.requesterId,
      "Convite familiar recusado",
      "Seu convite familiar foi recusado.",
      nowIso,
    );

    return this.#view(userId, { ...link, status: "rejected", respondedAt: nowIso });
  }

  revoke(userId: string, linkId: string): void {
    const link = this.#requireLink(userId, linkId);

    if (link.status !== "pending" && link.status !== "accepted") {
      throw new AppError("CONFLICT", "Este vínculo já foi encerrado");
    }

    const nowIso = this.now().toISOString();
    this.repository.updateStatus(link.id, "revoked", nowIso);

    const otherUserId = link.requesterId === userId ? link.addresseeId : link.requesterId;
    this.#notify(
      otherUserId,
      "Vínculo familiar encerrado",
      "O vínculo familiar foi encerrado.",
      nowIso,
    );
  }

  list(userId: string): FamilyLinksView {
    const links = this.repository.listForUser(userId);
    const incoming: FamilyLinkView[] = [];
    const outgoing: FamilyLinkView[] = [];
    const active: FamilyLinkView[] = [];

    for (const link of links) {
      if (link.status === "accepted") {
        active.push(this.#viewWithPartner(userId, link));
        continue;
      }
      if (link.status !== "pending") continue;

      if (link.addresseeId === userId) incoming.push(this.#viewWithPartner(userId, link));
      else outgoing.push(this.#viewWithPartner(userId, link));
    }

    return { incoming, outgoing, active };
  }

  summary(userId: string): FamilySummary {
    const link = this.repository
      .listForUser(userId)
      .find((candidate) => candidate.status === "accepted");

    if (link === undefined) {
      throw new AppError("NOT_FOUND", "Nenhum vínculo familiar ativo");
    }

    const partner = this.#partner(link, userId);
    const today = todayUtc(this.now());
    const period = monthBounds(today);

    return {
      partner,
      period,
      totals: this.repository.financeTotals(partner.id, period.from, period.to),
      counts: this.repository.counts(partner.id, period.from, period.to),
    };
  }

  #requireLink(userId: string, linkId: string): FamilyLink {
    const link = this.repository.findById(linkId);
    if (
      link === undefined ||
      (link.requesterId !== userId && link.addresseeId !== userId)
    ) {
      throw new AppError("NOT_FOUND", "Vínculo familiar não encontrado");
    }
    return link;
  }

  #view(userId: string, link: FamilyLink): FamilyLinkView {
    const withPartner = this.repository.findWithPartner(userId, link.id);
    if (withPartner === undefined) {
      throw new AppError("NOT_FOUND", "Vínculo familiar não encontrado");
    }
    return this.#viewWithPartner(userId, withPartner);
  }

  #viewWithPartner(userId: string, link: FamilyLinkWithPartner): FamilyLinkView {
    return {
      id: link.id,
      status: link.status,
      role: link.requesterId === userId ? "requester" : "addressee",
      partner: {
        id: link.partnerId,
        name: link.partnerName,
        email: link.partnerEmail,
      },
      createdAt: link.createdAt,
      respondedAt: link.respondedAt,
    };
  }

  #partner(link: FamilyLinkWithPartner, userId: string): FamilyPartnerView {
    if (link.requesterId !== userId && link.addresseeId !== userId) {
      throw new AppError("NOT_FOUND", "Parceiro familiar não encontrado");
    }
    return { id: link.partnerId, name: link.partnerName, email: link.partnerEmail };
  }

  #notify(userId: string, title: string, message: string, now: string): void {
    this.notifications.create({
      id: uuidv7(),
      userId,
      title,
      message,
      category: "family",
      severity: "low",
      link: "/family",
      now,
    });
  }
}
