-- Phase 2.2 Step 2 constraint verification (run in a transaction; rolls back test data)

BEGIN;

-- ---------------------------------------------------------------------------
-- Schema metadata checks
-- ---------------------------------------------------------------------------

SELECT 'TABLE_COUNT' AS check_type, COUNT(*)::text AS result
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name <> 'schema_migrations';

SELECT 'ENUM_COUNT' AS check_type, COUNT(*)::text AS result
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typtype = 'e';

-- ---------------------------------------------------------------------------
-- TEST A: duplicate employee_code must fail
-- ---------------------------------------------------------------------------

INSERT INTO department (code, name, status) VALUES ('D1', 'Dept 1', 'ACTIVE');
INSERT INTO shift (name, start_time, end_time, scheduled_duration_minutes, status)
VALUES ('Morning', '09:00', '18:00', 540, 'ACTIVE');

INSERT INTO employee (
    employee_code, first_name, last_name, email, department_id, shift_id,
    monthly_base_salary, status
) VALUES (
    'EMP001', 'Test', 'One', 'emp001@test.local',
    (SELECT id FROM department WHERE code = 'D1'),
    (SELECT id FROM shift WHERE name = 'Morning'),
    50000, 'ACTIVE'
);

DO $$
BEGIN
    INSERT INTO employee (
        employee_code, first_name, last_name, email, department_id, shift_id,
        monthly_base_salary, status
    ) VALUES (
        'EMP001', 'Dup', 'Code', 'dup@test.local',
        (SELECT id FROM department WHERE code = 'D1'),
        (SELECT id FROM shift WHERE name = 'Morning'),
        50000, 'ACTIVE'
    );
    RAISE EXCEPTION 'TEST A FAILED: duplicate employee_code was allowed';
EXCEPTION
    WHEN unique_violation THEN
        RAISE NOTICE 'TEST A PASSED: duplicate employee_code rejected';
END $$;

-- ---------------------------------------------------------------------------
-- TEST B: two users for same employee must fail
-- ---------------------------------------------------------------------------

INSERT INTO "user" (email, password_hash, role, employee_id, status)
VALUES (
    'empuser1@test.local', 'hash', 'EMPLOYEE',
    (SELECT id FROM employee WHERE employee_code = 'EMP001'),
    'ACTIVE'
);

DO $$
DECLARE
    v_employee_id UUID;
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP001';
    INSERT INTO "user" (email, password_hash, role, employee_id, status)
    VALUES ('empuser2@test.local', 'hash', 'EMPLOYEE', v_employee_id, 'ACTIVE');
    RAISE EXCEPTION 'TEST B FAILED: second user for same employee was allowed';
EXCEPTION
    WHEN unique_violation THEN
        RAISE NOTICE 'TEST B PASSED: second user for same employee rejected';
END $$;

-- ---------------------------------------------------------------------------
-- TEST C: multiple face registrations with historical statuses must succeed
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_employee_id UUID;
    v_user_id UUID;
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP001';
    SELECT id INTO v_user_id FROM "user" WHERE email = 'empuser1@test.local';

    INSERT INTO face_registration_metadata (
        employee_id, vector_record_id, model_name, model_version, embedding_version,
        status, registered_at, registered_by_user_id
    ) VALUES
        (v_employee_id, 'vec-1', 'model-a', '1.0', '1.0', 'SUPERSEDED', NOW(), v_user_id),
        (v_employee_id, 'vec-2', 'model-a', '1.0', '1.0', 'REVOKED', NOW(), v_user_id),
        (v_employee_id, 'vec-3', 'model-a', '1.0', '1.0', 'ACTIVE', NOW(), v_user_id);

    RAISE NOTICE 'TEST C PASSED: multiple historical face registrations allowed';
END $$;

-- ---------------------------------------------------------------------------
-- TEST D: two ACTIVE face registrations must fail
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_employee_id UUID;
    v_user_id UUID;
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP001';
    SELECT id INTO v_user_id FROM "user" WHERE email = 'empuser1@test.local';

    INSERT INTO face_registration_metadata (
        employee_id, vector_record_id, model_name, model_version, embedding_version,
        status, registered_at, registered_by_user_id
    ) VALUES (
        v_employee_id, 'vec-4', 'model-a', '1.0', '1.0', 'ACTIVE', NOW(), v_user_id
    );
    RAISE EXCEPTION 'TEST D FAILED: second ACTIVE face registration was allowed';
EXCEPTION
    WHEN unique_violation THEN
        RAISE NOTICE 'TEST D PASSED: second ACTIVE face registration rejected';
END $$;

-- ---------------------------------------------------------------------------
-- TEST E: two OPEN attendance sessions must fail
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_employee_id UUID;
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP001';

    INSERT INTO attendance_session (
        employee_id, check_in_at, status, check_in_source, work_date
    ) VALUES (
        v_employee_id, NOW(), 'OPEN', 'FACE_RECOGNITION', CURRENT_DATE
    );

    INSERT INTO attendance_session (
        employee_id, check_in_at, status, check_in_source, work_date
    ) VALUES (
        v_employee_id, NOW(), 'OPEN', 'FACE_RECOGNITION', CURRENT_DATE
    );

    RAISE EXCEPTION 'TEST E FAILED: second OPEN attendance session was allowed';
EXCEPTION
    WHEN unique_violation THEN
        RAISE NOTICE 'TEST E PASSED: second OPEN attendance session rejected';
END $$;

-- ---------------------------------------------------------------------------
-- TEST F: duplicate employee_day_attendance must fail
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_employee_id UUID;
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP001';

    INSERT INTO employee_day_attendance (
        employee_id, work_date, classification, is_scheduled_working_day, payable_day_fraction
    ) VALUES (
        v_employee_id, CURRENT_DATE, 'FULL_DAY', TRUE, 1.0
    );

    INSERT INTO employee_day_attendance (
        employee_id, work_date, classification, is_scheduled_working_day, payable_day_fraction
    ) VALUES (
        v_employee_id, CURRENT_DATE, 'HALF_DAY', TRUE, 0.5
    );

    RAISE EXCEPTION 'TEST F FAILED: duplicate employee_day_attendance was allowed';
EXCEPTION
    WHEN unique_violation THEN
        RAISE NOTICE 'TEST F PASSED: duplicate employee_day_attendance rejected';
END $$;

-- ---------------------------------------------------------------------------
-- TEST G: duplicate payroll_record must fail
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_employee_id UUID;
    v_user_id UUID;
    v_policy_id UUID;
    v_ot_config_id UUID;
    v_run_id UUID;
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP001';
    SELECT id INTO v_user_id FROM "user" WHERE email = 'empuser1@test.local';

    INSERT INTO payroll_policy (name, working_days_method, status)
    VALUES ('Default', 'FIXED_DIVISOR', 'ACTIVE')
    RETURNING id INTO v_policy_id;

    INSERT INTO overtime_rate_config (name, multiplier, status)
    VALUES ('Default OT', 1.5, 'ACTIVE')
    RETURNING id INTO v_ot_config_id;

    INSERT INTO payroll_run (
        period_start, period_end, status, payroll_policy_id,
        overtime_rate_config_id, initiated_by_user_id
    ) VALUES (
        '2026-01-01', '2026-01-31', 'DRAFT', v_policy_id, v_ot_config_id, v_user_id
    ) RETURNING id INTO v_run_id;

    INSERT INTO payroll_record (
        payroll_run_id, employee_id, monthly_base_salary, working_days_in_policy,
        one_day_salary, attendance_adjusted_pay, gross_pay, net_pay, status
    ) VALUES (
        v_run_id, v_employee_id, 50000, 26, 1923.08, 1923.08, 1923.08, 1923.08, 'DRAFT'
    );

    INSERT INTO payroll_record (
        payroll_run_id, employee_id, monthly_base_salary, working_days_in_policy,
        one_day_salary, attendance_adjusted_pay, gross_pay, net_pay, status
    ) VALUES (
        v_run_id, v_employee_id, 50000, 26, 1923.08, 1923.08, 1923.08, 1923.08, 'DRAFT'
    );

    RAISE EXCEPTION 'TEST G FAILED: duplicate payroll_record was allowed';
EXCEPTION
    WHEN unique_violation THEN
        RAISE NOTICE 'TEST G PASSED: duplicate payroll_record rejected';
END $$;

-- ---------------------------------------------------------------------------
-- TEST H: invalid checkout before check-in must fail
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_employee_id UUID;
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP001';

    INSERT INTO attendance_session (
        employee_id, check_in_at, check_out_at, status,
        check_in_source, check_out_source, work_date
    ) VALUES (
        v_employee_id,
        TIMESTAMPTZ '2026-01-15 18:00:00+00',
        TIMESTAMPTZ '2026-01-15 09:00:00+00',
        'COMPLETED',
        'MANUAL', 'MANUAL',
        DATE '2026-01-15'
    );

    RAISE EXCEPTION 'TEST H FAILED: checkout before check-in was allowed';
EXCEPTION
    WHEN check_violation THEN
        RAISE NOTICE 'TEST H PASSED: checkout before check-in rejected';
END $$;

ROLLBACK;
