<script lang="ts">
  import { api, errorMessage } from "../lib/api";
  import { descendantIds } from "../lib/labels";
  import { toasts } from "../lib/toast.svelte";
  import type { Category, CategoryType } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import Spinner from "./Spinner.svelte";

  let {
    open,
    category = null,
    categories,
    defaultType = "expense",
    onclose,
    onsaved,
  }: {
    open: boolean;
    category?: Category | null;
    categories: readonly Category[];
    defaultType?: "income" | "expense";
    onclose: () => void;
    onsaved: (category: Category) => void;
  } = $props();

  let name = $state("");
  let type = $state<CategoryType>("expense");
  let parentId = $state("");
  let useColor = $state(true);
  let color = $state("#b86420");
  let icon = $state("");
  let isActive = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);

  const editing = $derived(category !== null);
  const excludedParents = $derived(
    category ? descendantIds(categories, category.id) : new Set<string>(),
  );
  const parentOptions = $derived(
    categories.filter(
      (candidate) =>
        candidate.type === type &&
        candidate.isActive &&
        !excludedParents.has(candidate.id),
    ),
  );

  $effect(() => {
    if (!open) return;

    error = null;

    if (category) {
      name = category.name;
      type = category.type;
      parentId = category.parentId ?? "";
      useColor = category.color !== null;
      color = category.color ?? "#b86420";
      icon = category.icon ?? "";
      isActive = category.isActive;
      return;
    }

    name = "";
    type = defaultType;
    parentId = "";
    useColor = true;
    color = "#b86420";
    icon = "";
    isActive = true;
  });

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (saving) return;

    error = null;

    if (name.trim().length === 0) {
      error = "Dê um nome para a categoria.";
      return;
    }

    saving = true;

    try {
      if (category) {
        const result = await api<{ category: Category }>(`/categories/${category.id}`, {
          method: "PATCH",
          body: {
            name: name.trim(),
            parentId: parentId === "" ? null : parentId,
            color: useColor ? color : null,
            icon: icon.trim() === "" ? null : icon.trim(),
            isActive,
          },
        });

        toasts.success("Categoria atualizada");
        onsaved(result.category);
      } else {
        const result = await api<{ category: Category }>("/categories", {
          method: "POST",
          body: {
            name: name.trim(),
            type,
            parentId: parentId === "" ? null : parentId,
            color: useColor ? color : null,
            icon: icon.trim() === "" ? null : icon.trim(),
          },
        });

        toasts.success("Categoria criada");
        onsaved(result.category);
      }

      onclose();
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      saving = false;
    }
  }
</script>

<Modal {open} title={editing ? "Editar categoria" : "Nova categoria"} {onclose}>
  <form class="form" onsubmit={handleSubmit} novalidate>
    {#if error}
      <div class="form-error" role="alert">
        <Icon name="alert" size={18} />
        <span>{error}</span>
      </div>
    {/if}

    <label class="field">
      <span>Nome</span>
      <input
        class="input"
        type="text"
        placeholder="Ex.: Mercado"
        maxlength="120"
        required
        bind:value={name}
      />
    </label>

    <div class="form-grid form-grid--two">
      <label class="field">
        <span>Tipo</span>
        <select class="select" bind:value={type} disabled={editing}>
          <option value="expense">Despesa</option>
          <option value="income">Receita</option>
          {#if type === "transfer"}<option value="transfer">Transferência</option>{/if}
        </select>
        {#if editing}<small class="hint">O tipo não pode ser alterado.</small>{/if}
      </label>

      <label class="field">
        <span>Categoria pai</span>
        <select class="select" bind:value={parentId}>
          <option value="">Sem categoria pai</option>
          {#each parentOptions as option (option.id)}
            <option value={option.id}>{option.name}</option>
          {/each}
        </select>
      </label>
    </div>

    <div class="form-grid form-grid--two">
      <div class="field">
        <span>Cor</span>
        <div class="color-field">
          <input
            class="color-input"
            type="color"
            aria-label="Cor da categoria"
            bind:value={color}
            disabled={!useColor}
          />
          <label class="checkbox">
            <input type="checkbox" bind:checked={useColor} />
            <span>Usar cor</span>
          </label>
        </div>
      </div>

      <label class="field">
        <span>Ícone</span>
        <input
          class="input"
          type="text"
          placeholder="Ex.: 🏠 ou home"
          maxlength="64"
          bind:value={icon}
        />
      </label>
    </div>

    {#if editing}
      <label class="checkbox">
        <input type="checkbox" bind:checked={isActive} />
        <span>Categoria ativa</span>
      </label>
    {/if}

    <div class="form-actions">
      <button class="btn btn--ghost" type="button" onclick={onclose} disabled={saving}>Cancelar</button>
      <button class="btn btn--primary" type="submit" disabled={saving}>
        {#if saving}<Spinner label="Salvando" />{/if}
        {editing ? "Salvar alterações" : "Criar categoria"}
      </button>
    </div>
  </form>
</Modal>
