import { AppError } from "../../http/errors.ts";
import type { AuthRepository, UserPreferences, UserProfile } from "../auth/auth.repository.ts";

export interface UserView {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly avatarUrl: string | null;
  readonly subscriptionTier: "free" | "premium";
  readonly emailVerified: boolean;
  readonly createdAt: string;
  readonly preferences: {
    readonly timezone: string;
    readonly baseCurrency: string;
    readonly locale: string;
    readonly aiEnabled: boolean;
  };
}

export interface SessionView {
  readonly id: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string;
  readonly current: boolean;
}

export interface MeResult {
  readonly user: UserView;
  readonly stats: {
    readonly activeSessions: number;
  };
}

export class UsersService {
  constructor(private readonly repository: AuthRepository) {}

  getMe(userId: string): MeResult {
    const { user, credentials, preferences } = this.#load(userId);

    return {
      user: toUserView(user, credentials.email, credentials.emailVerified, preferences),
      stats: {
        activeSessions: this.repository.countActiveSessions(userId, new Date().toISOString()),
      },
    };
  }

  updateMe(
    userId: string,
    patch: { readonly name?: string; readonly avatarUrl?: string | null },
  ): MeResult {
    const updated = this.repository.updateProfile(userId, patch, new Date().toISOString());
    if (!updated) {
      throw new AppError("NOT_FOUND", "Usuário não encontrado");
    }
    return this.getMe(userId);
  }

  updatePreferences(
    userId: string,
    patch: {
      readonly timezone?: string;
      readonly baseCurrency?: string;
      readonly locale?: string;
      readonly aiEnabled?: boolean;
    },
  ): MeResult {
    const updated = this.repository.updatePreferences(userId, patch, new Date().toISOString());
    if (!updated) {
      throw new AppError("NOT_FOUND", "Preferências não encontradas");
    }
    return this.getMe(userId);
  }

  listSessions(userId: string, currentSessionId: string): SessionView[] {
    return this.repository
      .listSessions(userId)
      .filter((session) =>
        session.revokedAt === null && session.expiresAt > new Date().toISOString()
      )
      .map((session) => ({
        id: session.id,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
        expiresAt: session.expiresAt,
        current: session.id === currentSessionId,
      }));
  }

  revokeSession(userId: string, sessionId: string): void {
    const session = this.repository.findSessionById(sessionId);
    if (!session || session.userId !== userId) {
      throw new AppError("NOT_FOUND", "Sessão não encontrada");
    }

    this.repository.revokeSession(sessionId, new Date().toISOString());
  }

  #load(userId: string): {
    readonly user: UserProfile;
    readonly credentials: { readonly email: string; readonly emailVerified: boolean };
    readonly preferences: UserPreferences;
  } {
    const user = this.repository.findProfileById(userId);
    const credentials = this.repository.findCredentialsByUserId(userId);
    const preferences = this.repository.findPreferences(userId);

    if (!user || !credentials || !preferences) {
      throw new AppError("NOT_FOUND", "Usuário não encontrado");
    }

    return { user, credentials, preferences };
  }
}

export function toUserView(
  user: UserProfile,
  email: string,
  emailVerified: boolean,
  preferences: UserPreferences,
): UserView {
  return {
    id: user.id,
    name: user.name,
    email,
    avatarUrl: user.avatarUrl,
    subscriptionTier: user.subscriptionTier,
    emailVerified,
    createdAt: user.createdAt,
    preferences: {
      timezone: preferences.timezone,
      baseCurrency: preferences.baseCurrency,
      locale: preferences.locale,
      aiEnabled: preferences.aiEnabled,
    },
  };
}
