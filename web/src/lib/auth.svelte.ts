import { api, refreshSessionOnce, setAuthHooks, setCsrfToken } from "./api";
import type { AuthPayload, MePayload, User } from "./types";

class AuthStore {
  user = $state<User | null>(null);
  ready = $state(false);
  busy = $state(false);

  constructor() {
    setAuthHooks({
      refreshed: (user) => {
        this.user = user;
      },
      expired: () => {
        this.user = null;
      },
    });
  }

  async init(): Promise<void> {
    if (this.ready) return;

    try {
      const me = await api<MePayload>("/me");
      this.user = me.user;
    } catch {
      this.user = null;
    } finally {
      this.ready = true;
    }
  }

  async login(email: string, password: string): Promise<void> {
    this.busy = true;

    try {
      const payload = await api<AuthPayload>("/auth/login", {
        method: "POST",
        body: { email, password },
        retry: false,
      });

      this.absorb(payload);
    } finally {
      this.busy = false;
    }
  }

  async register(name: string, email: string, password: string): Promise<void> {
    this.busy = true;

    try {
      const payload = await api<AuthPayload>("/auth/register", {
        method: "POST",
        body: { name, email, password },
        retry: false,
      });

      this.absorb(payload);
    } finally {
      this.busy = false;
    }
  }

  async logout(): Promise<void> {
    try {
      await api<void>("/auth/logout", { method: "POST", retry: false });
    } catch {
      // A sessão local é limpa mesmo quando o servidor não responde.
    } finally {
      this.user = null;
    }
  }

  refresh(): Promise<boolean> {
    return refreshSessionOnce();
  }

  updateUser(user: User): void {
    this.user = user;
  }

  private absorb(payload: AuthPayload): void {
    setCsrfToken(payload.csrfToken);
    this.user = payload.user;
  }
}

export const auth = new AuthStore();
