/** Satisfied by both the pool wrapper (`Database`) and a transaction client. */
export interface Queryable {
  query(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: any[]; rowCount: number | null }>;
}

/**
 * Builds a parameterized WHERE clause. `add("col = ?", value)` appends a
 * condition only when `value` is defined; values are never interpolated.
 */
export class Where {
  readonly params: unknown[] = [];
  private readonly clauses: string[] = [];

  add(condition: string, value: unknown): this {
    if (value === undefined) return this;
    this.params.push(value);
    this.clauses.push(condition.replace("?", `$${this.params.length}`));
    return this;
  }

  /** Adds a fixed condition that takes no parameter. */
  raw(condition: string): this {
    this.clauses.push(condition);
    return this;
  }

  get sql(): string {
    return this.clauses.length ? `WHERE ${this.clauses.join(" AND ")}` : "";
  }

  /** Appends LIMIT/OFFSET placeholders; returns the SQL fragment. */
  page(limit: number, offset: number): string {
    this.params.push(limit, offset);
    return `LIMIT $${this.params.length - 1} OFFSET $${this.params.length}`;
  }
}
