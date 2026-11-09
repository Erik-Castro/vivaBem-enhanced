function normalizePath(hash: string): string {
  const raw = hash.replace(/^#/, "").trim();

  if (raw === "" || raw === "/") return "/dashboard";

  return raw.startsWith("/") ? raw : `/${raw}`;
}

class Router {
  path = $state(normalizePath(window.location.hash));

  constructor() {
    window.addEventListener("hashchange", () => {
      this.path = normalizePath(window.location.hash);
      window.scrollTo({ top: 0, behavior: "auto" });
    });

    if (!window.location.hash) {
      window.history.replaceState(null, "", `#${this.path}`);
    }
  }

  navigate(path: string): void {
    const next = normalizePath(path);

    if (this.path === next) return;

    window.location.hash = next;
  }
}

export const router = new Router();
