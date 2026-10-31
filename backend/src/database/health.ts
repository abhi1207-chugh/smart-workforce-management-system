import { getDatabase } from "./client.js";

export type ServiceStatus = "ok" | "degraded" | "down";

export interface HealthStatus {
  status: "ok" | "degraded";
  postgres: ServiceStatus;
  vector_db: ServiceStatus;
}

/** pgvector lives in PostgreSQL: ok = extension installed and face_embedding is queryable. */
async function checkVectorDb(): Promise<ServiceStatus> {
  try {
    const r = await getDatabase().query<{ ext: boolean; tbl: string | null }>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS ext,
              to_regclass('public.face_embedding')::text AS tbl`
    );
    if (!r.rows[0]?.ext || !r.rows[0]?.tbl) return "degraded";
    await getDatabase().query(`SELECT 1 FROM face_embedding LIMIT 1`);
    return "ok";
  } catch {
    return "down";
  }
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const postgresHealthy = await getDatabase().healthCheck();

  const vectorDbStatus = postgresHealthy ? await checkVectorDb() : "down";

  const postgres: ServiceStatus = postgresHealthy ? "ok" : "down";
  const overallStatus: "ok" | "degraded" =
    postgres === "ok" ? "ok" : "degraded";

  return {
    status: overallStatus,
    postgres,
    vector_db: vectorDbStatus,
  };
}
