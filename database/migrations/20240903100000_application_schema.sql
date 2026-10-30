-- Phase 2.2 — Step 2: Application relational schema (20 tables)
-- Implements approved Phase 2.1 design (docs/database/).
-- Enum strategy: PostgreSQL ENUM types (consistent, defined once per domain).

-- migrate:up

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------

CREATE TYPE entity_status AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TYPE user_role AS ENUM ('ADMIN', 'EMPLOYEE');

CREATE TYPE face_registration_status AS ENUM ('ACTIVE', 'SUPERSEDED', 'REVOKED');

CREATE TYPE attendance_session_status AS ENUM ('OPEN', 'COMPLETED');

CREATE TYPE attendance_source AS ENUM ('FACE_RECOGNITION', 'MANUAL', 'CORRECTION');

CREATE TYPE day_classification AS ENUM (
    'FULL_DAY',
    'HALF_DAY',
    'ABSENT',
    'LEAVE',
    'WEEKLY_OFF'
);

CREATE TYPE leave_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TYPE overtime_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TYPE working_days_method AS ENUM ('FIXED_DIVISOR', 'CALENDAR_WORKING_DAYS');

CREATE TYPE payroll_run_status AS ENUM ('DRAFT', 'FINALIZED', 'FAILED');

CREATE TYPE payroll_record_status AS ENUM ('DRAFT', 'FINALIZED', 'PAID');

-- ---------------------------------------------------------------------------
-- 1. department
-- ---------------------------------------------------------------------------

CREATE TABLE department (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    status entity_status NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT department_code_unique UNIQUE (code)
);

-- ---------------------------------------------------------------------------
-- 2. shift
-- ---------------------------------------------------------------------------

CREATE TABLE shift (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    scheduled_duration_minutes INTEGER NOT NULL,
    status entity_status NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT shift_times_differ CHECK (start_time <> end_time),
    CONSTRAINT shift_scheduled_duration_positive CHECK (scheduled_duration_minutes > 0)
);

-- ---------------------------------------------------------------------------
-- 3. shift_weekly_off
-- ---------------------------------------------------------------------------

CREATE TABLE shift_weekly_off (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL,
    day_of_week SMALLINT NOT NULL,
    CONSTRAINT shift_weekly_off_shift_id_fkey
        FOREIGN KEY (shift_id) REFERENCES shift (id) ON DELETE RESTRICT,
    CONSTRAINT shift_weekly_off_shift_day_unique UNIQUE (shift_id, day_of_week),
    CONSTRAINT shift_weekly_off_day_of_week_range CHECK (day_of_week BETWEEN 0 AND 6)
);

-- ---------------------------------------------------------------------------
-- 4. employee
-- ---------------------------------------------------------------------------

CREATE TABLE employee (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_code VARCHAR(50) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    department_id UUID NOT NULL,
    shift_id UUID NOT NULL,
    monthly_base_salary NUMERIC(12, 2) NOT NULL,
    status entity_status NOT NULL,
    hire_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT employee_code_unique UNIQUE (employee_code),
    CONSTRAINT employee_email_unique UNIQUE (email),
    CONSTRAINT employee_monthly_base_salary_non_negative CHECK (monthly_base_salary >= 0),
    CONSTRAINT employee_department_id_fkey
        FOREIGN KEY (department_id) REFERENCES department (id) ON DELETE RESTRICT,
    CONSTRAINT employee_shift_id_fkey
        FOREIGN KEY (shift_id) REFERENCES shift (id) ON DELETE RESTRICT
);

CREATE INDEX employee_department_id_idx ON employee (department_id);
CREATE INDEX employee_shift_id_idx ON employee (shift_id);
CREATE INDEX employee_status_idx ON employee (status);

-- ---------------------------------------------------------------------------
-- 5. user (quoted — reserved word in PostgreSQL)
-- ---------------------------------------------------------------------------

CREATE TABLE "user" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL,
    employee_id UUID,
    status entity_status NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_email_unique UNIQUE (email),
    CONSTRAINT user_employee_id_unique UNIQUE (employee_id),
    CONSTRAINT user_employee_role_check CHECK (
        role <> 'EMPLOYEE' OR employee_id IS NOT NULL
    ),
    CONSTRAINT user_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES employee (id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- 6. leave_type (before leave_balance, leave_request, employee_day_attendance)
-- ---------------------------------------------------------------------------

CREATE TABLE leave_type (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    annual_entitlement_days INTEGER NOT NULL,
    is_paid BOOLEAN NOT NULL,
    status entity_status NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT leave_type_code_unique UNIQUE (code)
);

-- ---------------------------------------------------------------------------
-- 7. leave_balance
-- ---------------------------------------------------------------------------

CREATE TABLE leave_balance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    leave_type_id UUID NOT NULL,
    balance_days NUMERIC(5, 2) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT leave_balance_employee_leave_type_unique UNIQUE (employee_id, leave_type_id),
    CONSTRAINT leave_balance_days_non_negative CHECK (balance_days >= 0),
    CONSTRAINT leave_balance_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES employee (id) ON DELETE RESTRICT,
    CONSTRAINT leave_balance_leave_type_id_fkey
        FOREIGN KEY (leave_type_id) REFERENCES leave_type (id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------
-- 8. leave_request
-- ---------------------------------------------------------------------------

CREATE TABLE leave_request (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    leave_type_id UUID NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT,
    status leave_request_status NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL,
    reviewed_by_user_id UUID,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT leave_request_date_range CHECK (end_date >= start_date),
    CONSTRAINT leave_request_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES employee (id) ON DELETE RESTRICT,
    CONSTRAINT leave_request_leave_type_id_fkey
        FOREIGN KEY (leave_type_id) REFERENCES leave_type (id) ON DELETE RESTRICT,
    CONSTRAINT leave_request_reviewed_by_user_id_fkey
        FOREIGN KEY (reviewed_by_user_id) REFERENCES "user" (id) ON DELETE SET NULL
);

CREATE INDEX leave_request_employee_id_status_idx ON leave_request (employee_id, status);

-- ---------------------------------------------------------------------------
-- 9. face_registration_metadata
-- ---------------------------------------------------------------------------

CREATE TABLE face_registration_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    vector_record_id VARCHAR(255) NOT NULL,
    model_name VARCHAR(100) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    embedding_version VARCHAR(50) NOT NULL,
    status face_registration_status NOT NULL,
    registered_at TIMESTAMPTZ NOT NULL,
    registered_by_user_id UUID NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT face_registration_metadata_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES employee (id) ON DELETE RESTRICT,
    CONSTRAINT face_registration_metadata_registered_by_user_id_fkey
        FOREIGN KEY (registered_by_user_id) REFERENCES "user" (id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX face_registration_metadata_one_active_per_employee_idx
    ON face_registration_metadata (employee_id)
    WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 10. attendance_session
-- ---------------------------------------------------------------------------

CREATE TABLE attendance_session (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    check_in_at TIMESTAMPTZ NOT NULL,
    check_out_at TIMESTAMPTZ,
    working_duration_minutes INTEGER,
    status attendance_session_status NOT NULL,
    check_in_source attendance_source NOT NULL,
    check_out_source attendance_source,
    recognition_confidence NUMERIC(5, 4),
    recognition_token VARCHAR(255),
    is_late_arrival BOOLEAN NOT NULL DEFAULT FALSE,
    is_early_checkout BOOLEAN NOT NULL DEFAULT FALSE,
    corrected_by_user_id UUID,
    correction_reason TEXT,
    work_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT attendance_session_checkout_after_checkin CHECK (
        check_out_at IS NULL OR check_out_at >= check_in_at
    ),
    CONSTRAINT attendance_session_open_no_checkout CHECK (
        status <> 'OPEN' OR check_out_at IS NULL
    ),
    CONSTRAINT attendance_session_completed_has_checkout CHECK (
        status <> 'COMPLETED' OR check_out_at IS NOT NULL
    ),
    CONSTRAINT attendance_session_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES employee (id) ON DELETE RESTRICT,
    CONSTRAINT attendance_session_corrected_by_user_id_fkey
        FOREIGN KEY (corrected_by_user_id) REFERENCES "user" (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX attendance_session_one_open_per_employee_idx
    ON attendance_session (employee_id)
    WHERE status = 'OPEN';

CREATE INDEX attendance_session_employee_id_status_idx ON attendance_session (employee_id, status);
CREATE INDEX attendance_session_employee_id_work_date_idx ON attendance_session (employee_id, work_date);

-- ---------------------------------------------------------------------------
-- 11. employee_day_attendance
-- ---------------------------------------------------------------------------

CREATE TABLE employee_day_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    work_date DATE NOT NULL,
    classification day_classification NOT NULL,
    total_working_minutes INTEGER NOT NULL DEFAULT 0,
    is_scheduled_working_day BOOLEAN NOT NULL,
    leave_request_id UUID,
    payable_day_fraction NUMERIC(3, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT employee_day_attendance_employee_work_date_unique UNIQUE (employee_id, work_date),
    CONSTRAINT employee_day_attendance_payable_day_fraction_check CHECK (
        payable_day_fraction IN (0, 0.5, 1.0)
    ),
    CONSTRAINT employee_day_attendance_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES employee (id) ON DELETE RESTRICT,
    CONSTRAINT employee_day_attendance_leave_request_id_fkey
        FOREIGN KEY (leave_request_id) REFERENCES leave_request (id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- 12. overtime_rate_config
-- ---------------------------------------------------------------------------

CREATE TABLE overtime_rate_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    multiplier NUMERIC(4, 2) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    status entity_status NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT overtime_rate_config_multiplier_positive CHECK (multiplier > 0)
);

-- ---------------------------------------------------------------------------
-- 13. overtime_record
-- ---------------------------------------------------------------------------

CREATE TABLE overtime_record (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    work_date DATE NOT NULL,
    overtime_minutes INTEGER NOT NULL,
    status overtime_status NOT NULL,
    attendance_session_id UUID,
    approved_by_user_id UUID,
    approved_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT overtime_record_minutes_positive CHECK (overtime_minutes > 0),
    CONSTRAINT overtime_record_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES employee (id) ON DELETE RESTRICT,
    CONSTRAINT overtime_record_attendance_session_id_fkey
        FOREIGN KEY (attendance_session_id) REFERENCES attendance_session (id) ON DELETE SET NULL,
    CONSTRAINT overtime_record_approved_by_user_id_fkey
        FOREIGN KEY (approved_by_user_id) REFERENCES "user" (id) ON DELETE SET NULL
);

CREATE INDEX overtime_record_employee_id_work_date_status_idx
    ON overtime_record (employee_id, work_date, status);

-- ---------------------------------------------------------------------------
-- 14. payroll_policy
-- ---------------------------------------------------------------------------

CREATE TABLE payroll_policy (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    working_days_method working_days_method NOT NULL,
    fixed_divisor NUMERIC(5, 2),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    status entity_status NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 15. payroll_run
-- ---------------------------------------------------------------------------

CREATE TABLE payroll_run (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status payroll_run_status NOT NULL,
    payroll_policy_id UUID NOT NULL,
    overtime_rate_config_id UUID NOT NULL,
    initiated_by_user_id UUID NOT NULL,
    finalized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT payroll_run_payroll_policy_id_fkey
        FOREIGN KEY (payroll_policy_id) REFERENCES payroll_policy (id) ON DELETE RESTRICT,
    CONSTRAINT payroll_run_overtime_rate_config_id_fkey
        FOREIGN KEY (overtime_rate_config_id) REFERENCES overtime_rate_config (id) ON DELETE RESTRICT,
    CONSTRAINT payroll_run_initiated_by_user_id_fkey
        FOREIGN KEY (initiated_by_user_id) REFERENCES "user" (id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX payroll_run_period_unique_non_failed_idx
    ON payroll_run (period_start, period_end)
    WHERE status <> 'FAILED';

-- ---------------------------------------------------------------------------
-- 16. payroll_record
-- ---------------------------------------------------------------------------

CREATE TABLE payroll_record (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_run_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    monthly_base_salary NUMERIC(12, 2) NOT NULL,
    working_days_in_policy NUMERIC(5, 2) NOT NULL,
    one_day_salary NUMERIC(12, 2) NOT NULL,
    attendance_adjusted_pay NUMERIC(12, 2) NOT NULL,
    overtime_pay NUMERIC(12, 2) NOT NULL DEFAULT 0,
    bonus_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    deduction_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    gross_pay NUMERIC(12, 2) NOT NULL,
    net_pay NUMERIC(12, 2) NOT NULL,
    status payroll_record_status NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT payroll_record_payroll_run_employee_unique UNIQUE (payroll_run_id, employee_id),
    CONSTRAINT payroll_record_payroll_run_id_fkey
        FOREIGN KEY (payroll_run_id) REFERENCES payroll_run (id) ON DELETE RESTRICT,
    CONSTRAINT payroll_record_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES employee (id) ON DELETE RESTRICT
);

CREATE INDEX payroll_record_employee_id_idx ON payroll_record (employee_id);

-- ---------------------------------------------------------------------------
-- 17. bonus
-- ---------------------------------------------------------------------------

CREATE TABLE bonus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    payroll_run_id UUID,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    reason TEXT NOT NULL,
    created_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT bonus_amount_positive CHECK (amount > 0),
    CONSTRAINT bonus_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES employee (id) ON DELETE RESTRICT,
    CONSTRAINT bonus_payroll_run_id_fkey
        FOREIGN KEY (payroll_run_id) REFERENCES payroll_run (id) ON DELETE SET NULL,
    CONSTRAINT bonus_created_by_user_id_fkey
        FOREIGN KEY (created_by_user_id) REFERENCES "user" (id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------
-- 18. deduction
-- ---------------------------------------------------------------------------

CREATE TABLE deduction (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    payroll_run_id UUID,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    deduction_type VARCHAR(100) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    reason TEXT NOT NULL,
    created_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT deduction_amount_positive CHECK (amount > 0),
    CONSTRAINT deduction_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES employee (id) ON DELETE RESTRICT,
    CONSTRAINT deduction_payroll_run_id_fkey
        FOREIGN KEY (payroll_run_id) REFERENCES payroll_run (id) ON DELETE SET NULL,
    CONSTRAINT deduction_created_by_user_id_fkey
        FOREIGN KEY (created_by_user_id) REFERENCES "user" (id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------
-- 19. payment
-- ---------------------------------------------------------------------------

CREATE TABLE payment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_record_id UUID NOT NULL,
    paid_at TIMESTAMPTZ NOT NULL,
    reference VARCHAR(255),
    notes TEXT,
    recorded_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT payment_payroll_record_id_fkey
        FOREIGN KEY (payroll_record_id) REFERENCES payroll_record (id) ON DELETE RESTRICT,
    CONSTRAINT payment_recorded_by_user_id_fkey
        FOREIGN KEY (recorded_by_user_id) REFERENCES "user" (id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------
-- 20. audit_log
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT audit_log_actor_user_id_fkey
        FOREIGN KEY (actor_user_id) REFERENCES "user" (id) ON DELETE SET NULL
);

CREATE INDEX audit_log_entity_type_created_at_idx ON audit_log (entity_type, created_at);
CREATE INDEX audit_log_actor_user_id_idx ON audit_log (actor_user_id);

-- migrate:down

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS payment;
DROP TABLE IF EXISTS deduction;
DROP TABLE IF EXISTS bonus;
DROP TABLE IF EXISTS payroll_record;
DROP TABLE IF EXISTS payroll_run;
DROP TABLE IF EXISTS payroll_policy;
DROP TABLE IF EXISTS overtime_record;
DROP TABLE IF EXISTS overtime_rate_config;
DROP TABLE IF EXISTS employee_day_attendance;
DROP TABLE IF EXISTS attendance_session;
DROP TABLE IF EXISTS face_registration_metadata;
DROP TABLE IF EXISTS leave_request;
DROP TABLE IF EXISTS leave_balance;
DROP TABLE IF EXISTS leave_type;
DROP TABLE IF EXISTS "user";
DROP TABLE IF EXISTS employee;
DROP TABLE IF EXISTS shift_weekly_off;
DROP TABLE IF EXISTS shift;
DROP TABLE IF EXISTS department;

DROP TYPE IF EXISTS payroll_record_status;
DROP TYPE IF EXISTS payroll_run_status;
DROP TYPE IF EXISTS working_days_method;
DROP TYPE IF EXISTS overtime_status;
DROP TYPE IF EXISTS leave_request_status;
DROP TYPE IF EXISTS day_classification;
DROP TYPE IF EXISTS attendance_source;
DROP TYPE IF EXISTS attendance_session_status;
DROP TYPE IF EXISTS face_registration_status;
DROP TYPE IF EXISTS user_role;
DROP TYPE IF EXISTS entity_status;
