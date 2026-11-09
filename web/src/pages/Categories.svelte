<script lang="ts">
  import { onMount } from "svelte";
  import CategoryFormModal from "../components/CategoryFormModal.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Icon from "../components/Icon.svelte";
  import { api, errorMessage } from "../lib/api";
  import { flattenCategoryTree } from "../lib/labels";
  import { toasts } from "../lib/toast.svelte";
  import type { Category, CategoryNode } from "../lib/types";

  let tree = $state<CategoryNode[]>([]);
  let flat = $state<Category[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let tab = $state<"expense" | "income">("expense");
  let showInactive = $state(true);
  let modalOpen = $state(false);
  let editing = $state<Category | null>(null);
  let toggling = $state<string | null>(null);

  const flatTree = $derived(flattenCategoryTree(tree));
  const visibleRows = $derived(
    flatTree.filter(
      (row) => row.category.type === tab && (showInactive || row.category.isActive),
    ),
  );
  const counts = $derived.by(() => {
    let expense = 0;
    let income = 0;
    let expenseActive = 0;
    let incomeActive = 0;

    for (const row of flatTree) {
      if (row.category.type === "expense") {
        expense++;
        if (row.category.isActive) expenseActive++;
      } else if (row.category.type === "income") {
        income++;
        if (row.category.isActive) incomeActive++;
      }
    }

    return { expense, income, expenseActive, incomeActive };
  });

  function toFlat(nodes: readonly CategoryNode[]): Category[] {
    return flattenCategoryTree(nodes).map((row) => row.category);
  }

  async function load(): Promise<void> {
    loading = true;
    error = null;

    try {
      const payload = await api<{ categories: CategoryNode[] }>("/categories/tree", {
        query: { includeInactive: true },
      });
      tree = payload.categories;
      flat = toFlat(payload.categories);
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  function openCreate(): void {
    editing = null;
    modalOpen = true;
  }

  function openEdit(category: Category): void {
    editing = category;
    modalOpen = true;
  }

  async function toggleActive(category: Category): Promise<void> {
    const nextState = !category.isActive;
    const question = nextState
      ? `Reativar a categoria "${category.name}"?`
      : `Desativar "${category.name}"? As subcategorias também serão desativadas.`;

    if (!window.confirm(question)) return;

    toggling = category.id;

    try {
      await api(`/categories/${category.id}`, {
        method: "PATCH",
        body: { isActive: nextState },
      });
      toasts.success(nextState ? "Categoria reativada" : "Categoria desativada");
      await load();
    } catch (cause) {
      toasts.error(errorMessage(cause));
    } finally {
      toggling = null;
    }
  }

  onMount(load);
</script>

<div class="page-head">
  <div>
    <p class="eyebrow">Organização</p>
    <h2>Categorias</h2>
    <p class="page-subtitle">Agrupe receitas e despesas para entender para onde o dinheiro vai.</p>
  </div>
  <div class="page-actions">
    <button class="btn btn--primary" type="button" onclick={openCreate}>
      <Icon name="plus" size={18} />
      Nova categoria
    </button>
  </div>
</div>

<div class="toolbar">
  <div class="tabs" role="tablist" aria-label="Tipo de categoria">
    <button
      class="tab"
      class:active={tab === "expense"}
      type="button"
      role="tab"
      aria-selected={tab === "expense"}
      onclick={() => (tab = "expense")}
    >
      Despesas
      <span class="tab__count">{counts.expenseActive}/{counts.expense}</span>
    </button>
    <button
      class="tab"
      class:active={tab === "income"}
      type="button"
      role="tab"
      aria-selected={tab === "income"}
      onclick={() => (tab = "income")}
    >
      Receitas
      <span class="tab__count">{counts.incomeActive}/{counts.income}</span>
    </button>
  </div>

  <label class="checkbox">
    <input type="checkbox" bind:checked={showInactive} />
    <span>Mostrar inativas</span>
  </label>
</div>

{#if loading}
  <div class="card skeleton-card" aria-hidden="true">
    <span class="skeleton skeleton--title"></span>
    <span class="skeleton skeleton--row"></span>
    <span class="skeleton skeleton--row"></span>
    <span class="skeleton skeleton--row"></span>
  </div>
{:else if error}
  <div class="notice notice--error" role="alert">
    <Icon name="alert" />
    <div>
      <strong>Não foi possível carregar as categorias</strong>
      <p>{error}</p>
    </div>
    <button class="btn btn--soft" type="button" onclick={load}>Tentar novamente</button>
  </div>
{:else if visibleRows.length === 0}
  <div class="card">
    <EmptyState
      icon="tag"
      title={tab === "expense" ? "Nenhuma categoria de despesa" : "Nenhuma categoria de receita"}
      description="Crie categorias para enxergar padrões e comparar seus gastos."
    >
      {#snippet action()}
        <button class="btn btn--primary" type="button" onclick={openCreate}>Criar categoria</button>
      {/snippet}
    </EmptyState>
  </div>
{:else}
  <div class="card card--flush">
    <div class="cat-tree">
      {#each visibleRows as row (row.category.id)}
        <div
          class="cat-row"
          class:cat-row--inactive={!row.category.isActive}
          style:padding-left={`${12 + row.depth * 24}px`}
        >
          <span
            class="cat-dot"
            style:background={row.category.color ?? "var(--line-strong)"}
            aria-hidden="true"
          ></span>
          <span class="cat-name">
            {#if row.category.icon}<span class="cat-icon" aria-hidden="true">{row.category.icon}</span>{/if}
            {row.category.name}
          </span>
          {#if row.depth > 0}<span class="cat-depth">subcategoria</span>{/if}
          {#if !row.category.isActive}<span class="badge badge--inactive">inativa</span>{/if}

          <div class="cat-actions">
            <button
              class="btn btn--icon btn--ghost btn--sm"
              type="button"
              title="Editar"
              aria-label={`Editar ${row.category.name}`}
              onclick={() => openEdit(row.category)}
            >
              <Icon name="edit" size={16} />
            </button>
            <button
              class="btn btn--ghost btn--sm"
              type="button"
              disabled={toggling === row.category.id}
              onclick={() => toggleActive(row.category)}
            >
              {row.category.isActive ? "Desativar" : "Reativar"}
            </button>
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<CategoryFormModal
  open={modalOpen}
  category={editing}
  categories={flat}
  defaultType={tab}
  onclose={() => (modalOpen = false)}
  onsaved={() => void load()}
/>
