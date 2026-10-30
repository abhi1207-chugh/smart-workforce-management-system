-- Phase 2.2 — Step 3: Advanced PostgreSQL DBMS features
-- Functions, triggers, views, transaction helpers, supporting indexes.
-- Business rules: docs/requirements/business-rules.md

-- migrate:up

-- ---------------------------------------------------------------------------
-- Constants (documented business values — BR-ATT-13, BR-ATT-15, BR-ATT-18)
-- ---------------------------------------------------------------------------

COMMENT ON SCHEMA public IS
    'Application schema. Half-day threshold: 240 minutes (4 hours) per BR-ATT-13/BR-ATT-18.';

-- ---------------------------------------------------------------------------
-- PART 1 — Utility functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_updated_at() IS
    'Trigger helper: sets updated_at to CURRENT_TIMESTAMP on row update.';

-- BR-ATT-09: working duration from valid check-in/check-out timestamps.
CREATE OR REPLACE FUNCTION compute_working_duration_minutes(
    p_check_in_at TIMESTAMPTZ,
    p_check_out_at TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
    SELECT FLOOR(EXTRACT(EPOCH FROM (p_check_out_at - p_check_in_at)) / 60.0)::INTEGER;
$$;

COMMENT ON FUNCTION compute_working_duration_minutes(TIMESTAMPTZ, TIMESTAMPTZ) IS
    'Returns working duration in whole minutes between check-in and check-out (BR-ATT-09).';

CREATE OR REPLACE FUNCTION compute_session_working_duration(p_session_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
STRICT
AS $$
    SELECT compute_working_duration_minutes(check_in_at, check_out_at)
    FROM attendance_session
    WHERE id = p_session_id
      AND status = 'COMPLETED'
      AND check_out_at IS NOT NULL;
$$;

COMMENT ON FUNCTION compute_session_working_duration(UUID) IS
    'Returns working minutes for a completed attendance session (BR-ATT-09).';

-- BR-ATT-13/15/18: fixed 4-hour threshold for HALF-DAY vs FULL-DAY.
CREATE OR REPLACE FUNCTION classify_day_from_minutes(p_total_minutes INTEGER)
RETURNS TABLE (
    classification day_classification,
    payable_day_fraction NUMERIC(3, 2)
)
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
    SELECT
        CASE
            WHEN p_total_minutes < 240 THEN 'HALF_DAY'::day_classification
            ELSE 'FULL_DAY'::day_classification
        END,
        CASE
            WHEN p_total_minutes < 240 THEN 0.5::NUMERIC(3, 2)
            ELSE 1.0::NUMERIC(3, 2)
        END;
$$;

COMMENT ON FUNCTION classify_day_from_minutes(INTEGER) IS
    'Classifies attendance day from total minutes: <4h HALF_DAY (0.5), >=4h FULL_DAY (1.0) per BR-ATT-13..16.';

-- BR-ATT-23/24: weekly-off from shift_weekly_off (0=Sunday .. 6=Saturday).
CREATE OR REPLACE FUNCTION is_scheduled_working_day(
    p_employee_id UUID,
    p_work_date DATE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
STRICT
AS $$
    SELECT NOT EXISTS (
        SELECT 1
        FROM employee e
        JOIN shift_weekly_off swo ON swo.shift_id = e.shift_id
        WHERE e.id = p_employee_id
          AND swo.day_of_week = EXTRACT(DOW FROM p_work_date)::SMALLINT
    );
$$;

COMMENT ON FUNCTION is_scheduled_working_day(UUID, DATE) IS
    'Returns FALSE on configured weekly-off days for the employee shift (BR-ATT-23/24).';

-- BR-ATT-26/27: lateness vs exact shift start/end (BR-ATT-29 grace period TBD — not applied).
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

COMMENT ON FUNCTION derive_shift_timing_flags(UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
    'Derives late arrival and early checkout flags from assigned shift (BR-ATT-26/27).';

-- BR-OT-02: overtime minutes beyond shift scheduled duration for a work date.
CREATE OR REPLACE FUNCTION derive_overtime_minutes(
    p_employee_id UUID,
    p_work_date DATE
)
RETURNS INTEGER
LANGUAGE sql
STABLE
STRICT
AS $$
    SELECT GREATEST(
        COALESCE((
            SELECT SUM(a.working_duration_minutes)
            FROM attendance_session a
            WHERE a.employee_id = p_employee_id
              AND a.work_date = p_work_date
              AND a.status = 'COMPLETED'
        ), 0) - s.scheduled_duration_minutes,
        0
    )::INTEGER
    FROM employee e
    JOIN shift s ON s.id = e.shift_id
    WHERE e.id = p_employee_id;
$$;

COMMENT ON FUNCTION derive_overtime_minutes(UUID, DATE) IS
    'Returns max(0, total completed session minutes - shift duration) for a date (BR-OT-02).';

-- BR-LEAVE-05: balance check (admin override policy TBD — strict check only).
CREATE OR REPLACE FUNCTION check_leave_balance(
    p_employee_id UUID,
    p_leave_type_id UUID,
    p_days NUMERIC
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
STRICT
AS $$
    SELECT COALESCE((
        SELECT balance_days >= p_days
        FROM leave_balance
        WHERE employee_id = p_employee_id
          AND leave_type_id = p_leave_type_id
    ), FALSE);
$$;

COMMENT ON FUNCTION check_leave_balance(UUID, UUID, NUMERIC) IS
    'Returns TRUE when employee has sufficient leave balance (BR-LEAVE-05; override TBD).';

-- BR-PAY-05: daily pay from policy (FIXED_DIVISOR only; CALENDAR_WORKING_DAYS not implemented).
CREATE OR REPLACE FUNCTION compute_one_day_salary(
    p_monthly_base_salary NUMERIC,
    p_payroll_policy_id UUID
)
RETURNS NUMERIC(12, 2)
LANGUAGE plpgsql
STABLE
STRICT
AS $$
DECLARE
    v_policy payroll_policy;
    v_divisor NUMERIC;
BEGIN
    SELECT * INTO v_policy
    FROM payroll_policy
    WHERE id = p_payroll_policy_id
      AND status = 'ACTIVE';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active payroll policy % not found', p_payroll_policy_id;
    END IF;

    IF v_policy.working_days_method = 'FIXED_DIVISOR' THEN
        IF v_policy.fixed_divisor IS NULL OR v_policy.fixed_divisor <= 0 THEN
            RAISE EXCEPTION 'FIXED_DIVISOR policy % requires positive fixed_divisor', p_payroll_policy_id;
        END IF;
        v_divisor := v_policy.fixed_divisor;
    ELSE
        RAISE EXCEPTION
            'CALENDAR_WORKING_DAYS policy calculation is not implemented (BR-PAY-06 TBD)';
    END IF;

    RETURN ROUND(p_monthly_base_salary / v_divisor, 2);
END;
$$;

COMMENT ON FUNCTION compute_one_day_salary(NUMERIC, UUID) IS
    'Computes one-day salary from monthly base and FIXED_DIVISOR policy (BR-PAY-05).';

-- ---------------------------------------------------------------------------
-- PART 2 — Attendance: checkout transaction (BR-ATT-08..12, BR-ATT-13..16)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION complete_attendance_checkout(
    p_session_id UUID,
    p_check_out_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
)
RETURNS employee_day_attendance
LANGUAGE plpgsql
AS $$
DECLARE
    v_session attendance_session;
    v_duration INTEGER;
    v_class day_classification;
    v_fraction NUMERIC(3, 2);
    v_late BOOLEAN;
    v_early BOOLEAN;
    v_day employee_day_attendance;
    v_scheduled BOOLEAN;
BEGIN
    SELECT * INTO v_session
    FROM attendance_session
    WHERE id = p_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attendance session % not found', p_session_id;
    END IF;

    IF v_session.status <> 'OPEN' THEN
        RAISE EXCEPTION 'Session % is not OPEN (BR-ATT-10/11)', p_session_id;
    END IF;

    IF p_check_out_at < v_session.check_in_at THEN
        RAISE EXCEPTION 'Check-out before check-in is invalid (BR-ATT-09)';
    END IF;

    v_duration := compute_working_duration_minutes(v_session.check_in_at, p_check_out_at);

    SELECT f.is_late_arrival, f.is_early_checkout
    INTO v_late, v_early
    FROM derive_shift_timing_flags(v_session.employee_id, v_session.check_in_at, p_check_out_at) f;

    UPDATE attendance_session
    SET
        check_out_at = p_check_out_at,
        working_duration_minutes = v_duration,
        status = 'COMPLETED',
        check_out_source = COALESCE(check_out_source, check_in_source),
        is_late_arrival = v_late,
        is_early_checkout = v_early,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_session_id;

    SELECT c.classification, c.payable_day_fraction
    INTO v_class, v_fraction
    FROM classify_day_from_minutes(v_duration) c;

    v_scheduled := is_scheduled_working_day(v_session.employee_id, v_session.work_date);

    INSERT INTO employee_day_attendance (
        employee_id,
        work_date,
        classification,
        total_working_minutes,
        is_scheduled_working_day,
        payable_day_fraction
    ) VALUES (
        v_session.employee_id,
        v_session.work_date,
        v_class,
        v_duration,
        v_scheduled,
        v_fraction
    )
    ON CONFLICT (employee_id, work_date) DO UPDATE
    SET
        classification = EXCLUDED.classification,
        total_working_minutes = employee_day_attendance.total_working_minutes + EXCLUDED.total_working_minutes,
        is_scheduled_working_day = EXCLUDED.is_scheduled_working_day,
        payable_day_fraction = EXCLUDED.payable_day_fraction,
        updated_at = CURRENT_TIMESTAMP
    RETURNING * INTO v_day;

    RETURN v_day;
END;
$$;

COMMENT ON FUNCTION complete_attendance_checkout(UUID, TIMESTAMPTZ) IS
    'Atomically completes an OPEN session and upserts employee_day_attendance (BR-ATT-08..16).';

-- ---------------------------------------------------------------------------
-- PART 3 — Leave approval (BR-LEAVE-03/04/09)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION approve_leave_request(
    p_request_id UUID,
    p_reviewer_user_id UUID
)
RETURNS leave_request
LANGUAGE plpgsql
AS $$
DECLARE
    v_request leave_request;
    v_days NUMERIC(5, 2);
    v_leave_type leave_type;
    v_d DATE;
BEGIN
    SELECT * INTO v_request
    FROM leave_request
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Leave request % not found', p_request_id;
    END IF;

    IF v_request.status <> 'PENDING' THEN
        RAISE EXCEPTION 'Leave request % is not PENDING', p_request_id;
    END IF;

    v_days := (v_request.end_date - v_request.start_date + 1)::NUMERIC(5, 2);

    IF NOT check_leave_balance(v_request.employee_id, v_request.leave_type_id, v_days) THEN
        RAISE EXCEPTION 'Insufficient leave balance (BR-LEAVE-05)';
    END IF;

    SELECT * INTO v_leave_type FROM leave_type WHERE id = v_request.leave_type_id;

    UPDATE leave_request
    SET
        status = 'APPROVED',
        reviewed_by_user_id = p_reviewer_user_id,
        reviewed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_request_id
    RETURNING * INTO v_request;

    UPDATE leave_balance
    SET
        balance_days = balance_days - v_days,
        updated_at = CURRENT_TIMESTAMP
    WHERE employee_id = v_request.employee_id
      AND leave_type_id = v_request.leave_type_id;

    FOR v_d IN
        SELECT generate_series(v_request.start_date, v_request.end_date, INTERVAL '1 day')::DATE
    LOOP
        INSERT INTO employee_day_attendance (
            employee_id,
            work_date,
            classification,
            total_working_minutes,
            is_scheduled_working_day,
            leave_request_id,
            payable_day_fraction
        ) VALUES (
            v_request.employee_id,
            v_d,
            'LEAVE',
            0,
            is_scheduled_working_day(v_request.employee_id, v_d),
            v_request.id,
            CASE WHEN v_leave_type.is_paid THEN 1.0 ELSE 0.0 END
        )
        ON CONFLICT (employee_id, work_date) DO UPDATE
        SET
            classification = 'LEAVE',
            leave_request_id = EXCLUDED.leave_request_id,
            payable_day_fraction = EXCLUDED.payable_day_fraction,
            updated_at = CURRENT_TIMESTAMP;
    END LOOP;

    RETURN v_request;
END;
$$;

COMMENT ON FUNCTION approve_leave_request(UUID, UUID) IS
    'Approves leave, deducts balance, marks covered dates as LEAVE (BR-LEAVE-03/04/09).';

-- ---------------------------------------------------------------------------
-- PART 4 — Payroll calculation (BR-PAY-07..15, BR-OT-05/07)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION compute_attendance_adjusted_pay(
    p_employee_id UUID,
    p_period_start DATE,
    p_period_end DATE,
    p_one_day_salary NUMERIC
)
RETURNS NUMERIC(12, 2)
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(ROUND(SUM(p_one_day_salary * eda.payable_day_fraction), 2), 0)::NUMERIC(12, 2)
    FROM employee_day_attendance eda
    WHERE eda.employee_id = p_employee_id
      AND eda.work_date BETWEEN p_period_start AND p_period_end
      AND eda.classification IN ('FULL_DAY', 'HALF_DAY', 'LEAVE');
$$;

COMMENT ON FUNCTION compute_attendance_adjusted_pay(UUID, DATE, DATE, NUMERIC) IS
    'Sums daily pay by payable_day_fraction for period (BR-PAY-07..10).';

CREATE OR REPLACE FUNCTION compute_approved_overtime_pay(
    p_employee_id UUID,
    p_period_start DATE,
    p_period_end DATE,
    p_one_day_salary NUMERIC,
    p_shift_duration_minutes INTEGER,
    p_multiplier NUMERIC
)
RETURNS NUMERIC(12, 2)
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(ROUND(
        SUM(
            (ot.overtime_minutes::NUMERIC / 60.0)
            * (p_one_day_salary / (p_shift_duration_minutes::NUMERIC / 60.0))
            * p_multiplier
        ),
        2
    ), 0)::NUMERIC(12, 2)
    FROM overtime_record ot
    WHERE ot.employee_id = p_employee_id
      AND ot.work_date BETWEEN p_period_start AND p_period_end
      AND ot.status = 'APPROVED';
$$;

COMMENT ON FUNCTION compute_approved_overtime_pay(UUID, DATE, DATE, NUMERIC, INTEGER, NUMERIC) IS
    'Approved overtime pay using shift-based hourly rate and configured multiplier (BR-OT-05/07, BR-PAY-11).';

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
        v_policy.fixed_divisor,
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
    'Computes and upserts a DRAFT payroll_record for one employee (BR-PAY-15).';

CREATE OR REPLACE FUNCTION finalize_payroll_run(p_payroll_run_id UUID)
RETURNS payroll_run
LANGUAGE plpgsql
AS $$
DECLARE
    v_run payroll_run;
    v_emp employee;
BEGIN
    SELECT * INTO v_run
    FROM payroll_run
    WHERE id = p_payroll_run_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payroll run % not found', p_payroll_run_id;
    END IF;

    IF v_run.status = 'FINALIZED' THEN
        RAISE EXCEPTION 'Payroll run % already finalized (BR-PAY-16)', p_payroll_run_id;
    END IF;

    IF v_run.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Payroll run % cannot be finalized from status %', p_payroll_run_id, v_run.status;
    END IF;

    FOR v_emp IN
        SELECT * FROM employee WHERE status = 'ACTIVE'
    LOOP
        PERFORM compute_employee_payroll_record(p_payroll_run_id, v_emp.id);
    END LOOP;

    UPDATE payroll_record
    SET status = 'FINALIZED', updated_at = CURRENT_TIMESTAMP
    WHERE payroll_run_id = p_payroll_run_id
      AND status = 'DRAFT';

    UPDATE payroll_run
    SET
        status = 'FINALIZED',
        finalized_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_payroll_run_id
    RETURNING * INTO v_run;

    INSERT INTO audit_log (action, entity_type, entity_id, metadata)
    VALUES (
        'FINALIZE',
        'payroll_run',
        p_payroll_run_id,
        jsonb_build_object('period_start', v_run.period_start, 'period_end', v_run.period_end)
    );

    RETURN v_run;
END;
$$;

COMMENT ON FUNCTION finalize_payroll_run(UUID) IS
    'Atomically generates payroll records and finalizes run (BR-PAY-16/17/18).';

-- Payroll formula check constraints (database-constraints.md §5)
ALTER TABLE payroll_record
    ADD CONSTRAINT payroll_record_gross_pay_formula
        CHECK (gross_pay = attendance_adjusted_pay + overtime_pay + bonus_total);

ALTER TABLE payroll_record
    ADD CONSTRAINT payroll_record_net_pay_formula
        CHECK (net_pay = gross_pay - deduction_total);

-- ---------------------------------------------------------------------------
-- PART 5 — Triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_finalized_payroll_record_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status IN ('FINALIZED', 'PAID') THEN
        IF NEW.status = 'PAID' AND OLD.status = 'FINALIZED'
           AND NEW.payroll_run_id = OLD.payroll_run_id
           AND NEW.employee_id = OLD.employee_id
           AND NEW.gross_pay = OLD.gross_pay
           AND NEW.net_pay = OLD.net_pay
           AND NEW.attendance_adjusted_pay = OLD.attendance_adjusted_pay
           AND NEW.overtime_pay = OLD.overtime_pay
           AND NEW.bonus_total = OLD.bonus_total
           AND NEW.deduction_total = OLD.deduction_total
        THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Finalized/paid payroll records are immutable (BR-PAY-18/19)';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payroll_record_prevent_finalized_update
    BEFORE UPDATE ON payroll_record
    FOR EACH ROW
    EXECUTE FUNCTION prevent_finalized_payroll_record_mutation();

CREATE OR REPLACE FUNCTION validate_payment_on_finalized_payroll()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_status payroll_record_status;
BEGIN
    SELECT status INTO v_status FROM payroll_record WHERE id = NEW.payroll_record_id;
    IF v_status IS DISTINCT FROM 'FINALIZED' THEN
        RAISE EXCEPTION 'Payment requires FINALIZED payroll record (BR-PMT-01)';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payment_requires_finalized_payroll
    BEFORE INSERT ON payment
    FOR EACH ROW
    EXECUTE FUNCTION validate_payment_on_finalized_payroll();

CREATE OR REPLACE FUNCTION validate_active_employee_checkin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_status entity_status;
BEGIN
    SELECT status INTO v_status FROM employee WHERE id = NEW.employee_id;
    IF v_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'Inactive employees cannot check in (BR-EMP-03)';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_attendance_session_active_employee
    BEFORE INSERT ON attendance_session
    FOR EACH ROW
    EXECUTE FUNCTION validate_active_employee_checkin();

CREATE OR REPLACE FUNCTION audit_attendance_correction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.check_in_source = 'CORRECTION' OR NEW.check_out_source = 'CORRECTION' OR NEW.correction_reason IS NOT NULL THEN
        INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
        VALUES (
            NEW.corrected_by_user_id,
            'CORRECT',
            'attendance_session',
            NEW.id,
            jsonb_build_object(
                'reason', NEW.correction_reason,
                'check_in', NEW.check_in_at,
                'check_out', NEW.check_out_at
            )
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_attendance_session_audit_correction
    AFTER INSERT OR UPDATE ON attendance_session
    FOR EACH ROW
    EXECUTE FUNCTION audit_attendance_correction();

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only (BR-AUDIT-05)';
END;
$$;

CREATE TRIGGER trg_audit_log_no_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER trg_audit_log_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_mutation();

-- updated_at triggers
CREATE TRIGGER trg_department_set_updated_at
    BEFORE UPDATE ON department FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_shift_set_updated_at
    BEFORE UPDATE ON shift FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_employee_set_updated_at
    BEFORE UPDATE ON employee FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_user_set_updated_at
    BEFORE UPDATE ON "user" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_face_registration_set_updated_at
    BEFORE UPDATE ON face_registration_metadata FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_attendance_session_set_updated_at
    BEFORE UPDATE ON attendance_session FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_employee_day_attendance_set_updated_at
    BEFORE UPDATE ON employee_day_attendance FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_leave_type_set_updated_at
    BEFORE UPDATE ON leave_type FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_leave_request_set_updated_at
    BEFORE UPDATE ON leave_request FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_overtime_record_set_updated_at
    BEFORE UPDATE ON overtime_record FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_payroll_policy_set_updated_at
    BEFORE UPDATE ON payroll_policy FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_overtime_rate_config_set_updated_at
    BEFORE UPDATE ON overtime_rate_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_payroll_run_set_updated_at
    BEFORE UPDATE ON payroll_run FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_payroll_record_set_updated_at
    BEFORE UPDATE ON payroll_record FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- PART 6 — Views
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_open_attendance_sessions AS
SELECT
    a.id AS session_id,
    a.employee_id,
    e.employee_code,
    e.first_name,
    e.last_name,
    a.check_in_at,
    a.work_date,
    a.check_in_source
FROM attendance_session a
JOIN employee e ON e.id = a.employee_id
WHERE a.status = 'OPEN';

COMMENT ON VIEW v_open_attendance_sessions IS
    'Open attendance sessions for duplicate check-in prevention queries.';

CREATE OR REPLACE VIEW v_employee_attendance_summary AS
SELECT
    e.id AS employee_id,
    e.employee_code,
    e.first_name,
    e.last_name,
    eda.work_date,
    eda.classification,
    eda.total_working_minutes,
    eda.payable_day_fraction,
    eda.is_scheduled_working_day
FROM employee e
JOIN employee_day_attendance eda ON eda.employee_id = e.id;

COMMENT ON VIEW v_employee_attendance_summary IS
    'Daily attendance classification summary per employee for reporting.';

CREATE OR REPLACE VIEW v_daily_attendance_report AS
SELECT
    eda.work_date,
    eda.classification,
    COUNT(*) AS employee_count,
    SUM(eda.total_working_minutes) AS total_minutes,
    SUM(eda.payable_day_fraction) AS total_payable_day_fractions
FROM employee_day_attendance eda
GROUP BY eda.work_date, eda.classification
ORDER BY eda.work_date, eda.classification;

COMMENT ON VIEW v_daily_attendance_report IS
    'Aggregated daily attendance counts by classification.';

CREATE OR REPLACE VIEW v_leave_balance_report AS
SELECT
    e.id AS employee_id,
    e.employee_code,
    e.first_name,
    e.last_name,
    lt.code AS leave_type_code,
    lt.name AS leave_type_name,
    lb.balance_days,
    lb.updated_at
FROM leave_balance lb
JOIN employee e ON e.id = lb.employee_id
JOIN leave_type lt ON lt.id = lb.leave_type_id;

COMMENT ON VIEW v_leave_balance_report IS
    'Current leave balances by employee and leave type.';

CREATE OR REPLACE VIEW v_overtime_summary AS
SELECT
    ot.employee_id,
    e.employee_code,
    ot.work_date,
    ot.overtime_minutes,
    ot.status,
    ot.approved_at
FROM overtime_record ot
JOIN employee e ON e.id = ot.employee_id;

COMMENT ON VIEW v_overtime_summary IS
    'Overtime records with employee identifiers for reporting.';

CREATE OR REPLACE VIEW v_payroll_register AS
SELECT
    prun.id AS payroll_run_id,
    prun.period_start,
    prun.period_end,
    prun.status AS run_status,
    prec.id AS payroll_record_id,
    prec.employee_id,
    e.employee_code,
    e.first_name,
    e.last_name,
    prec.one_day_salary,
    prec.attendance_adjusted_pay,
    prec.overtime_pay,
    prec.bonus_total,
    prec.deduction_total,
    prec.gross_pay,
    prec.net_pay,
    prec.status AS record_status
FROM payroll_run prun
JOIN payroll_record prec ON prec.payroll_run_id = prun.id
JOIN employee e ON e.id = prec.employee_id;

COMMENT ON VIEW v_payroll_register IS
    'Payroll register per run and employee for admin reporting.';

-- ---------------------------------------------------------------------------
-- PART 7 — Supporting indexes (no duplicates with Step 2)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS leave_request_employee_date_range_idx
    ON leave_request (employee_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS bonus_employee_period_unlinked_idx
    ON bonus (employee_id, period_start, period_end)
    WHERE payroll_run_id IS NULL;

CREATE INDEX IF NOT EXISTS deduction_employee_period_unlinked_idx
    ON deduction (employee_id, period_start, period_end)
    WHERE payroll_run_id IS NULL;

CREATE INDEX IF NOT EXISTS payroll_run_period_idx
    ON payroll_run (period_start, period_end);

CREATE INDEX IF NOT EXISTS overtime_record_payroll_lookup_idx
    ON overtime_record (employee_id, work_date)
    WHERE status = 'APPROVED';

-- migrate:down

DROP INDEX IF EXISTS overtime_record_payroll_lookup_idx;
DROP INDEX IF EXISTS payroll_run_period_idx;
DROP INDEX IF EXISTS deduction_employee_period_unlinked_idx;
DROP INDEX IF EXISTS bonus_employee_period_unlinked_idx;
DROP INDEX IF EXISTS leave_request_employee_date_range_idx;

DROP VIEW IF EXISTS v_payroll_register;
DROP VIEW IF EXISTS v_overtime_summary;
DROP VIEW IF EXISTS v_leave_balance_report;
DROP VIEW IF EXISTS v_daily_attendance_report;
DROP VIEW IF EXISTS v_employee_attendance_summary;
DROP VIEW IF EXISTS v_open_attendance_sessions;

DROP TRIGGER IF EXISTS trg_payroll_record_set_updated_at ON payroll_record;
DROP TRIGGER IF EXISTS trg_payroll_run_set_updated_at ON payroll_run;
DROP TRIGGER IF EXISTS trg_overtime_rate_config_set_updated_at ON overtime_rate_config;
DROP TRIGGER IF EXISTS trg_payroll_policy_set_updated_at ON payroll_policy;
DROP TRIGGER IF EXISTS trg_overtime_record_set_updated_at ON overtime_record;
DROP TRIGGER IF EXISTS trg_leave_request_set_updated_at ON leave_request;
DROP TRIGGER IF EXISTS trg_leave_type_set_updated_at ON leave_type;
DROP TRIGGER IF EXISTS trg_employee_day_attendance_set_updated_at ON employee_day_attendance;
DROP TRIGGER IF EXISTS trg_attendance_session_set_updated_at ON attendance_session;
DROP TRIGGER IF EXISTS trg_face_registration_set_updated_at ON face_registration_metadata;
DROP TRIGGER IF EXISTS trg_user_set_updated_at ON "user";
DROP TRIGGER IF EXISTS trg_employee_set_updated_at ON employee;
DROP TRIGGER IF EXISTS trg_shift_set_updated_at ON shift;
DROP TRIGGER IF EXISTS trg_department_set_updated_at ON department;
DROP TRIGGER IF EXISTS trg_audit_log_no_delete ON audit_log;
DROP TRIGGER IF EXISTS trg_audit_log_no_update ON audit_log;
DROP TRIGGER IF EXISTS trg_attendance_session_audit_correction ON attendance_session;
DROP TRIGGER IF EXISTS trg_attendance_session_active_employee ON attendance_session;
DROP TRIGGER IF EXISTS trg_payment_requires_finalized_payroll ON payment;
DROP TRIGGER IF EXISTS trg_payroll_record_prevent_finalized_update ON payroll_record;

ALTER TABLE payroll_record DROP CONSTRAINT IF EXISTS payroll_record_net_pay_formula;
ALTER TABLE payroll_record DROP CONSTRAINT IF EXISTS payroll_record_gross_pay_formula;

DROP FUNCTION IF EXISTS finalize_payroll_run(UUID);
DROP FUNCTION IF EXISTS compute_employee_payroll_record(UUID, UUID);
DROP FUNCTION IF EXISTS compute_approved_overtime_pay(UUID, DATE, DATE, NUMERIC, INTEGER, NUMERIC);
DROP FUNCTION IF EXISTS compute_attendance_adjusted_pay(UUID, DATE, DATE, NUMERIC);
DROP FUNCTION IF EXISTS approve_leave_request(UUID, UUID);
DROP FUNCTION IF EXISTS complete_attendance_checkout(UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS compute_one_day_salary(NUMERIC, UUID);
DROP FUNCTION IF EXISTS check_leave_balance(UUID, UUID, NUMERIC);
DROP FUNCTION IF EXISTS derive_overtime_minutes(UUID, DATE);
DROP FUNCTION IF EXISTS derive_shift_timing_flags(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS is_scheduled_working_day(UUID, DATE);
DROP FUNCTION IF EXISTS classify_day_from_minutes(INTEGER);
DROP FUNCTION IF EXISTS compute_session_working_duration(UUID);
DROP FUNCTION IF EXISTS compute_working_duration_minutes(TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS prevent_audit_log_mutation();
DROP FUNCTION IF EXISTS audit_attendance_correction();
DROP FUNCTION IF EXISTS validate_active_employee_checkin();
DROP FUNCTION IF EXISTS validate_payment_on_finalized_payroll();
DROP FUNCTION IF EXISTS prevent_finalized_payroll_record_mutation();
DROP FUNCTION IF EXISTS set_updated_at();
