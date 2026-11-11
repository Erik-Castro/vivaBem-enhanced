<script lang="ts">
  import { onDestroy, onMount, type Snippet } from "svelte";
  import type { IconName } from "../lib/icons";
  import type { User } from "../lib/types";
  import { auth } from "../lib/auth.svelte";
  import { notifications } from "../lib/notifications.svelte";
  import { router } from "../lib/router.svelte";
  import { theme } from "../lib/theme.svelte";
  import { toasts } from "../lib/toast.svelte";
  import { initials } from "../lib/format";
  import Icon from "./Icon.svelte";
  import NotificationBell from "./NotificationBell.svelte";
  import NotificationPanel from "./NotificationPanel.svelte";
  import ToastHost from "./ToastHost.svelte";

  let { user, children }: { user: User; children: Snippet } = $props();

  onMount(() => {
    notifications.startPolling();
  });

  onDestroy(() => {
    notifications.stopPolling();
  });

  interface NavItem {
    readonly path: string;
    readonly label: string;
    readonly icon: IconName;
  }

  const mainNav: NavItem[] = [
    { path: "/dashboard", label: "Painel", icon: "dashboard" },
    { path: "/transactions", label: "Transações", icon: "arrows" },
    { path: "/recurring", label: "Recorrências", icon: "repeat" },
    { path: "/accounts", label: "Contas", icon: "wallet" },
    { path: "/categories", label: "Categorias", icon: "tag" },
    { path: "/budgets", label: "Orçamentos", icon: "chart" },
    { path: "/goals", label: "Metas", icon: "target" },
    { path: "/habits", label: "Hábitos", icon: "heart" },
    { path: "/investments", label: "Investimentos", icon: "piggy" },
    { path: "/achievements", label: "Conquistas", icon: "trophy" },
    { path: "/notifications", label: "Notificações", icon: "bell" },
    { path: "/data", label: "Dados", icon: "database" },
    { path: "/settings", label: "Configurações", icon: "sliders" },
  ];

  const comingSoonNav: NavItem[] = [
  ];

  const titles: Record<string, string> = {
    "/dashboard": "Painel",
    "/transactions": "Transações",
    "/recurring": "Recorrências",
    "/accounts": "Contas",
    "/categories": "Categorias",
    "/settings": "Configurações",
    "/budgets": "Orçamentos",
    "/goals": "Metas",
    "/habits": "Hábitos",
    "/investments": "Investimentos",
    "/achievements": "Conquistas",
    "/notifications": "Notificações",
    "/data": "Dados",
  };

  const mobilePaths = new Set([
    "/dashboard",
    "/transactions",
    "/accounts",
    "/budgets",
    "/goals",
  ]);
  const mobileNav = mainNav.filter((item) => mobilePaths.has(item.path));
  const moreNav: NavItem[] = [
    ...mainNav.filter((item) => !mobilePaths.has(item.path)),
    ...comingSoonNav,
  ];
  const soonPaths = new Set(comingSoonNav.map((item) => item.path));
  const currentTitle = $derived(titles[router.path] ?? "Viva Bem");

  let loggingOut = $state(false);
  let menuOpen = $state(false);

  $effect(() => {
    // Fecha o menu "Mais" sempre que a rota muda.
    router.path;
    menuOpen = false;
  });

  function isActive(path: string): boolean {
    return router.path === path;
  }

  async function handleLogout(): Promise<void> {
    if (loggingOut) return;

    loggingOut = true;

    try {
      await auth.logout();
      router.navigate("/login");
      toasts.push("Sessão encerrada", "info");
    } finally {
      loggingOut = false;
    }
  }
</script>

<div class="shell">
  <aside class="sidebar">
    <a class="brand" href="#/dashboard" aria-label="Viva Bem — ir para o painel">
      <span class="brand-mark"><Icon name="check" size={18} /></span>
      <span class="brand-name">Viva Bem</span>
    </a>

    <nav class="nav" aria-label="Navegação principal">
      {#each mainNav as item}
        <a
          class="nav-link"
          class:active={isActive(item.path)}
          href={`#${item.path}`}
          aria-current={isActive(item.path) ? "page" : undefined}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </a>
      {/each}
    </nav>

    <div class="nav-section">
      <span class="nav-title">Em breve</span>
      {#each comingSoonNav as item}
        <a
          class="nav-link nav-link--muted"
          class:active={isActive(item.path)}
          href={`#${item.path}`}
          aria-current={isActive(item.path) ? "page" : undefined}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </a>
      {/each}
    </div>

    <div class="sidebar-footer">
      <a class="user-chip" href="#/settings">
        {#if user.avatarUrl}
          <img class="avatar" src={user.avatarUrl} alt="" referrerpolicy="no-referrer" />
        {:else}
          <span class="avatar avatar--initials">{initials(user.name)}</span>
        {/if}
        <span class="user-chip__text">
          <strong>{user.name}</strong>
          <small>{user.email}</small>
        </span>
      </a>
      <button
        class="btn btn--icon btn--ghost"
        type="button"
        title="Sair"
        aria-label="Sair"
        disabled={loggingOut}
        onclick={handleLogout}
      >
        <Icon name="logout" />
      </button>
    </div>
  </aside>

  <div class="main">
    <header class="topbar">
      <a class="brand brand--mobile" href="#/dashboard" aria-label="Viva Bem">
        <span class="brand-mark"><Icon name="check" size={16} /></span>
        <span class="brand-name">Viva Bem</span>
      </a>
      <h1 class="topbar-title">{currentTitle}</h1>
      <div class="topbar-actions">
        <NotificationBell />
        <button
          class="btn btn--icon btn--ghost"
          type="button"
          aria-label={theme.current === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
          title={theme.current === "dark" ? "Tema claro" : "Tema escuro"}
          onclick={() => theme.toggle()}
        >
          <Icon name={theme.current === "dark" ? "sun" : "moon"} />
        </button>
        <a class="avatar avatar--small" href="#/settings" aria-label="Configurações">
          {#if user.avatarUrl}
            <img src={user.avatarUrl} alt="" referrerpolicy="no-referrer" />
          {:else}
            <span class="avatar avatar--initials">{initials(user.name)}</span>
          {/if}
        </a>
      </div>
    </header>

    <NotificationPanel />

    <main class="content">
      {@render children()}
    </main>
  </div>

  <nav class="mobile-nav" aria-label="Navegação">
    {#each mobileNav as item}
      <a
        class="mobile-nav__link"
        class:active={isActive(item.path)}
        href={`#${item.path}`}
        aria-current={isActive(item.path) ? "page" : undefined}
      >
        <Icon name={item.icon} size={22} />
        <span>{item.label}</span>
      </a>
    {/each}
    <button
      class="mobile-nav__link"
      class:active={moreNav.some((item) => isActive(item.path))}
      type="button"
      aria-expanded={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}
    >
      <Icon name="sliders" size={22} />
      <span>Mais</span>
    </button>
  </nav>

  {#if menuOpen}
    <div class="mobile-menu-layer">
      <button
        class="mobile-menu-backdrop"
        type="button"
        aria-label="Fechar menu"
        onclick={() => (menuOpen = false)}
      ></button>
      <nav class="mobile-menu" aria-label="Mais opções">
        <span class="mobile-menu__title">Mais</span>
        {#each moreNav as item (item.path)}
          <a
            class="mobile-menu__link"
            class:active={isActive(item.path)}
            class:mobile-menu__link--muted={soonPaths.has(item.path)}
            href={`#${item.path}`}
            aria-current={isActive(item.path) ? "page" : undefined}
            onclick={() => (menuOpen = false)}
          >
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </a>
        {/each}
      </nav>
    </div>
  {/if}

  <ToastHost />
</div>
