-- Phase 2.2 Step 3 — Advanced DBMS feature verification (rolled back; no persistent test data)

BEGIN;

-- ---------------------------------------------------------------------------
-- Catalog checks
-- ---------------------------------------------------------------------------

SELECT 'FUNCTION_COUNT' AS check_type,
       COUNT(*)::text AS result
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND p.proname IN (
      'set_updated_at',
      'compute_working_duration_minutes',
      'compute_session_working_duration',
      'classify_day_from_minutes',
      'is_scheduled_working_day',
      'derive_shift_timing_flags',
      'derive_overtime_minutes',
      'check_leave_balance',
      'compute_one_day_salary',
      'complete_attendance_checkout',
      'approve_leave_request',
      'compute_attendance_adjusted_pay',
      'compute_approved_overtime_pay',
      'compute_employee_payroll_record',
      'finalize_payroll_run',
      'prevent_finalized_payroll_record_mutation',
      'validate_payment_on_finalized_payroll',
      'validate_active_employee_checkin',
      'audit_attendance_correction',
      'prevent_audit_log_mutation'
  );

SELECT 'VIEW_COUNT' AS check_type, COUNT(*)::text AS result
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name IN (
      'v_open_attendance_sessions',
      'v_employee_attendance_summary',
      'v_daily_attendance_report',
      'v_leave_balance_report',
      'v_overtime_summary',
      'v_payroll_register'
  );

SELECT 'INDEX_COUNT' AS check_type, COUNT(*)::text AS result
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
      'leave_request_employee_date_range_idx',
      'bonus_employee_period_unlinked_idx',
      'deduction_employee_period_unlinked_idx',
      'payroll_run_period_idx',
      'overtime_record_payroll_lookup_idx'
  );

-- ---------------------------------------------------------------------------
-- Seed minimal reference data
-- ---------------------------------------------------------------------------

INSERT INTO department (code, name, status) VALUES ('D3', 'Dept 3', 'ACTIVE');
INSERT INTO shift (name, start_time, end_time, scheduled_duration_minutes, status)
VALUES ('Morning', '09:00', '18:00', 540, 'ACTIVE');

INSERT INTO employee (
    employee_code, first_name, last_name, email, department_id, shift_id,
    monthly_base_salary, status
) VALUES (
    'EMP003', 'Step', 'Three', 'emp003@test.local',
    (SELECT id FROM department WHERE code = 'D3'),
    (SELECT id FROM shift WHERE name = 'Morning'),
    52000, 'ACTIVE'
);

INSERT INTO "user" (email, password_hash, role, employee_id, status)
VALUES ('admin3@test.local', 'hash', 'ADMIN', NULL, 'ACTIVE');

INSERT INTO payroll_policy (name, working_days_method, fixed_divisor, status)
VALUES ('Standard 26', 'FIXED_DIVISOR', 26, 'ACTIVE');

INSERT INTO payroll_policy (name, working_days_method, status)
VALUES ('Calendar TBD', 'CALENDAR_WORKING_DAYS', 'ACTIVE');

INSERT INTO overtime_rate_config (name, multiplier, status)
VALUES ('OT 1.5x', 1.5, 'ACTIVE');

INSERT INTO leave_type (code, name, annual_entitlement_days, is_paid, status)
VALUES ('AL', 'Annual Leave', 12, TRUE, 'ACTIVE');

INSERT INTO leave_balance (employee_id, leave_type_id, balance_days)
VALUES (
    (SELECT id FROM employee WHERE employee_code = 'EMP003'),
    (SELECT id FROM leave_type WHERE code = 'AL'),
    5.0
);

-- ---------------------------------------------------------------------------
-- TEST S3-01: compute_working_duration_minutes
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_minutes INTEGER;
BEGIN
    v_minutes := compute_working_duration_minutes(
        TIMESTAMPTZ '2026-02-01 09:00:00+00',
        TIMESTAMPTZ '2026-02-01 18:00:00+00'
    );
    IF v_minutes <> 540 THEN
        RAISE EXCEPTION 'TEST S3-01 FAILED: expected 540 minutes, got %', v_minutes;
    END IF;
    RAISE NOTICE 'TEST S3-01 PASSED: compute_working_duration_minutes';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-02: classify_day_from_minutes (BR-ATT-13/15)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_class day_classification;
    v_fraction NUMERIC(3, 2);
BEGIN
    SELECT classification, payable_day_fraction
    INTO v_class, v_fraction
    FROM classify_day_from_minutes(180);

    IF v_class <> 'HALF_DAY' OR v_fraction <> 0.5 THEN
        RAISE EXCEPTION 'TEST S3-02 FAILED: 180 min should be HALF_DAY/0.5';
    END IF;

    SELECT classification, payable_day_fraction
    INTO v_class, v_fraction
    FROM classify_day_from_minutes(240);

    IF v_class <> 'FULL_DAY' OR v_fraction <> 1.0 THEN
        RAISE EXCEPTION 'TEST S3-02 FAILED: 240 min should be FULL_DAY/1.0';
    END IF;

    RAISE NOTICE 'TEST S3-02 PASSED: classify_day_from_minutes';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-03: is_scheduled_working_day (weekly off)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_employee_id UUID;
    v_shift_id UUID;
    v_is_working BOOLEAN;
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP003';
    SELECT shift_id INTO v_shift_id FROM employee WHERE id = v_employee_id;

    INSERT INTO shift_weekly_off (shift_id, day_of_week)
    VALUES (v_shift_id, EXTRACT(DOW FROM DATE '2026-02-01')::SMALLINT);

    v_is_working := is_scheduled_working_day(v_employee_id, DATE '2026-02-01');
    IF v_is_working THEN
        RAISE EXCEPTION 'TEST S3-03 FAILED: weekly-off day should return FALSE';
    END IF;

    v_is_working := is_scheduled_working_day(v_employee_id, DATE '2026-02-02');
    IF NOT v_is_working THEN
        RAISE EXCEPTION 'TEST S3-03 FAILED: non-off day should return TRUE';
    END IF;

    RAISE NOTICE 'TEST S3-03 PASSED: is_scheduled_working_day';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-04: compute_one_day_salary (FIXED_DIVISOR)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_one_day NUMERIC(12, 2);
    v_policy_id UUID;
BEGIN
    SELECT id INTO v_policy_id FROM payroll_policy WHERE name = 'Standard 26';
    v_one_day := compute_one_day_salary(52000, v_policy_id);
    IF v_one_day <> 2000.00 THEN
        RAISE EXCEPTION 'TEST S3-04 FAILED: expected 2000.00, got %', v_one_day;
    END IF;
    RAISE NOTICE 'TEST S3-04 PASSED: compute_one_day_salary FIXED_DIVISOR';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-05: compute_one_day_salary CALENDAR_WORKING_DAYS not implemented
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_policy_id UUID;
BEGIN
    SELECT id INTO v_policy_id FROM payroll_policy WHERE name = 'Calendar TBD';
    PERFORM compute_one_day_salary(52000, v_policy_id);
    RAISE EXCEPTION 'TEST S3-05 FAILED: CALENDAR_WORKING_DAYS should raise exception';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%CALENDAR_WORKING_DAYS%' THEN
            RAISE;
        END IF;
        RAISE NOTICE 'TEST S3-05 PASSED: CALENDAR_WORKING_DAYS rejected';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-06: complete_attendance_checkout — valid FULL_DAY
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_employee_id UUID;
    v_session_id UUID;
    v_day employee_day_attendance;
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP003';

    INSERT INTO attendance_session (
        employee_id, check_in_at, status, check_in_source, work_date
    ) VALUES (
        v_employee_id,
        TIMESTAMPTZ '2026-02-02 09:00:00+00',
        'OPEN',
        'FACE_RECOGNITION',
        DATE '2026-02-02'
    ) RETURNING id INTO v_session_id;

    v_day := complete_attendance_checkout(
        v_session_id,
        TIMESTAMPTZ '2026-02-02 18:00:00+00'
    );

    IF v_day.classification <> 'FULL_DAY'
       OR v_day.payable_day_fraction <> 1.0
       OR v_day.total_working_minutes <> 540 THEN
        RAISE EXCEPTION 'TEST S3-06 FAILED: expected FULL_DAY 540 min';
    END IF;

    RAISE NOTICE 'TEST S3-06 PASSED: complete_attendance_checkout FULL_DAY';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-07: complete_attendance_checkout — invalid non-OPEN session
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_employee_id UUID;
    v_session_id UUID;
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP003';

    INSERT INTO attendance_session (
        employee_id, check_in_at, check_out_at, working_duration_minutes,
        status, check_in_source, check_out_source, work_date
    ) VALUES (
        v_employee_id,
        TIMESTAMPTZ '2026-02-03 09:00:00+00',
        TIMESTAMPTZ '2026-02-03 18:00:00+00',
        540,
        'COMPLETED',
        'MANUAL', 'MANUAL',
        DATE '2026-02-03'
    ) RETURNING id INTO v_session_id;

    PERFORM complete_attendance_checkout(v_session_id, TIMESTAMPTZ '2026-02-03 19:00:00+00');
    RAISE EXCEPTION 'TEST S3-07 FAILED: checkout on COMPLETED session should fail';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%not OPEN%' THEN
            RAISE;
        END IF;
        RAISE NOTICE 'TEST S3-07 PASSED: non-OPEN checkout rejected';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-08: complete_attendance_checkout — checkout before check-in
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_employee_id UUID;
    v_session_id UUID;
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP003';

    INSERT INTO attendance_session (
        employee_id, check_in_at, status, check_in_source, work_date
    ) VALUES (
        v_employee_id,
        TIMESTAMPTZ '2026-02-04 12:00:00+00',
        'OPEN',
        'MANUAL',
        DATE '2026-02-04'
    ) RETURNING id INTO v_session_id;

    PERFORM complete_attendance_checkout(
        v_session_id,
        TIMESTAMPTZ '2026-02-04 09:00:00+00'
    );
    RAISE EXCEPTION 'TEST S3-08 FAILED: checkout before check-in should fail';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%Check-out before check-in%' THEN
            RAISE;
        END IF;
        RAISE NOTICE 'TEST S3-08 PASSED: checkout before check-in rejected';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-09: approve_leave_request — valid
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_employee_id UUID;
    v_leave_type_id UUID;
    v_admin_id UUID;
    v_request_id UUID;
    v_balance NUMERIC(5, 2);
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP003';
    SELECT id INTO v_leave_type_id FROM leave_type WHERE code = 'AL';
    SELECT id INTO v_admin_id FROM "user" WHERE email = 'admin3@test.local';

    INSERT INTO leave_request (
        employee_id, leave_type_id, start_date, end_date,
        reason, status, requested_at
    ) VALUES (
        v_employee_id, v_leave_type_id,
        DATE '2026-02-10', DATE '2026-02-11',
        'Vacation', 'PENDING', NOW()
    ) RETURNING id INTO v_request_id;

    PERFORM approve_leave_request(v_request_id, v_admin_id);

    SELECT balance_days INTO v_balance
    FROM leave_balance
    WHERE employee_id = v_employee_id AND leave_type_id = v_leave_type_id;

    IF v_balance <> 3.0 THEN
        RAISE EXCEPTION 'TEST S3-09 FAILED: balance should be 3.0, got %', v_balance;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM employee_day_attendance
        WHERE employee_id = v_employee_id
          AND work_date = DATE '2026-02-10'
          AND classification = 'LEAVE'
    ) THEN
        RAISE EXCEPTION 'TEST S3-09 FAILED: LEAVE day not recorded';
    END IF;

    RAISE NOTICE 'TEST S3-09 PASSED: approve_leave_request';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-10: approve_leave_request — insufficient balance
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_employee_id UUID;
    v_leave_type_id UUID;
    v_admin_id UUID;
    v_request_id UUID;
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP003';
    SELECT id INTO v_leave_type_id FROM leave_type WHERE code = 'AL';
    SELECT id INTO v_admin_id FROM "user" WHERE email = 'admin3@test.local';

    INSERT INTO leave_request (
        employee_id, leave_type_id, start_date, end_date,
        reason, status, requested_at
    ) VALUES (
        v_employee_id, v_leave_type_id,
        DATE '2026-03-01', DATE '2026-03-10',
        'Too long', 'PENDING', NOW()
    ) RETURNING id INTO v_request_id;

    PERFORM approve_leave_request(v_request_id, v_admin_id);
    RAISE EXCEPTION 'TEST S3-10 FAILED: insufficient balance should be rejected';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%Insufficient leave balance%' THEN
            RAISE;
        END IF;
        RAISE NOTICE 'TEST S3-10 PASSED: insufficient leave balance rejected';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-11: payroll calculation and finalize_payroll_run
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_employee_id UUID;
    v_admin_id UUID;
    v_policy_id UUID;
    v_ot_id UUID;
    v_run_id UUID;
    v_record payroll_record;
    v_run payroll_run;
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP003';
    SELECT id INTO v_admin_id FROM "user" WHERE email = 'admin3@test.local';
    SELECT id INTO v_policy_id FROM payroll_policy WHERE name = 'Standard 26';
    SELECT id INTO v_ot_id FROM overtime_rate_config WHERE name = 'OT 1.5x';

    INSERT INTO payroll_run (
        period_start, period_end, status,
        payroll_policy_id, overtime_rate_config_id, initiated_by_user_id
    ) VALUES (
        DATE '2026-02-01', DATE '2026-02-28', 'DRAFT',
        v_policy_id, v_ot_id, v_admin_id
    ) RETURNING id INTO v_run_id;

    INSERT INTO bonus (
        employee_id, period_start, period_end, amount, reason, created_by_user_id
    ) VALUES (
        v_employee_id, DATE '2026-02-01', DATE '2026-02-28',
        500.00, 'Performance', v_admin_id
    );

    INSERT INTO deduction (
        employee_id, period_start, period_end, deduction_type,
        amount, reason, created_by_user_id
    ) VALUES (
        v_employee_id, DATE '2026-02-01', DATE '2026-02-28',
        'TAX', 200.00, 'Withholding', v_admin_id
    );

    INSERT INTO overtime_record (
        employee_id, work_date, overtime_minutes, status,
        approved_by_user_id, approved_at
    ) VALUES (
        v_employee_id, DATE '2026-02-02', 60, 'APPROVED',
        v_admin_id, NOW()
    );

    v_run := finalize_payroll_run(v_run_id);

    IF v_run.status <> 'FINALIZED' THEN
        RAISE EXCEPTION 'TEST S3-11 FAILED: run not FINALIZED';
    END IF;

    SELECT * INTO v_record
    FROM payroll_record
    WHERE payroll_run_id = v_run_id AND employee_id = v_employee_id;

    IF v_record.gross_pay <> v_record.attendance_adjusted_pay + v_record.overtime_pay + v_record.bonus_total THEN
        RAISE EXCEPTION 'TEST S3-11 FAILED: gross_pay formula mismatch';
    END IF;

    IF v_record.net_pay <> v_record.gross_pay - v_record.deduction_total THEN
        RAISE EXCEPTION 'TEST S3-11 FAILED: net_pay formula mismatch';
    END IF;

    RAISE NOTICE 'TEST S3-11 PASSED: finalize_payroll_run and payroll formulas';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-12: trigger — inactive employee cannot check in
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_employee_id UUID;
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP003';
    UPDATE employee SET status = 'INACTIVE' WHERE id = v_employee_id;

    INSERT INTO attendance_session (
        employee_id, check_in_at, status, check_in_source, work_date
    ) VALUES (
        v_employee_id, NOW(), 'OPEN', 'MANUAL', CURRENT_DATE
    );

    RAISE EXCEPTION 'TEST S3-12 FAILED: inactive employee check-in allowed';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%Inactive employees cannot check in%' THEN
            RAISE;
        END IF;
        UPDATE employee SET status = 'ACTIVE' WHERE id = v_employee_id;
        RAISE NOTICE 'TEST S3-12 PASSED: inactive employee check-in rejected';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-13: trigger — audit_log append-only
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO audit_log (action, entity_type, entity_id)
    VALUES ('TEST', 'test', gen_random_uuid())
    RETURNING id INTO v_log_id;

    UPDATE audit_log SET action = 'CHANGED' WHERE id = v_log_id;
    RAISE EXCEPTION 'TEST S3-13 FAILED: audit_log update allowed';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%append-only%' THEN
            RAISE;
        END IF;
        RAISE NOTICE 'TEST S3-13 PASSED: audit_log update rejected';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-14: trigger — finalized payroll record immutability
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_record_id UUID;
BEGIN
    SELECT id INTO v_record_id
    FROM payroll_record
    WHERE status = 'FINALIZED'
    LIMIT 1;

    UPDATE payroll_record
    SET gross_pay = gross_pay + 1
    WHERE id = v_record_id;

    RAISE EXCEPTION 'TEST S3-14 FAILED: finalized payroll record mutation allowed';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%immutable%' THEN
            RAISE;
        END IF;
        RAISE NOTICE 'TEST S3-14 PASSED: finalized payroll record mutation rejected';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-15: trigger — payment requires FINALIZED record
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_admin_id UUID;
    v_run_id UUID;
    v_employee_id UUID;
    v_draft_record_id UUID;
BEGIN
    SELECT id INTO v_admin_id FROM "user" WHERE email = 'admin3@test.local';
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP003';

    INSERT INTO payroll_run (
        period_start, period_end, status,
        payroll_policy_id, overtime_rate_config_id, initiated_by_user_id
    ) VALUES (
        DATE '2026-04-01', DATE '2026-04-30', 'DRAFT',
        (SELECT id FROM payroll_policy WHERE name = 'Standard 26'),
        (SELECT id FROM overtime_rate_config WHERE name = 'OT 1.5x'),
        v_admin_id
    ) RETURNING id INTO v_run_id;

    SELECT (compute_employee_payroll_record(v_run_id, v_employee_id)).id
    INTO v_draft_record_id;

    INSERT INTO payment (
        payroll_record_id, paid_at, recorded_by_user_id
    ) VALUES (
        v_draft_record_id, NOW(), v_admin_id
    );

    RAISE EXCEPTION 'TEST S3-15 FAILED: payment on DRAFT record allowed';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%FINALIZED payroll record%' THEN
            RAISE;
        END IF;
        RAISE NOTICE 'TEST S3-15 PASSED: payment on DRAFT record rejected';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-16: trigger — FINALIZED to PAID transition allowed
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_record_id UUID;
BEGIN
    SELECT id INTO v_record_id
    FROM payroll_record
    WHERE status = 'FINALIZED'
    LIMIT 1;

    UPDATE payroll_record SET status = 'PAID' WHERE id = v_record_id;

    IF NOT EXISTS (
        SELECT 1 FROM payroll_record WHERE id = v_record_id AND status = 'PAID'
    ) THEN
        RAISE EXCEPTION 'TEST S3-16 FAILED: FINALIZED to PAID not allowed';
    END IF;

    RAISE NOTICE 'TEST S3-16 PASSED: FINALIZED to PAID transition';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-17: trigger — updated_at auto-update
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_dept_id UUID;
    v_before TIMESTAMPTZ;
    v_after TIMESTAMPTZ;
BEGIN
    SELECT id, updated_at INTO v_dept_id, v_before
    FROM department WHERE code = 'D3';

    ALTER TABLE department DISABLE TRIGGER trg_department_set_updated_at;
    UPDATE department SET updated_at = TIMESTAMPTZ '2020-01-01' WHERE id = v_dept_id;
    ALTER TABLE department ENABLE TRIGGER trg_department_set_updated_at;

    UPDATE department SET name = 'Dept 3 Updated' WHERE id = v_dept_id;

    SELECT updated_at INTO v_after FROM department WHERE id = v_dept_id;

    IF v_after = TIMESTAMPTZ '2020-01-01' THEN
        RAISE EXCEPTION 'TEST S3-17 FAILED: updated_at not advanced by trigger';
    END IF;

    RAISE NOTICE 'TEST S3-17 PASSED: updated_at trigger';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-18: views return expected data
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_open_count INTEGER;
    v_summary_count INTEGER;
    v_register_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_open_count FROM v_open_attendance_sessions;
    SELECT COUNT(*) INTO v_summary_count FROM v_employee_attendance_summary
    WHERE employee_code = 'EMP003';
    SELECT COUNT(*) INTO v_register_count FROM v_payroll_register
    WHERE employee_code = 'EMP003';

    IF v_open_count <> 0 THEN
        RAISE EXCEPTION 'TEST S3-18 FAILED: expected 0 open sessions';
    END IF;
    IF v_summary_count < 1 THEN
        RAISE EXCEPTION 'TEST S3-18 FAILED: attendance summary empty';
    END IF;
    IF v_register_count < 1 THEN
        RAISE EXCEPTION 'TEST S3-18 FAILED: payroll register empty';
    END IF;

    RAISE NOTICE 'TEST S3-18 PASSED: views return expected rows';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-19: transaction rollback on checkout failure
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_employee_id UUID;
    v_session_id UUID;
    v_day_count_before INTEGER;
    v_day_count_after INTEGER;
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP003';

    SELECT COUNT(*) INTO v_day_count_before
    FROM employee_day_attendance WHERE employee_id = v_employee_id;

    INSERT INTO attendance_session (
        employee_id, check_in_at, status, check_in_source, work_date
    ) VALUES (
        v_employee_id,
        TIMESTAMPTZ '2026-02-20 09:00:00+00',
        'OPEN',
        'MANUAL',
        DATE '2026-02-20'
    ) RETURNING id INTO v_session_id;

    BEGIN
        PERFORM complete_attendance_checkout(
            v_session_id,
            TIMESTAMPTZ '2026-02-20 08:00:00+00'
        );
    EXCEPTION
        WHEN OTHERS THEN
            NULL;
    END;

    SELECT COUNT(*) INTO v_day_count_after
    FROM employee_day_attendance WHERE employee_id = v_employee_id;

    IF EXISTS (
        SELECT 1 FROM attendance_session
        WHERE id = v_session_id AND status = 'COMPLETED'
    ) THEN
        RAISE EXCEPTION 'TEST S3-19 FAILED: session completed after failed checkout';
    END IF;

    IF v_day_count_after <> v_day_count_before THEN
        RAISE EXCEPTION 'TEST S3-19 FAILED: day attendance changed after rollback';
    END IF;

    RAISE NOTICE 'TEST S3-19 PASSED: failed checkout leaves data unchanged';
END $$;

-- ---------------------------------------------------------------------------
-- TEST S3-20: face registration — second ACTIVE rejected (Step 3 regression)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    v_employee_id UUID;
    v_admin_id UUID;
BEGIN
    SELECT id INTO v_employee_id FROM employee WHERE employee_code = 'EMP003';
    SELECT id INTO v_admin_id FROM "user" WHERE email = 'admin3@test.local';

    INSERT INTO face_registration_metadata (
        employee_id, vector_record_id, model_name, model_version, embedding_version,
        status, registered_at, registered_by_user_id
    ) VALUES (
        v_employee_id, 'vec-s3-1', 'model', '1.0', '1.0',
        'ACTIVE', NOW(), v_admin_id
    );

    INSERT INTO face_registration_metadata (
        employee_id, vector_record_id, model_name, model_version, embedding_version,
        status, registered_at, registered_by_user_id
    ) VALUES (
        v_employee_id, 'vec-s3-2', 'model', '1.0', '1.0',
        'ACTIVE', NOW(), v_admin_id
    );

    RAISE EXCEPTION 'TEST S3-20 FAILED: second ACTIVE face registration allowed';
EXCEPTION
    WHEN unique_violation THEN
        RAISE NOTICE 'TEST S3-20 PASSED: second ACTIVE face registration rejected';
END $$;

ROLLBACK;
