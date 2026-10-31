import { randomUUID } from "node:crypto";
import { getDatabase } from "../database/client.js";
import { conflict, notFound } from "../errors/app-error.js";
import {
  findActiveRegistration,
  insertFaceAudit,
  insertRegistration,
  lockEmployee,
  retireActiveRegistration,
} from "../repositories/face.repository.js";
import type { RegisterFaceInput } from "../validation/face.validation.js";

/** Pipeline identifiers stored with every registration (recognition must use the same model). */
export const FACE_MODEL_NAME = "face-api.js";
export const FACE_EMBEDDING_VERSION = "1";

export interface FaceStatusDto {
  employee_id: string;
  is_registered: boolean;
  registered_at: string | null;
  model_name: string | null;
  model_version: string | null;
}

export interface FaceRegisteredDto {
  employee_id: string;
  registered_at: string;
  model_version: string;
  replaced: boolean;
}

export async function registerFace(
  employeeId: string,
  input: RegisterFaceInput,
  actorUserId: string
): Promise<FaceRegisteredDto> {
  return getDatabase().withTransaction(async (db) => {
    const employee = await lockEmployee(db, employeeId);
    if (!employee) throw notFound("Employee not found");
    if (employee.status !== "ACTIVE") {
      throw conflict("Face can only be registered for an ACTIVE employee");
    }

    const replacedId = await retireActiveRegistration(db, employeeId, "SUPERSEDED");
    const id = randomUUID();
    const { registered_at } = await insertRegistration(db, {
      id,
      employeeId,
      modelName: FACE_MODEL_NAME,
      modelVersion: input.model_version,
      embeddingVersion: FACE_EMBEDDING_VERSION,
      registeredByUserId: actorUserId,
      embedding: input.embedding,
    });
    await insertFaceAudit(
      db,
      actorUserId,
      replacedId ? "FACE_REREGISTERED" : "FACE_REGISTERED",
      id,
      {
        employee_id: employeeId,
        model_name: FACE_MODEL_NAME,
        model_version: input.model_version,
        replaced_registration_id: replacedId,
      }
    );
    return {
      employee_id: employeeId,
      registered_at,
      model_version: input.model_version,
      replaced: replacedId !== null,
    };
  });
}

export async function revokeFace(
  employeeId: string,
  actorUserId: string
): Promise<FaceStatusDto> {
  return getDatabase().withTransaction(async (db) => {
    const employee = await lockEmployee(db, employeeId);
    if (!employee) throw notFound("Employee not found");
    const revokedId = await retireActiveRegistration(db, employeeId, "REVOKED");
    if (!revokedId) throw notFound("Employee has no active face registration");
    await insertFaceAudit(db, actorUserId, "FACE_REVOKED", revokedId, {
      employee_id: employeeId,
    });
    return {
      employee_id: employeeId,
      is_registered: false,
      registered_at: null,
      model_name: null,
      model_version: null,
    };
  });
}

export async function getFaceStatus(employeeId: string): Promise<FaceStatusDto> {
  const db = getDatabase();
  const employee = await db.query(`SELECT 1 FROM employee WHERE id = $1`, [employeeId]);
  if (employee.rowCount === 0) throw notFound("Employee not found");
  const active = await findActiveRegistration(db, employeeId);
  return {
    employee_id: employeeId,
    is_registered: active !== null,
    registered_at: active ? new Date(active.registered_at).toISOString() : null,
    model_name: active?.model_name ?? null,
    model_version: active?.model_version ?? null,
  };
}
