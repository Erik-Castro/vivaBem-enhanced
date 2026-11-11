<script lang="ts">
  import { onMount } from "svelte";
  import AppShell from "./components/AppShell.svelte";
  import Icon from "./components/Icon.svelte";
  import type { IconName } from "./lib/icons";
  import { auth } from "./lib/auth.svelte";
  import { router } from "./lib/router.svelte";
  import Accounts from "./pages/Accounts.svelte";
  import Budgets from "./pages/Budgets.svelte";
  import Categories from "./pages/Categories.svelte";
  import ComingSoon from "./pages/ComingSoon.svelte";
  import Dashboard from "./pages/Dashboard.svelte";
  import Data from "./pages/Data.svelte";
  import Family from "./pages/Family.svelte";
  import Insights from "./pages/Insights.svelte";
  import Goals from "./pages/Goals.svelte";
  import Habits from "./pages/Habits.svelte";
  import Investments from "./pages/Investments.svelte";
  import Achievements from "./pages/Achievements.svelte";
  import Login from "./pages/Login.svelte";
  import NotFound from "./pages/NotFound.svelte";
  import Notifications from "./pages/Notifications.svelte";
  import Recurring from "./pages/Recurring.svelte";
  import Register from "./pages/Register.svelte";
  import Settings from "./pages/Settings.svelte";
  import Transactions from "./pages/Transactions.svelte";

  const publicRoutes = new Set(["/login", "/register"]);

  const comingSoon: Record<string, { title: string; description: string; icon: IconName }> = {
  };

  const isPublic = $derived(publicRoutes.has(router.path));
  const soon = $derived(comingSoon[router.path] ?? null);

  onMount(() => {
    void auth.init();
  });

  $effect(() => {
    if (!auth.ready) return;

    if (!auth.user && !isPublic) {
      router.navigate("/login");
    } else if (auth.user && isPublic) {
      router.navigate("/dashboard");
    }
  });
</script>

{#if !auth.ready}
  <div class="boot">
    <span class="brand-mark brand-mark--large"><Icon name="check" size={24} /></span>
    <span class="spinner"></span>
    <p>Carregando o Viva Bem…</p>
  </div>
{:else if isPublic}
  {#if router.path === "/register"}
    <Register />
  {:else}
    <Login />
  {/if}
{:else if auth.user}
  <AppShell user={auth.user}>
    {#if router.path === "/dashboard"}
      <Dashboard />
    {:else if router.path === "/accounts"}
      <Accounts />
    {:else if router.path === "/transactions"}
      <Transactions />
    {:else if router.path === "/recurring"}
      <Recurring />
    {:else if router.path === "/data"}
      <Data />
    {:else if router.path === "/family"}
      <Family />
    {:else if router.path === "/insights"}
      <Insights />
    {:else if router.path === "/categories"}
      <Categories />
    {:else if router.path === "/budgets"}
      <Budgets />
    {:else if router.path === "/goals"}
      <Goals />
    {:else if router.path === "/habits"}
      <Habits />
    {:else if router.path === "/investments"}
      <Investments />
    {:else if router.path === "/achievements"}
      <Achievements />
    {:else if router.path === "/notifications"}
      <Notifications />
    {:else if router.path === "/settings"}
      <Settings />
    {:else if soon}
      <ComingSoon icon={soon.icon} title={soon.title} description={soon.description} />
    {:else}
      <NotFound />
    {/if}
  </AppShell>
{/if}
