import { api, refreshSessionOnce, setActiveUser, setAuthHooks, setCsrfToken } from "./api";
import { clearQueue } from "./offline-queue";
import { push } from "./push.svelte";
import type { AuthPayload, MePayload, User } from "./types";

class AuthStore {
  user = $state<User | null>(null);
  ready = $state(false);
  busy = $state(false);

  constructor() {
    setAuthHooks({
      refreshed: (user) => {
        this.user = user;
        setActiveUser(user.id);
      },
      expired: () => {
        this.user = null;
        // Impede replay da fila offline até uma nova sessão ser confirmada.
        setActiveUser(null);
      },
    });
  }

  async init(): Promise<void> {
    if (this.ready) return;

    try {
      const me = await api<MePayload>("/me");
      this.user = me.user;
      setActiveUser(me.user.id);
    } catch {
      this.user = null;
      setActiveUser(null);
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
    const userId = this.user?.id ?? null;

    // O vínculo push é desfeito com a sessão ainda válida (CSRF necessário).
    await push.revokeOnLogout();

    try {
      await api<void>("/auth/logout", { method: "POST", retry: false });
    } catch {
      // A sessão local é limpa mesmo quando o servidor não responde.
    } finally {
      this.user = null;
      setActiveUser(null);

      // Descarta mutações pendentes do usuário que saiu: outra conta no mesmo
      // navegador não deve herdar nem reproduzir esses payloads.
      if (userId !== null) {
        await clearQueue(userId).catch(() => undefined);
      }
    }
  }

  refresh(): Promise<boolean> {
    return refreshSessionOnce();
  }

  updateUser(user: User): void {
    this.user = user;
  }

  private absorb(payload: AuthPayload): void {
    setActiveUser(payload.user.id);
    setCsrfToken(payload.csrfToken);
    this.user = payload.user;
  }
}

export const auth = new AuthStore();
