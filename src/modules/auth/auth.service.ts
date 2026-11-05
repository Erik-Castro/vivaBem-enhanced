import type { AppConfig } from "../../config.ts";
import type { AppDatabase } from "../../db/client.ts";
import type { EventPublisher } from "../../events/event-publisher.ts";
import { hashPassword, verifyPassword } from "../../shared/helpers/argon2id.ts";
import { signAccessToken } from "../../shared/crypto/jwt.ts";
import { generateOpaqueToken, sha256Hex } from "../../shared/crypto/tokens.ts";
import { parseDurationSeconds } from "../../shared/utils/duration.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";
import type { Logger } from "../../shared/logger/index.ts";
import type { SlidingWindowRateLimiter } from "../../shared/utils/rate-limiter.ts";
import { AppError } from "../../http/errors.ts";
import type {
  AuthRepository,
  UserCredentials,
  UserPreferences,
  UserProfile,
  UserSession,
} from "./auth.repository.ts";

export interface RequestContext {
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface RegisterInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly csrfToken: string;
  readonly accessMaxAgeSeconds: number;
  readonly refreshMaxAgeSeconds: number;
}

export interface AuthResult extends AuthTokens {
  readonly user: UserProfile;
  readonly credentials: UserCredentials;
  readonly preferences: UserPreferences;
}

export interface AuthServiceDependencies {
  readonly db: AppDatabase;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly repository: AuthRepository;
  readonly rateLimiter: SlidingWindowRateLimiter;
  readonly events?: EventPublisher;
}

/**
 * Regras de identidade: registro, login, rotação de refresh, logout e proteção
 * contra reuso. Não conhece cookies nem HTTP — devolve tokens para o controller
 * decidir como transportá-los.
 */
export class AuthService {
  readonly #db: AppDatabase;
  readonly #config: AppConfig;
  readonly #logger: Logger;
  readonly #repository: AuthRepository;
  readonly #rateLimiter: SlidingWindowRateLimiter;
  readonly #events: EventPublisher | null;
  readonly #accessTtlSeconds: number;
  readonly #refreshTtlSeconds: number;
  #dummyHash?: Promise<string>;

  constructor(dependencies: AuthServiceDependencies) {
    this.#db = dependencies.db;
    this.#config = dependencies.config;
    this.#logger = dependencies.logger;
    this.#repository = dependencies.repository;
    this.#rateLimiter = dependencies.rateLimiter;
    this.#events = dependencies.events ?? null;
    this.#accessTtlSeconds = parseDurationSeconds(this.#config.accessTokenTtl) ?? 15 * 60;
    this.#refreshTtlSeconds = parseDurationSeconds(this.#config.refreshTokenTtl) ??
      30 * 24 * 60 * 60;
  }

  async register(input: RegisterInput, context: RequestContext): Promise<AuthResult> {
    const email = normalizeEmail(input.email);
    this.#enforceEmailRateLimit(email);

    if (this.#repository.findCredentialsByEmail(email)) {
      throw new AppError("CONFLICT", "E-mail já cadastrado");
    }

    const passwordHash = await hashPassword(input.password, {
      memoryKiB: this.#config.argon2.memoryKiB,
      iterations: this.#config.argon2.iterations,
      parallelism: this.#config.argon2.parallelism,
    });

    const now = new Date();
    const nowIso = now.toISOString();
    const userId = uuidv7();
    const familyId = uuidv7();
    const session = await this.#newSessionTokens(now);

    this.#db.transaction(() => {
      this.#repository.createUser({
        userId,
        credentialsId: uuidv7(),
        name: input.name.trim(),
        email,
        passwordHash,
        timezone: "America/Sao_Paulo",
        baseCurrency: "BRL",
        locale: "pt-BR",
        now: nowIso,
      });

      this.#repository.createSession({
        id: session.sessionId,
        userId,
        refreshTokenHash: session.refreshTokenHash,
        tokenFamilyId: familyId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        expiresAt: session.expiresAt,
        now: nowIso,
      });

      this.#repository.insertAuthEvent({
        id: uuidv7(),
        userId,
        email,
        type: "login_success",
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        now: nowIso,
      });

      this.#publishSecurity("security.login_success", userId, {
        email,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        registered: true,
      });
    });

    return this.#buildResult(userId, session, now);
  }

  async login(input: LoginInput, context: RequestContext): Promise<AuthResult> {
    const email = normalizeEmail(input.email);
    this.#enforceEmailRateLimit(email);

    const credentials = this.#repository.findCredentialsByEmail(email);

    if (!credentials) {
      // Verificação contra hash fictício: o tempo de resposta não revela se o
      // e-mail existe.
      await verifyPassword(await this.#getDummyHash(), input.password);
      this.#recordAuthEvent({
        email,
        type: "login_failed",
        context,
      });
      throw new AppError("UNAUTHORIZED", "E-mail ou senha inválidos");
    }

    const valid = await verifyPassword(credentials.passwordHash, input.password);
    if (!valid) {
      this.#recordAuthEvent({
        userId: credentials.userId,
        email,
        type: "login_failed",
        context,
      });
      throw new AppError("UNAUTHORIZED", "E-mail ou senha inválidos");
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const familyId = uuidv7();
    const session = await this.#newSessionTokens(now);

    this.#db.transaction(() => {
      this.#repository.createSession({
        id: session.sessionId,
        userId: credentials.userId,
        refreshTokenHash: session.refreshTokenHash,
        tokenFamilyId: familyId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        expiresAt: session.expiresAt,
        now: nowIso,
      });
      this.#repository.updateLastLogin(credentials.userId, nowIso);
      this.#repository.insertAuthEvent({
        id: uuidv7(),
        userId: credentials.userId,
        email,
        type: "login_success",
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        now: nowIso,
      });

      this.#publishSecurity("security.login_success", credentials.userId, {
        email,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        registered: false,
      });
    });

    return this.#buildResult(credentials.userId, session, now);
  }

  /**
   * Rotaciona o refresh token. Se o token recebido já foi rotacionado/revogado,
   * trata como reuso e revoga a família inteira.
   */
  async refresh(refreshToken: string | undefined, context: RequestContext): Promise<AuthResult> {
    if (refreshToken === undefined || refreshToken === "") {
      throw new AppError("UNAUTHORIZED", "Sessão inválida");
    }

    const refreshTokenHash = await sha256Hex(refreshToken);
    const session = this.#repository.findSessionByRefreshHash(refreshTokenHash);

    if (!session) {
      throw new AppError("UNAUTHORIZED", "Sessão inválida");
    }

    const now = new Date();
    const nowIso = now.toISOString();

    if (session.revokedAt !== null) {
      this.#repository.revokeSessionFamily(session.tokenFamilyId, nowIso);
      this.#recordAuthEvent({
        userId: session.userId,
        type: "reuse_detected",
        context,
      });
      this.#logger.warn("refresh_token_reuse_detected", {
        userId: session.userId,
        sessionId: session.id,
        tokenFamilyId: session.tokenFamilyId,
      });
      throw new AppError("UNAUTHORIZED", "Sessão inválida");
    }

    if (session.expiresAt <= nowIso) {
      this.#repository.revokeSession(session.id, nowIso);
      throw new AppError("UNAUTHORIZED", "Sessão expirada");
    }

    const rotated = await this.#newSessionTokens(now);

    this.#db.transaction(() => {
      this.#repository.revokeSession(session.id, nowIso);
      this.#repository.createSession({
        id: rotated.sessionId,
        userId: session.userId,
        refreshTokenHash: rotated.refreshTokenHash,
        tokenFamilyId: session.tokenFamilyId,
        rotatedFrom: session.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        expiresAt: rotated.expiresAt,
        now: nowIso,
      });
      this.#repository.insertAuthEvent({
        id: uuidv7(),
        userId: session.userId,
        type: "refresh",
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        now: nowIso,
      });
    });

    return this.#buildResult(session.userId, rotated, now);
  }

  async logout(
    refreshToken: string | undefined,
    sessionId: string | undefined,
    context: RequestContext,
  ): Promise<void> {
    const now = new Date().toISOString();

    let session: UserSession | undefined;

    if (refreshToken !== undefined && refreshToken !== "") {
      session = this.#repository.findSessionByRefreshHash(await sha256Hex(refreshToken));
    } else if (sessionId !== undefined) {
      session = this.#repository.findSessionById(sessionId);
    }

    if (!session) return;

    this.#repository.revokeSession(session.id, now);
    this.#recordAuthEvent({
      userId: session.userId,
      type: "logout",
      context,
    });
  }

  /** Token CSRF novo, para o endpoint de bootstrap. */
  createCsrfToken(): string {
    return generateOpaqueToken(32);
  }

  async #newSessionTokens(now: Date): Promise<{
    readonly sessionId: string;
    readonly refreshToken: string;
    readonly refreshTokenHash: string;
    readonly expiresAt: string;
  }> {
    const refreshToken = generateOpaqueToken(32);
    return {
      sessionId: uuidv7(),
      refreshToken,
      refreshTokenHash: await sha256Hex(refreshToken),
      expiresAt: new Date(now.getTime() + this.#refreshTtlSeconds * 1_000).toISOString(),
    };
  }

  async #buildResult(
    userId: string,
    session: {
      readonly sessionId: string;
      readonly refreshToken: string;
      readonly expiresAt: string;
    },
    now: Date,
  ): Promise<AuthResult> {
    const user = this.#repository.findProfileById(userId);
    const credentials = this.#repository.findCredentialsByUserId(userId);
    const preferences = this.#repository.findPreferences(userId);

    if (!user || !credentials || !preferences) {
      throw new AppError("INTERNAL_ERROR", "Não foi possível carregar o usuário", {
        expose: false,
      });
    }

    const issuedAt = Math.floor(now.getTime() / 1_000);
    const accessToken = await signAccessToken(
      {
        sub: userId,
        sid: session.sessionId,
        iat: issuedAt,
        exp: issuedAt + this.#accessTtlSeconds,
      },
      this.#config.jwtSecret,
    );

    return {
      user,
      credentials,
      preferences,
      accessToken,
      refreshToken: session.refreshToken,
      csrfToken: generateOpaqueToken(32),
      accessMaxAgeSeconds: this.#accessTtlSeconds,
      refreshMaxAgeSeconds: this.#refreshTtlSeconds,
    };
  }

  #recordAuthEvent(input: {
    readonly userId?: string | null;
    readonly email?: string | null;
    readonly type: "login_success" | "login_failed" | "refresh" | "logout" | "reuse_detected";
    readonly context: RequestContext;
  }): void {
    this.#repository.insertAuthEvent({
      id: uuidv7(),
      userId: input.userId,
      email: input.email,
      type: input.type,
      ipAddress: input.context.ipAddress,
      userAgent: input.context.userAgent,
      now: new Date().toISOString(),
    });

    // Só falhas e reuso viram evento de IA. `refresh` e `logout` são ruído
    // operacional e não devem consumir tokens do provider.
    if (input.type === "login_failed" && input.userId) {
      this.#publishSecurity("security.login_failed", input.userId, {
        email: input.email,
        ipAddress: input.context.ipAddress,
        userAgent: input.context.userAgent,
      });
    } else if (input.type === "reuse_detected" && input.userId) {
      this.#publishSecurity("security.session_reuse", input.userId, {
        email: input.email,
        ipAddress: input.context.ipAddress,
        userAgent: input.context.userAgent,
      });
    }
  }

  #publishSecurity(
    type: "security.login_failed" | "security.login_success" | "security.session_reuse",
    userId: string,
    payload: Record<string, unknown>,
  ): void {
    this.#events?.publish({
      type,
      aggregateType: "user",
      aggregateId: userId,
      userId,
      payload,
    });
  }

  #enforceEmailRateLimit(email: string): void {
    const result = this.#rateLimiter.consume(
      `auth-email:${email}`,
      this.#config.rateLimit.authMax,
      this.#config.rateLimit.windowMs,
    );

    if (!result.allowed) {
      throw new AppError(
        "RATE_LIMITED",
        "Muitas tentativas. Tente novamente em instantes.",
      );
    }
  }

  #getDummyHash(): Promise<string> {
    this.#dummyHash ??= hashPassword(`dummy-${crypto.randomUUID()}`, {
      memoryKiB: this.#config.argon2.memoryKiB,
      iterations: this.#config.argon2.iterations,
      parallelism: this.#config.argon2.parallelism,
    });
    return this.#dummyHash;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
