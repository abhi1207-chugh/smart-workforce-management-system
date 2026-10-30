-- Stage 3: close known SQL gaps
--   1. Lateness grace period (BR-ATT-29)         -> shift.grace_period_minutes
--   2. Leave balance admin override (BR-LEAVE-05) -> adjust_leave_balance()
--   3. Deduction cap so net_pay >= 0              -> compute_employee_payroll_record() + CHECK
--   4. CALENDAR_WORKING_DAYS payroll divisor      -> resolve_payroll_divisor()

-- migrate:up

-- ---------------------------------------------------------------------------
-- 1. Lateness grace period (per shift; default 0 keeps the old exact-start rule)
-- ---------------------------------------------------------------------------

ALTER TABLE shift
    ADD COLUMN grace_period_minutes INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT shift_grace_period_range CHECK (grace_period_minutes BETWEEN 0 AND 240);

COMMENT ON COLUMN shift.grace_period_minutes IS
    'Minutes after shift start_time before a check-in counts as late (BR-ATT-29). 0 = exact start.';

CREATE OR REPLACE FUNCTION derive_shift_timing_flags(
    p_employee_id UUID,
    p_check_in_at TIMESTAMPTZ,
    p_check_out_at TIMESTAMPTZ
)
RETURNS TABLE (
    is_late_arrival BOOLEAN,
    is_early_checkout BOOLEAN
)
LANGUAGE sql
STABLE
STRICT
AS $$
    SELECT
        ((p_check_in_at::TIME - s.start_time) > make_interval(mins => s.grace_period_minutes)),
        (p_check_out_at::TIME < s.end_time)
    FROM employee e
    JOIN shift s ON s.id = e.shift_id
    WHERE e.id = p_employee_id;
$$;

COMMENT ON FUNCTION derive_shift_timing_flags(UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
    'Late arrival (after start_time + shift grace period) and early checkout flags (BR-ATT-26/27/29).';

-- ---------------------------------------------------------------------------
-- 2. Leave balance admin override
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION adjust_leave_balance(
    p_employee_id UUID,
    p_leave_type_id UUID,
    p_new_balance NUMERIC,
    p_admin_user_id UUID,
    p_reason TEXT
)
RETURNS leave_balance
LANGUAGE plpgsql
AS $$
DECLARE
    v_old NUMERIC;
    v_row leave_balance;
BEGIN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'A reason is required to adjust a leave balance';
    END IF;
    IF p_new_balance IS NULL OR p_new_balance < 0 THEN
        RAISE EXCEPTION 'Leave balance must be zero or greater';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "user" WHERE id = p_admin_user_id AND role = 'ADMIN') THEN
        RAISE EXCEPTION 'Only an ADMIN user may adjust leave balances';
    END IF;

    SELECT balance_days INTO v_old
    FROM leave_balance
    WHERE employee_id = p_employee_id AND leave_type_id = p_leave_type_id
    FOR UPDATE;

    INSERT INTO leave_balance (employee_id, leave_type_id, balance_days)
    VALUES (p_employee_id, p_leave_type_id, p_new_balance)
    ON CONFLICT (employee_id, leave_type_id) DO UPDATE
    SET balance_days = EXCLUDED.balance_days, updated_at = CURRENT_TIMESTAMP
    RETURNING * INTO v_row;

    INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (
        p_admin_user_id,
        'ADJUST',
        'leave_balance',
        v_row.id,
        jsonb_build_object(
            'employee_id', p_employee_id,
            'leave_type_id', p_leave_type_id,
            'old_balance', v_old,
            'new_balance', v_row.balance_days,
            'reason', btrim(p_reason)
        )
    );

    RETURN v_row;
END;
$$;

COMMENT ON FUNCTION adjust_leave_balance(UUID, UUID, NUMERIC, UUID, TEXT) IS
    'ADMIN override: sets a leave balance to an absolute value with a mandatory reason; audited (BR-LEAVE-05).';

-- ---------------------------------------------------------------------------
-- 4. CALENDAR_WORKING_DAYS divisor
--    Divisor = days in the payroll period that are not weekly-off for the
--    employee's shift. Intended for monthly runs (no holiday calendar yet).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION resolve_payroll_divisor(
    p_payroll_policy_id UUID,
    p_employee_id UUID,
    p_period_start DATE,
    p_period_end DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_policy payroll_policy;
    v_days INTEGER;
BEGIN
    SELECT * INTO v_policy
    FROM payroll_policy
    WHERE id = p_payroll_policy_id AND status = 'ACTIVE';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active payroll policy % not found', p_payroll_policy_id;
    END IF;

    IF v_policy.working_days_method = 'FIXED_DIVISOR' THEN
        IF v_policy.fixed_divisor IS NULL OR v_policy.fixed_divisor <= 0 THEN
            RAISE EXCEPTION 'FIXED_DIVISOR policy % requires positive fixed_divisor', p_payroll_policy_id;
        END IF;
        RETURN v_policy.fixed_divisor;
    END IF;

    SELECT COUNT(*) INTO v_days
    FROM generate_series(p_period_start, p_period_end, INTERVAL '1 day') AS d(day)
    WHERE is_scheduled_working_day(p_employee_id, d.day::DATE);

    IF v_days = 0 THEN
        RAISE EXCEPTION 'No scheduled working days for employee % in the payroll period', p_employee_id;
    END IF;
    RETURN v_days;
END;
$$;

COMMENT ON FUNCTION resolve_payroll_divisor(UUID, UUID, DATE, DATE) IS
    'Working-day divisor for a policy: fixed value, or scheduled working days in the period (BR-PAY-05/06).';

-- ---------------------------------------------------------------------------
-- 3 + 4. Payroll record computation: policy-aware divisor, deductions capped at gross
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION compute_employee_payroll_record(
    p_payroll_run_id UUID,
    p_employee_id UUID
)
RETURNS payroll_record
LANGUAGE plpgsql
AS $$
DECLARE
    v_run payroll_run;
    v_employee employee;
    v_ot_config overtime_rate_config;
    v_divisor NUMERIC;
    v_one_day NUMERIC(12, 2);
    v_attendance_pay NUMERIC(12, 2);
    v_ot_pay NUMERIC(12, 2);
    v_bonus NUMERIC(12, 2);
    v_deduction NUMERIC(12, 2);
    v_gross NUMERIC(12, 2);
    v_net NUMERIC(12, 2);
    v_shift_minutes INTEGER;
    v_record payroll_record;
BEGIN
    SELECT * INTO v_run FROM payroll_run WHERE id = p_payroll_run_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payroll run % not found', p_payroll_run_id;
    END IF;
    IF v_run.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Payroll run % is not DRAFT', p_payroll_run_id;
    END IF;

    SELECT * INTO v_employee FROM employee WHERE id = p_employee_id;
    IF NOT FOUND OR v_employee.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Active employee % required (BR-EMP-03)', p_employee_id;
    END IF;

    SELECT * INTO v_ot_config FROM overtime_rate_config WHERE id = v_run.overtime_rate_config_id;
    SELECT scheduled_duration_minutes INTO v_shift_minutes FROM shift WHERE id = v_employee.shift_id;

    v_divisor := resolve_payroll_divisor(
        v_run.payroll_policy_id, p_employee_id, v_run.period_start, v_run.period_end
    );
    v_one_day := ROUND(v_employee.monthly_base_salary / v_divisor, 2);
    v_attendance_pay := compute_attendance_adjusted_pay(
        p_employee_id, v_run.period_start, v_run.period_end, v_one_day
    );
    v_ot_pay := compute_approved_overtime_pay(
        p_employee_id,
        v_run.period_start,
        v_run.period_end,
        v_one_day,
        v_shift_minutes,
        v_ot_config.multiplier
    );

    SELECT COALESCE(ROUND(SUM(amount), 2), 0) INTO v_bonus
    FROM bonus
    WHERE employee_id = p_employee_id
      AND period_start >= v_run.period_start
      AND period_end <= v_run.period_end
      AND (payroll_run_id IS NULL OR payroll_run_id = p_payroll_run_id);

    SELECT COALESCE(ROUND(SUM(amount), 2), 0) INTO v_deduction
    FROM deduction
    WHERE employee_id = p_employee_id
      AND period_start >= v_run.period_start
      AND period_end <= v_run.period_end
      AND (payroll_run_id IS NULL OR payroll_run_id = p_payroll_run_id);

    v_gross := ROUND(v_attendance_pay + v_ot_pay + v_bonus, 2);
    -- Deductions can never push net pay below zero; any excess is not carried over.
    v_deduction := LEAST(v_deduction, v_gross);
    v_net := ROUND(v_gross - v_deduction, 2);

    INSERT INTO payroll_record (
        payroll_run_id,
        employee_id,
        monthly_base_salary,
        working_days_in_policy,
        one_day_salary,
        attendance_adjusted_pay,
        overtime_pay,
        bonus_total,
        deduction_total,
        gross_pay,
        net_pay,
        status
    ) VALUES (
        p_payroll_run_id,
        p_employee_id,
        v_employee.monthly_base_salary,
        v_divisor,
        v_one_day,
        v_attendance_pay,
        v_ot_pay,
        v_bonus,
        v_deduction,
        v_gross,
        v_net,
        'DRAFT'
    )
    ON CONFLICT (payroll_run_id, employee_id) DO UPDATE
    SET
        monthly_base_salary = EXCLUDED.monthly_base_salary,
        working_days_in_policy = EXCLUDED.working_days_in_policy,
        one_day_salary = EXCLUDED.one_day_salary,
        attendance_adjusted_pay = EXCLUDED.attendance_adjusted_pay,
        overtime_pay = EXCLUDED.overtime_pay,
        bonus_total = EXCLUDED.bonus_total,
        deduction_total = EXCLUDED.deduction_total,
        gross_pay = EXCLUDED.gross_pay,
        net_pay = EXCLUDED.net_pay,
        updated_at = CURRENT_TIMESTAMP
    RETURNING * INTO v_record;

    UPDATE bonus
    SET payroll_run_id = p_payroll_run_id
    WHERE employee_id = p_employee_id
      AND period_start >= v_run.period_start
      AND period_end <= v_run.period_end
      AND payroll_run_id IS NULL;

    UPDATE deduction
    SET payroll_run_id = p_payroll_run_id
    WHERE employee_id = p_employee_id
      AND period_start >= v_run.period_start
      AND period_end <= v_run.period_end
      AND payroll_run_id IS NULL;

    RETURN v_record;
END;
$$;

COMMENT ON FUNCTION compute_employee_payroll_record(UUID, UUID) IS
    'Computes and upserts a DRAFT payroll_record; policy-aware divisor, deductions capped at gross so net_pay >= 0 (BR-PAY-15).';

ALTER TABLE payroll_record
    ADD CONSTRAINT payroll_record_net_pay_non_negative CHECK (net_pay >= 0);

-- migrate:down

ALTER TABLE payroll_record DROP CONSTRAINT IF EXISTS payroll_record_net_pay_non_negative;

-- Restore the Step 3 definition of compute_employee_payroll_record (FIXED_DIVISOR only, no cap).
CREATE OR REPLACE FUNCTION compute_employee_payroll_record(
    p_payroll_run_id UUID,
    p_employee_id UUID
)
RETURNS payroll_record
LANGUAGE plpgsql
AS $$
DECLARE
    v_run payroll_run;
    v_employee employee;
    v_policy payroll_policy;
    v_ot_config overtime_rate_config;
    v_one_day NUMERIC(12, 2);
    v_attendance_pay NUMERIC(12, 2);
    v_ot_pay NUMERIC(12, 2);
    v_bonus NUMERIC(12, 2);
    v_deduction NUMERIC(12, 2);
    v_gross NUMERIC(12, 2);
    v_net NUMERIC(12, 2);
    v_shift_minutes INTEGER;
    v_record payroll_record;
BEGIN
    SELECT * INTO v_run FROM payroll_run WHERE id = p_payroll_run_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payroll run % not found', p_payroll_run_id;
    END IF;
    IF v_run.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Payroll run % is not DRAFT', p_payroll_run_id;
    END IF;

    SELECT * INTO v_employee FROM employee WHERE id = p_employee_id;
    IF NOT FOUND OR v_employee.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Active employee % required (BR-EMP-03)', p_employee_id;
    END IF;

    SELECT * INTO v_policy FROM payroll_policy WHERE id = v_run.payroll_policy_id;
    SELECT * INTO v_ot_config FROM overtime_rate_config WHERE id = v_run.overtime_rate_config_id;
    SELECT scheduled_duration_minutes INTO v_shift_minutes FROM shift WHERE id = v_employee.shift_id;

    v_one_day := compute_one_day_salary(v_employee.monthly_base_salary, v_run.payroll_policy_id);
    v_attendance_pay := compute_attendance_adjusted_pay(
        p_employee_id, v_run.period_start, v_run.period_end, v_one_day
    );
    v_ot_pay := compute_approved_overtime_pay(
        p_employee_id,
        v_run.period_start,
        v_run.period_end,
        v_one_day,
        v_shift_minutes,
        v_ot_config.multiplier
    );

    SELECT COALESCE(ROUND(SUM(amount), 2), 0) INTO v_bonus
    FROM bonus
    WHERE employee_id = p_employee_id
      AND period_start >= v_run.period_start
      AND period_end <= v_run.period_end
      AND (payroll_run_id IS NULL OR payroll_run_id = p_payroll_run_id);

    SELECT COALESCE(ROUND(SUM(amount), 2), 0) INTO v_deduction
    FROM deduction
    WHERE employee_id = p_employee_id
      AND period_start >= v_run.period_start
      AND period_end <= v_run.period_end
      AND (payroll_run_id IS NULL OR payroll_run_id = p_payroll_run_id);

    v_gross := ROUND(v_attendance_pay + v_ot_pay + v_bonus, 2);
    v_net := ROUND(v_gross - v_deduction, 2);

    INSERT INTO payroll_record (
        payroll_run_id, employee_id, monthly_base_salary, working_days_in_policy,
        one_day_salary, attendance_adjusted_pay, overtime_pay, bonus_total,
        deduction_total, gross_pay, net_pay, status
    ) VALUES (
        p_payroll_run_id, p_employee_id, v_employee.monthly_base_salary, v_policy.fixed_divisor,
        v_one_day, v_attendance_pay, v_ot_pay, v_bonus,
        v_deduction, v_gross, v_net, 'DRAFT'
    )
    ON CONFLICT (payroll_run_id, employee_id) DO UPDATE
    SET
        monthly_base_salary = EXCLUDED.monthly_base_salary,
        working_days_in_policy = EXCLUDED.working_days_in_policy,
        one_day_salary = EXCLUDED.one_day_salary,
        attendance_adjusted_pay = EXCLUDED.attendance_adjusted_pay,
        overtime_pay = EXCLUDED.overtime_pay,
        bonus_total = EXCLUDED.bonus_total,
        deduction_total = EXCLUDED.deduction_total,
        gross_pay = EXCLUDED.gross_pay,
        net_pay = EXCLUDED.net_pay,
        updated_at = CURRENT_TIMESTAMP
    RETURNING * INTO v_record;

    UPDATE bonus
    SET payroll_run_id = p_payroll_run_id
    WHERE employee_id = p_employee_id
      AND period_start >= v_run.period_start
      AND period_end <= v_run.period_end
      AND payroll_run_id IS NULL;

    UPDATE deduction
    SET payroll_run_id = p_payroll_run_id
    WHERE employee_id = p_employee_id
      AND period_start >= v_run.period_start
      AND period_end <= v_run.period_end
      AND payroll_run_id IS NULL;

    RETURN v_record;
END;
$$;

DROP FUNCTION IF EXISTS resolve_payroll_divisor(UUID, UUID, DATE, DATE);
DROP FUNCTION IF EXISTS adjust_leave_balance(UUID, UUID, NUMERIC, UUID, TEXT);

CREATE OR REPLACE FUNCTION derive_shift_timing_flags(
    p_employee_id UUID,
    p_check_in_at TIMESTAMPTZ,
    p_check_out_at TIMESTAMPTZ
)
RETURNS TABLE (
    is_late_arrival BOOLEAN,
    is_early_checkout BOOLEAN
)
LANGUAGE sql
STABLE
STRICT
AS $$
    SELECT
        (p_check_in_at::TIME > s.start_time),
        (p_check_out_at::TIME < s.end_time)
    FROM employee e
    JOIN shift s ON s.id = e.shift_id
    WHERE e.id = p_employee_id;
$$;

ALTER TABLE shift
    DROP CONSTRAINT IF EXISTS shift_grace_period_range,
    DROP COLUMN IF EXISTS grace_period_minutes;
