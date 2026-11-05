import type { AppDatabase } from "../../db/client.ts";

export type SubscriptionTier = "free" | "premium";

export type AuthEventType =
  | "login_success"
  | "login_failed"
  | "refresh"
  | "logout"
  | "reuse_detected";

export interface UserProfile {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly subscriptionTier: SubscriptionTier;
  readonly setupCompletedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UserCredentials {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly emailVerified: boolean;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UserPreferences {
  readonly userId: string;
  readonly timezone: string;
  readonly baseCurrency: string;
  readonly locale: string;
  /** IA é opt-in: o usuário precisa autorizar o processamento dos eventos. */
  readonly aiEnabled: boolean;
  readonly updatedAt: string;
}

export interface UserSession {
  readonly id: string;
  readonly userId: string;
  readonly refreshTokenHash: string;
  readonly tokenFamilyId: string;
  readonly rotatedFrom: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

interface UserProfileRow {
  id: string;
  name: string;
  avatar_url: string | null;
  subscription_tier: SubscriptionTier;
  setup_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface UserCredentialsRow {
  id: string;
  user_id: string;
  email: string;
  password_hash: string;
  email_verified: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

interface UserPreferencesRow {
  user_id: string;
  timezone: string;
  base_currency: string;
  locale: string;
  ai_enabled: number;
  updated_at: string;
}

interface UserSessionRow {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  token_family_id: string;
  rotated_from: string | null;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface CreateUserInput {
  readonly userId: string;
  readonly credentialsId: string;
  readonly name: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly timezone: string;
  readonly baseCurrency: string;
  readonly locale: string;
  readonly now: string;
}

export interface CreateSessionInput {
  readonly id: string;
  readonly userId: string;
  readonly refreshTokenHash: string;
  readonly tokenFamilyId: string;
  readonly rotatedFrom?: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly expiresAt: string;
  readonly now: string;
}

export interface AuthEventInput {
  readonly id: string;
  readonly userId?: string | null;
  readonly email?: string | null;
  readonly type: AuthEventType;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly now: string;
}

/**
 * Acesso às tabelas de identidade. Não conhece HTTP: recebe e devolve tipos em
 * camelCase, mantendo o snake_case restrito ao SQL.
 */
export class AuthRepository {
  constructor(private readonly db: AppDatabase) {}

  findProfileById(userId: string): UserProfile | undefined {
    const row = this.db
      .prepare<[string], UserProfileRow>("SELECT * FROM user_profiles WHERE id = ?")
      .get(userId);
    return row ? mapProfile(row) : undefined;
  }

  findCredentialsByEmail(email: string): UserCredentials | undefined {
    const row = this.db
      .prepare<[string], UserCredentialsRow>(
        "SELECT * FROM user_credentials WHERE email = ?",
      )
      .get(email);
    return row ? mapCredentials(row) : undefined;
  }

  findCredentialsByUserId(userId: string): UserCredentials | undefined {
    const row = this.db
      .prepare<[string], UserCredentialsRow>(
        "SELECT * FROM user_credentials WHERE user_id = ?",
      )
      .get(userId);
    return row ? mapCredentials(row) : undefined;
  }

  findPreferences(userId: string): UserPreferences | undefined {
    const row = this.db
      .prepare<[string], UserPreferencesRow>(
        "SELECT * FROM user_preferences WHERE user_id = ?",
      )
      .get(userId);
    return row ? mapPreferences(row) : undefined;
  }

  /** Deve ser chamado dentro de uma transação. */
  createUser(input: CreateUserInput): void {
    this.db
      .prepare<[string, string, string, string]>(
        `INSERT INTO user_profiles (id, name, subscription_tier, created_at, updated_at)
         VALUES (?, ?, 'free', ?, ?)`,
      )
      .run(input.userId, input.name, input.now, input.now);

    this.db
      .prepare<[string, string, string, string, string, string]>(
        `INSERT INTO user_credentials
           (id, user_id, email, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.credentialsId,
        input.userId,
        input.email,
        input.passwordHash,
        input.now,
        input.now,
      );

    this.db
      .prepare<[string, string, string, string, string]>(
        `INSERT INTO user_preferences (user_id, timezone, base_currency, locale, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.userId, input.timezone, input.baseCurrency, input.locale, input.now);
  }

  createSession(input: CreateSessionInput): void {
    this.db
      .prepare<
        [
          string,
          string,
          string,
          string,
          string | null,
          string | null,
          string | null,
          string,
          string,
        ]
      >(
        `INSERT INTO user_sessions
           (id, user_id, refresh_token_hash, token_family_id, rotated_from,
            ip_address, user_agent, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.userId,
        input.refreshTokenHash,
        input.tokenFamilyId,
        input.rotatedFrom ?? null,
        input.ipAddress ?? null,
        input.userAgent ?? null,
        input.expiresAt,
        input.now,
      );
  }

  findSessionByRefreshHash(refreshTokenHash: string): UserSession | undefined {
    const row = this.db
      .prepare<[string], UserSessionRow>(
        "SELECT * FROM user_sessions WHERE refresh_token_hash = ?",
      )
      .get(refreshTokenHash);
    return row ? mapSession(row) : undefined;
  }

  findSessionById(sessionId: string): UserSession | undefined {
    const row = this.db
      .prepare<[string], UserSessionRow>("SELECT * FROM user_sessions WHERE id = ?")
      .get(sessionId);
    return row ? mapSession(row) : undefined;
  }

  listSessions(userId: string): UserSession[] {
    return this.db
      .prepare<[string], UserSessionRow>(
        "SELECT * FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC",
      )
      .all(userId)
      .map(mapSession);
  }

  countActiveSessions(userId: string, now: string): number {
    const row = this.db
      .prepare<[string, string], { count: number }>(
        `SELECT COUNT(*) AS count FROM user_sessions
         WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
      )
      .get(userId, now);
    return row?.count ?? 0;
  }

  revokeSession(sessionId: string, now: string): void {
    this.db
      .prepare<[string, string]>(
        "UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
      )
      .run(now, sessionId);
  }

  /** Revoga uma sessão apenas se ela pertencer ao usuário informado. */
  revokeUserSession(userId: string, sessionId: string, now: string): boolean {
    return this.db
      .prepare<[string, string, string]>(
        `UPDATE user_sessions SET revoked_at = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      )
      .run(now, sessionId, userId).changes > 0;
  }

  revokeSessionFamily(tokenFamilyId: string, now: string): void {
    this.db
      .prepare<[string, string]>(
        `UPDATE user_sessions SET revoked_at = ?
         WHERE token_family_id = ? AND revoked_at IS NULL`,
      )
      .run(now, tokenFamilyId);
  }

  touchSession(sessionId: string, now: string): void {
    this.db
      .prepare<[string, string]>(
        "UPDATE user_sessions SET last_used_at = ? WHERE id = ?",
      )
      .run(now, sessionId);
  }

  updateLastLogin(userId: string, now: string): void {
    this.db
      .prepare<[string, string, string]>(
        "UPDATE user_credentials SET last_login_at = ?, updated_at = ? WHERE user_id = ?",
      )
      .run(now, now, userId);
  }

  updateProfile(
    userId: string,
    patch: { readonly name?: string; readonly avatarUrl?: string | null },
    now: string,
  ): UserProfile | undefined {
    const current = this.findProfileById(userId);
    if (!current) return undefined;

    this.db
      .prepare<[string, string | null, string, string]>(
        "UPDATE user_profiles SET name = ?, avatar_url = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        patch.name ?? current.name,
        patch.avatarUrl === undefined ? current.avatarUrl : patch.avatarUrl,
        now,
        userId,
      );

    return this.findProfileById(userId);
  }

  updatePreferences(
    userId: string,
    patch: {
      readonly timezone?: string;
      readonly baseCurrency?: string;
      readonly locale?: string;
      readonly aiEnabled?: boolean;
    },
    now: string,
  ): UserPreferences | undefined {
    const current = this.findPreferences(userId);
    if (!current) return undefined;

    this.db
      .prepare<[string, string, string, number, string, string]>(
        `UPDATE user_preferences
         SET timezone = ?, base_currency = ?, locale = ?, ai_enabled = ?, updated_at = ?
         WHERE user_id = ?`,
      )
      .run(
        patch.timezone ?? current.timezone,
        patch.baseCurrency ?? current.baseCurrency,
        patch.locale ?? current.locale,
        (patch.aiEnabled ?? current.aiEnabled) ? 1 : 0,
        now,
        userId,
      );

    return this.findPreferences(userId);
  }

  insertAuthEvent(input: AuthEventInput): void {
    this.db
      .prepare<
        [string, string | null, string | null, string, string | null, string | null, string]
      >(
        `INSERT INTO auth_events
           (id, user_id, email, type, ip_address, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.userId ?? null,
        input.email ?? null,
        input.type,
        input.ipAddress ?? null,
        input.userAgent ?? null,
        input.now,
      );
  }
}

function mapProfile(row: UserProfileRow): UserProfile {
  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatar_url,
    subscriptionTier: row.subscription_tier,
    setupCompletedAt: row.setup_completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCredentials(row: UserCredentialsRow): UserCredentials {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    passwordHash: row.password_hash,
    emailVerified: row.email_verified === 1,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPreferences(row: UserPreferencesRow): UserPreferences {
  return {
    userId: row.user_id,
    timezone: row.timezone,
    baseCurrency: row.base_currency,
    locale: row.locale,
    aiEnabled: row.ai_enabled === 1,
    updatedAt: row.updated_at,
  };
}

function mapSession(row: UserSessionRow): UserSession {
  return {
    id: row.id,
    userId: row.user_id,
    refreshTokenHash: row.refresh_token_hash,
    tokenFamilyId: row.token_family_id,
    rotatedFrom: row.rotated_from,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}
