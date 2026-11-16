-- Stage 5: shared face-scan kiosk account.
--   * Adds the KIOSK value to user_role. A KIOSK user has no employee_id and may only call
--     POST /face/recognize and the face-verified attendance punch endpoints (enforced in the API).
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so this migration opts out.

-- migrate:up transaction:false

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'KIOSK';

-- migrate:down transaction:false

-- PostgreSQL cannot drop an enum value. The KIOSK value is intentionally left in place;
-- remove kiosk accounts with: DELETE FROM "user" WHERE role = 'KIOSK';
SELECT 1;
