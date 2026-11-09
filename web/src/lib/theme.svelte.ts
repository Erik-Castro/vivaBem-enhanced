type Theme = "light" | "dark";

const STORAGE_KEY = "vivabem-theme";

function preferredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);

  if (stored === "light" || stored === "dark") return stored;

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

class ThemeStore {
  current = $state<Theme>(preferredTheme());

  constructor() {
    this.apply();

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
      if (localStorage.getItem(STORAGE_KEY)) return;

      this.current = event.matches ? "dark" : "light";
      this.apply();
    });
  }

  toggle(): void {
    this.current = this.current === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, this.current);
    this.apply();
  }

  private apply(): void {
    document.documentElement.dataset.theme = this.current;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", this.current === "dark" ? "#17140f" : "#b86420");
  }
}

export const theme = new ThemeStore();
