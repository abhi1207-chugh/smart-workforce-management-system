-- Phase 2.2 — Migration foundation
-- Enables UUID generation and documents schema organization.
-- Application tables will be added in subsequent migrations.

-- migrate:up

-- UUID strategy: use gen_random_uuid() for primary keys (see database/README.md).
-- Built into PostgreSQL 13+; pgcrypto is enabled for explicit portability.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Schema organization: public schema for MVP (see database/README.md).
COMMENT ON SCHEMA public IS 'Application schema for Smart Workforce Attendance & Payroll Management System (MVP).';

-- migrate:down

DROP EXTENSION IF EXISTS "pgcrypto";
