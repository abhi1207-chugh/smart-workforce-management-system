import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

/**
 * PostgreSQL access layer.
 *
 * All queries use parameterized placeholders ($1, $2, ...) to prevent SQL injection.
 * User-provided values must never be interpolated into SQL strings.
 */
export class Database {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  async query<T extends QueryResultRow>(
    text: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.query("SELECT 1 AS ok");
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

let databaseInstance: Database | null = null;

export function initDatabase(connectionString: string): Database {
  databaseInstance = new Database(connectionString);
  return databaseInstance;
}

export function getDatabase(): Database {
  if (!databaseInstance) {
    throw new Error("Database has not been initialized");
  }
  return databaseInstance;
}

export function resetDatabase(): void {
  databaseInstance = null;
}
