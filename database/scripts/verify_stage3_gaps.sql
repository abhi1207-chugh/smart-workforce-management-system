-- Stage 3 — verification of closed SQL gaps (rolled back; no persistent test data)
-- Run: docker exec -i smart_attendance_postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < database/scripts/verify_stage3_gaps.sql

BEGIN;

DO $$
DECLARE
    v_dept UUID; v_shift UUID; v_emp UUID; v_admin UUID; v_type UUID;
    v_policy UUID; v_ot UUID; v_run UUID; v_rec payroll_record;
    v_late BOOLEAN; v_bal leave_balance; v_days NUMERIC;
BEGIN
    INSERT INTO department (code, name, status) VALUES ('S3V', 'S3V', 'ACTIVE') RETURNING id INTO v_dept;
    INSERT INTO shift (name, start_time, end_time, scheduled_duration_minutes, status, grace_period_minutes)
    VALUES ('S3V', '09:00', '18:00', 540, 'ACTIVE', 15) RETURNING id INTO v_shift;
    INSERT INTO shift_weekly_off (shift_id, day_of_week) VALUES (v_shift, 0);
    INSERT INTO employee (employee_code, first_name, last_name, email, department_id, shift_id, monthly_base_salary, status)
    VALUES ('S3V1', 'A', 'B', 's3v1@test.local', v_dept, v_shift, 31000, 'ACTIVE') RETURNING id INTO v_emp;
    INSERT INTO "user" (email, password_hash, role, status)
    VALUES ('s3v-admin@test.local', 'x', 'ADMIN', 'ACTIVE') RETURNING id INTO v_admin;

    -- S4-01: grace period
    SELECT is_late_arrival INTO v_late FROM derive_shift_timing_flags(v_emp, '2024-01-02 09:15'::timestamp::timestamptz, '2024-01-02 18:00'::timestamp::timestamptz);
    IF v_late THEN RAISE EXCEPTION 'TEST S4-01 FAILED: 09:15 flagged late with 15m grace'; END IF;
    SELECT is_late_arrival INTO v_late FROM derive_shift_timing_flags(v_emp, '2024-01-02 09:16'::timestamp::timestamptz, '2024-01-02 18:00'::timestamp::timestamptz);
    IF NOT v_late THEN RAISE EXCEPTION 'TEST S4-01 FAILED: 09:16 not flagged late'; END IF;
    RAISE NOTICE 'TEST S4-01 PASSED: grace period applied';

    -- S4-02: leave balance override
    INSERT INTO leave_type (code, name, annual_entitlement_days, is_paid, status) VALUES ('S3V', 'S3V', 5, true, 'ACTIVE') RETURNING id INTO v_type;
    v_bal := adjust_leave_balance(v_emp, v_type, 12.5, v_admin, 'test');
    IF v_bal.balance_days <> 12.5 THEN RAISE EXCEPTION 'TEST S4-02 FAILED: balance not set'; END IF;
    IF NOT EXISTS (SELECT 1 FROM audit_log WHERE entity_type = 'leave_balance' AND entity_id = v_bal.id AND actor_user_id = v_admin) THEN
        RAISE EXCEPTION 'TEST S4-02 FAILED: no audit entry';
    END IF;
    RAISE NOTICE 'TEST S4-02 PASSED: balance override audited';

    BEGIN
        PERFORM adjust_leave_balance(v_emp, v_type, 1, v_admin, '  ');
        RAISE EXCEPTION 'TEST S4-03 FAILED: blank reason accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE 'TEST S4-03%' THEN RAISE; END IF;
        RAISE NOTICE 'TEST S4-03 PASSED: blank reason rejected';
    END;

    -- S4-04: calendar divisor excludes Sundays (2024-01: 31 days, 4 Sundays => 27)
    INSERT INTO payroll_policy (name, working_days_method, is_default, status) VALUES ('S3V', 'CALENDAR_WORKING_DAYS', false, 'ACTIVE') RETURNING id INTO v_policy;
    v_days := resolve_payroll_divisor(v_policy, v_emp, '2024-01-01', '2024-01-31');
    IF v_days <> 27 THEN RAISE EXCEPTION 'TEST S4-04 FAILED: divisor % <> 27', v_days; END IF;
    RAISE NOTICE 'TEST S4-04 PASSED: calendar divisor = 27';

    -- S4-05: deduction capped, net_pay >= 0
    INSERT INTO overtime_rate_config (name, multiplier, is_default, status) VALUES ('S3V', 2, false, 'ACTIVE') RETURNING id INTO v_ot;
    INSERT INTO payroll_run (period_start, period_end, status, payroll_policy_id, overtime_rate_config_id, initiated_by_user_id)
    VALUES ('2024-01-01', '2024-01-31', 'DRAFT', v_policy, v_ot, v_admin) RETURNING id INTO v_run;
    INSERT INTO employee_day_attendance (employee_id, work_date, classification, total_working_minutes, is_scheduled_working_day, payable_day_fraction)
    VALUES (v_emp, '2024-01-02', 'FULL_DAY', 480, true, 1.0);
    INSERT INTO deduction (employee_id, period_start, period_end, deduction_type, amount, reason, created_by_user_id)
    VALUES (v_emp, '2024-01-01', '2024-01-31', 'LOAN', 99999, 'test', v_admin);
    v_rec := compute_employee_payroll_record(v_run, v_emp);
    IF v_rec.net_pay <> 0 OR v_rec.deduction_total <> v_rec.gross_pay THEN
        RAISE EXCEPTION 'TEST S4-05 FAILED: net %, deduction %, gross %', v_rec.net_pay, v_rec.deduction_total, v_rec.gross_pay;
    END IF;
    RAISE NOTICE 'TEST S4-05 PASSED: deduction capped at gross (net 0)';

    BEGIN
        UPDATE payroll_record SET deduction_total = gross_pay + 1, net_pay = -1 WHERE id = v_rec.id;
        RAISE EXCEPTION 'TEST S4-06 FAILED: negative net_pay allowed';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'TEST S4-06 PASSED: negative net_pay rejected';
    END;
END $$;

ROLLBACK;
