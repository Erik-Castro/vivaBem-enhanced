import { AppError } from "../../http/errors.ts";
import { uuidv7 } from "../../shared/utils/uuid.ts";
import type { CategoriesRepository, Category, CategoryType } from "./categories.repository.ts";

export interface CategoryNode extends Category {
  readonly children: CategoryNode[];
}

export interface CreateCategoryInput {
  readonly name: string;
  readonly type: CategoryType;
  readonly parentId?: string | null;
  readonly color?: string | null;
  readonly icon?: string | null;
}

export interface UpdateCategoryInput {
  readonly name?: string;
  readonly parentId?: string | null;
  readonly color?: string | null;
  readonly icon?: string | null;
  readonly isActive?: boolean;
}

export class CategoriesService {
  constructor(private readonly repository: CategoriesRepository) {}

  list(
    userId: string,
    filters: { readonly type?: CategoryType; readonly includeInactive?: boolean } = {},
  ): Category[] {
    return this.repository.list(userId, filters);
  }

  get(userId: string, categoryId: string): Category {
    const category = this.repository.findById(userId, categoryId);
    if (!category) {
      throw new AppError("NOT_FOUND", "Categoria não encontrada");
    }
    return category;
  }

  create(userId: string, input: CreateCategoryInput): Category {
    const name = input.name.trim();
    const parentId = input.parentId ?? null;
    const parent = parentId === null ? undefined : this.#requireParent(userId, parentId);

    if (parent !== undefined && parent.type !== input.type) {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{
          path: "parentId",
          message: "A subcategoria precisa ter o mesmo tipo do pai",
        }],
      });
    }

    this.#assertUniqueName(userId, parentId, name);

    const categoryId = uuidv7();
    const now = new Date().toISOString();

    this.repository.create({
      id: categoryId,
      userId,
      parentId,
      name,
      type: input.type,
      color: input.color ?? null,
      icon: input.icon ?? null,
      now,
    });

    return this.get(userId, categoryId);
  }

  update(userId: string, categoryId: string, input: UpdateCategoryInput): Category {
    const current = this.get(userId, categoryId);
    const name = input.name?.trim() ?? current.name;
    const parentId = input.parentId === undefined ? current.parentId : input.parentId;
    const isActive = input.isActive ?? current.isActive;

    if (parentId !== current.parentId) {
      if (parentId === categoryId) {
        throw new AppError("CONFLICT", "Uma categoria não pode ser pai de si mesma");
      }
      if (parentId !== null) {
        const parent = this.#requireParent(userId, parentId);
        if (parent.type !== current.type) {
          throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
            details: [{
              path: "parentId",
              message: "A subcategoria precisa ter o mesmo tipo do pai",
            }],
          });
        }
        this.#assertNotDescendant(userId, categoryId, parentId);
      }
    }

    if ((name !== current.name || parentId !== current.parentId) && isActive) {
      this.#assertUniqueName(userId, parentId, name, categoryId);
    }

    this.repository.update({
      id: categoryId,
      parentId,
      name,
      color: input.color === undefined ? current.color : input.color,
      icon: input.icon === undefined ? current.icon : input.icon,
      isActive,
      now: new Date().toISOString(),
    });

    return this.get(userId, categoryId);
  }

  delete(userId: string, categoryId: string): number {
    this.get(userId, categoryId);
    return this.repository.deactivateSubtree(userId, categoryId, new Date().toISOString());
  }

  tree(userId: string, includeInactive = false): CategoryNode[] {
    const categories = this.repository.list(userId, { includeInactive });
    const nodes = new Map<string, CategoryNode>(
      categories.map((category) => [category.id, { ...category, children: [] }]),
    );
    const roots: CategoryNode[] = [];

    for (const category of categories) {
      const node = nodes.get(category.id);
      if (!node) continue;

      const parent = category.parentId === null ? undefined : nodes.get(category.parentId);
      if (parent === undefined) {
        roots.push(node);
      } else {
        parent.children.push(node);
      }
    }

    return roots;
  }

  #requireParent(userId: string, parentId: string): Category {
    const parent = this.repository.findById(userId, parentId);
    if (!parent || !parent.isActive) {
      throw new AppError("VALIDATION_ERROR", "Dados inválidos", {
        details: [{ path: "parentId", message: "Categoria pai não encontrada ou inativa" }],
      });
    }
    return parent;
  }

  #assertNotDescendant(userId: string, categoryId: string, parentId: string): void {
    let cursor: Category | undefined = this.repository.findById(userId, parentId);
    let guard = 0;

    while (cursor !== undefined && guard < 100) {
      if (cursor.id === categoryId) {
        throw new AppError(
          "CONFLICT",
          "Não é possível mover uma categoria para dentro da própria subárvore",
        );
      }
      cursor = cursor.parentId === null
        ? undefined
        : this.repository.findById(userId, cursor.parentId);
      guard++;
    }
  }

  #assertUniqueName(
    userId: string,
    parentId: string | null,
    name: string,
    excludeId?: string,
  ): void {
    if (this.repository.findActiveByName(userId, parentId, name, excludeId) !== undefined) {
      throw new AppError("CONFLICT", "Já existe uma categoria ativa com esse nome neste nível");
    }
  }
}
