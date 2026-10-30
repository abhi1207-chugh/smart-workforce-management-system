import { getDatabase } from "./client.js";

export type ServiceStatus = "ok" | "degraded" | "down";

export interface HealthStatus {
  status: "ok" | "degraded";
  postgres: ServiceStatus;
  vector_db: ServiceStatus;
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const postgresHealthy = await getDatabase().healthCheck();

  // Vector DB is not integrated in Phase 2.3 Step 1.
  const vectorDbStatus: ServiceStatus = "degraded";

  const postgres: ServiceStatus = postgresHealthy ? "ok" : "down";
  const overallStatus: "ok" | "degraded" =
    postgres === "ok" ? "ok" : "degraded";

  return {
    status: overallStatus,
    postgres,
    vector_db: vectorDbStatus,
  };
}
