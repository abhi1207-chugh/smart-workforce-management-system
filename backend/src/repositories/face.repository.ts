import type { Queryable } from "../database/queryable.js";

export interface FaceRegistrationRow {
  registration_id: string;
  employee_id: string;
  model_name: string;
  model_version: string;
  registered_at: string;
}

/** pgvector text literal. Values are validated finite numbers; still passed as a bound parameter. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/** Locks the employee row so concurrent registrations for one employee serialize. */
export async function lockEmployee(
  db: Queryable,
  employeeId: string
): Promise<{ id: string; status: "ACTIVE" | "INACTIVE" } | null> {
  const r = await db.query(
    `SELECT id, status::text AS status FROM employee WHERE id = $1 FOR UPDATE`,
    [employeeId]
  );
  return r.rows[0] ?? null;
}

export async function findActiveRegistration(
  db: Queryable,
  employeeId: string
): Promise<FaceRegistrationRow | null> {
  const r = await db.query(
    `SELECT id AS registration_id, employee_id, model_name, model_version, registered_at
     FROM face_registration_metadata
     WHERE employee_id = $1 AND status = 'ACTIVE'`,
    [employeeId]
  );
  return r.rows[0] ?? null;
}

/** Moves the active registration to `newStatus` and deletes its embedding. Returns its id, if any. */
export async function retireActiveRegistration(
  db: Queryable,
  employeeId: string,
  newStatus: "SUPERSEDED" | "REVOKED"
): Promise<string | null> {
  const r = await db.query(
    `UPDATE face_registration_metadata
        SET status = $2::face_registration_status,
            revoked_at = CURRENT_TIMESTAMP
      WHERE employee_id = $1 AND status = 'ACTIVE'
      RETURNING id`,
    [employeeId, newStatus]
  );
  const id: string | undefined = r.rows[0]?.id;
  if (!id) return null;
  await db.query(`DELETE FROM face_embedding WHERE registration_id = $1`, [id]);
  return id;
}

/** Inserts the ACTIVE metadata row and its embedding; both ids are the same value. */
export async function insertRegistration(
  db: Queryable,
  params: {
    id: string;
    employeeId: string;
    modelName: string;
    modelVersion: string;
    embeddingVersion: string;
    registeredByUserId: string;
    embedding: number[];
  }
): Promise<{ registered_at: string }> {
  const meta = await db.query(
    `INSERT INTO face_registration_metadata
       (id, employee_id, vector_record_id, model_name, model_version,
        embedding_version, status, registered_at, registered_by_user_id)
     VALUES ($1::uuid, $2, ($1::uuid)::text, $3, $4, $5, 'ACTIVE', CURRENT_TIMESTAMP, $6)
     RETURNING registered_at`,
    [
      params.id,
      params.employeeId,
      params.modelName,
      params.modelVersion,
      params.embeddingVersion,
      params.registeredByUserId,
    ]
  );
  await db.query(
    `INSERT INTO face_embedding (id, registration_id, employee_id, embedding)
     VALUES ($1, $1, $2, $3::vector)`,
    [params.id, params.employeeId, toVectorLiteral(params.embedding)]
  );
  return meta.rows[0];
}

export interface FaceCandidate {
  employee_id: string;
  similarity: number;
}

/**
 * Cosine nearest neighbours among ACTIVE registrations of ACTIVE employees.
 * similarity = 1 - cosine distance. Read-only: recognition never writes.
 */
export async function searchNearest(
  db: Queryable,
  embedding: number[],
  limit: number
): Promise<FaceCandidate[]> {
  const r = await db.query(
    `SELECT fe.employee_id,
            1 - (fe.embedding <=> $1::vector) AS similarity
       FROM face_embedding fe
       JOIN face_registration_metadata m ON m.id = fe.registration_id AND m.status = 'ACTIVE'
       JOIN employee e ON e.id = fe.employee_id AND e.status = 'ACTIVE'
      ORDER BY fe.embedding <=> $1::vector
      LIMIT $2`,
    [toVectorLiteral(embedding), limit]
  );
  return r.rows.map((row) => ({
    employee_id: row.employee_id as string,
    similarity: Number(row.similarity),
  }));
}

export async function insertFaceAudit(
  db: Queryable,
  actorUserId: string | null,
  action: string,
  registrationId: string,
  metadata: object
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, 'face_registration', $3, $4::jsonb)`,
    [actorUserId, action, registrationId, JSON.stringify(metadata)]
  );
}
