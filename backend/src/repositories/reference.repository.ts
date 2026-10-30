import { getDatabase } from "../database/client.js";
import type { DepartmentDto, ShiftDto } from "../types/api.js";

export async function listDepartments(): Promise<DepartmentDto[]> {
  const result = await getDatabase().query<DepartmentDto>(
    `SELECT id, code, name, status::text AS status FROM department ORDER BY code`
  );
  return result.rows;
}

export async function listShifts(): Promise<ShiftDto[]> {
  const result = await getDatabase().query<ShiftDto>(
    `
      SELECT
        s.id,
        s.name,
        to_char(s.start_time, 'HH24:MI') AS start_time,
        to_char(s.end_time, 'HH24:MI') AS end_time,
        s.scheduled_duration_minutes,
        s.grace_period_minutes,
        s.status::text AS status,
        COALESCE(
          array_agg(
            (ARRAY['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'])[w.day_of_week + 1]
            ORDER BY w.day_of_week
          ) FILTER (WHERE w.day_of_week IS NOT NULL),
          '{}'
        ) AS weekly_off_days
      FROM shift s
      LEFT JOIN shift_weekly_off w ON w.shift_id = s.id
      GROUP BY s.id
      ORDER BY s.name
    `
  );
  return result.rows;
}
