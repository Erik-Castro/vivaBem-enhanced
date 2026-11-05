import type { AppDatabase } from "../../db/client.ts";

export const CATEGORY_TYPES = ["income", "expense", "transfer"] as const;

export type CategoryType = (typeof CATEGORY_TYPES)[number];

export interface Category {
  readonly id: string;
  readonly userId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly type: CategoryType;
  readonly color: string | null;
  readonly icon: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface CategoryRow {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  type: CategoryType;
  color: string | null;
  icon: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCategoryRecord {
  readonly id: string;
  readonly userId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly type: CategoryType;
  readonly color: string | null;
  readonly icon: string | null;
  readonly now: string;
}

export interface UpdateCategoryRecord {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly color: string | null;
  readonly icon: string | null;
  readonly isActive: boolean;
  readonly now: string;
}

export interface CategoryFilters {
  readonly type?: CategoryType;
  readonly includeInactive?: boolean;
}

/** Acesso às categorias, sempre escopado por usuário. */
export class CategoriesRepository {
  constructor(private readonly db: AppDatabase) {}

  list(userId: string, filters: CategoryFilters = {}): Category[] {
    const params: unknown[] = [userId];
    let sql = "SELECT * FROM categories WHERE user_id = ?";

    if (!filters.includeInactive) sql += " AND is_active = 1";
    if (filters.type !== undefined) {
      sql += " AND type = ?";
      params.push(filters.type);
    }

    sql += " ORDER BY name COLLATE NOCASE ASC";

    return this.db
      .prepare<unknown[], CategoryRow>(sql)
      .all(...params)
      .map(mapCategory);
  }

  findById(userId: string, categoryId: string): Category | undefined {
    const row = this.db
      .prepare<[string, string], CategoryRow>(
        "SELECT * FROM categories WHERE id = ? AND user_id = ?",
      )
      .get(categoryId, userId);
    return row ? mapCategory(row) : undefined;
  }

  findActiveByName(
    userId: string,
    parentId: string | null,
    name: string,
    excludeId?: string,
  ): string | undefined {
    const params: unknown[] = [userId, parentId ?? "", name];
    let sql = `SELECT id FROM categories
      WHERE user_id = ? AND IFNULL(parent_id, '') = ? AND name = ? AND is_active = 1`;

    if (excludeId !== undefined) {
      sql += " AND id <> ?";
      params.push(excludeId);
    }

    const row = this.db
      .prepare<unknown[], { id: string }>(`${sql} LIMIT 1`)
      .get(...params);
    return row?.id;
  }

  create(record: CreateCategoryRecord): void {
    this.db
      .prepare<
        [
          string,
          string,
          string | null,
          string,
          string,
          string | null,
          string | null,
          string,
          string,
        ]
      >(
        `INSERT INTO categories
           (id, user_id, parent_id, name, type, color, icon, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.userId,
        record.parentId,
        record.name,
        record.type,
        record.color,
        record.icon,
        record.now,
        record.now,
      );
  }

  update(record: UpdateCategoryRecord): void {
    this.db
      .prepare<[string | null, string, string | null, string | null, number, string, string]>(
        `UPDATE categories
         SET parent_id = ?, name = ?, color = ?, icon = ?, is_active = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        record.parentId,
        record.name,
        record.color,
        record.icon,
        record.isActive ? 1 : 0,
        record.now,
        record.id,
      );
  }

  /** Desativa a categoria e toda a subárvore. Retorna quantas foram afetadas. */
  deactivateSubtree(userId: string, categoryId: string, now: string): number {
    const result = this.db
      .prepare<[string, string, string]>(
        `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM categories WHERE id = ? AND user_id = ?
           UNION ALL
           SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
         )
         UPDATE categories
         SET is_active = 0, updated_at = ?
         WHERE id IN (SELECT id FROM subtree) AND is_active = 1`,
      )
      .run(categoryId, userId, now);
    return result.changes;
  }
}

function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    userId: row.user_id,
    parentId: row.parent_id,
    name: row.name,
    type: row.type,
    color: row.color,
    icon: row.icon,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
