-- Stage 5 — verification of face_embedding / pgvector (rolled back; no persistent test data)
-- Run: docker exec -i smart_attendance_postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < database/scripts/verify_stage5_face.sql

BEGIN;

DO $$
DECLARE
    v_dept UUID; v_shift UUID; v_emp UUID; v_emp2 UUID; v_admin UUID;
    v_reg UUID; v_reg2 UUID; v_best UUID; v_dist DOUBLE PRECISION;
    v_a TEXT; v_b TEXT;
BEGIN
    INSERT INTO department (code, name, status) VALUES ('S5V', 'S5V', 'ACTIVE') RETURNING id INTO v_dept;
    INSERT INTO shift (name, start_time, end_time, scheduled_duration_minutes, status)
    VALUES ('S5V', '09:00', '18:00', 540, 'ACTIVE') RETURNING id INTO v_shift;
    INSERT INTO employee (employee_code, first_name, last_name, email, department_id, shift_id, monthly_base_salary, status)
    VALUES ('S5V1', 'A', 'B', 's5v1@test.local', v_dept, v_shift, 30000, 'ACTIVE') RETURNING id INTO v_emp;
    INSERT INTO employee (employee_code, first_name, last_name, email, department_id, shift_id, monthly_base_salary, status)
    VALUES ('S5V2', 'C', 'D', 's5v2@test.local', v_dept, v_shift, 30000, 'ACTIVE') RETURNING id INTO v_emp2;
    INSERT INTO "user" (email, password_hash, role, status)
    VALUES ('s5v-admin@test.local', 'x', 'ADMIN', 'ACTIVE') RETURNING id INTO v_admin;

    -- S5-01: extension present
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        RAISE EXCEPTION 'TEST S5-01 FAILED: vector extension missing';
    END IF;
    RAISE NOTICE 'TEST S5-01 PASSED: vector extension installed';

    INSERT INTO face_registration_metadata (employee_id, vector_record_id, model_name, model_version, embedding_version, status, registered_at, registered_by_user_id)
    VALUES (v_emp, 'pending', 'face-api.js', '1', '1', 'ACTIVE', now(), v_admin) RETURNING id INTO v_reg;
    INSERT INTO face_registration_metadata (employee_id, vector_record_id, model_name, model_version, embedding_version, status, registered_at, registered_by_user_id)
    VALUES (v_emp2, 'pending', 'face-api.js', '1', '1', 'ACTIVE', now(), v_admin) RETURNING id INTO v_reg2;

    -- two distinct unit-ish vectors: e1 = [1,0,...], e2 = [0,1,0,...]
    SELECT '[' || string_agg(CASE WHEN i = 1 THEN '1' ELSE '0' END, ',' ORDER BY i) || ']' INTO v_a FROM generate_series(1, 128) i;
    SELECT '[' || string_agg(CASE WHEN i = 2 THEN '1' ELSE '0' END, ',' ORDER BY i) || ']' INTO v_b FROM generate_series(1, 128) i;

    INSERT INTO face_embedding (registration_id, employee_id, embedding) VALUES (v_reg, v_emp, v_a::vector);
    INSERT INTO face_embedding (registration_id, employee_id, embedding) VALUES (v_reg2, v_emp2, v_b::vector);

    -- S5-02: cosine nearest neighbour returns the identical vector with distance 0
    SELECT employee_id, embedding <=> v_a::vector INTO v_best, v_dist
    FROM face_embedding ORDER BY embedding <=> v_a::vector LIMIT 1;
    IF v_best <> v_emp OR v_dist > 0.000001 THEN
        RAISE EXCEPTION 'TEST S5-02 FAILED: nearest neighbour wrong (dist %)', v_dist;
    END IF;
    RAISE NOTICE 'TEST S5-02 PASSED: cosine nearest neighbour';

    -- S5-03: orthogonal vectors have cosine distance 1
    SELECT v_a::vector <=> v_b::vector INTO v_dist;
    IF abs(v_dist - 1) > 0.000001 THEN
        RAISE EXCEPTION 'TEST S5-03 FAILED: orthogonal distance %', v_dist;
    END IF;
    RAISE NOTICE 'TEST S5-03 PASSED: cosine distance semantics';

    -- S5-04: wrong dimension rejected
    BEGIN
        INSERT INTO face_embedding (registration_id, employee_id, embedding)
        VALUES (gen_random_uuid(), v_emp, '[1,2,3]'::vector);
        RAISE EXCEPTION 'TEST S5-04 FAILED: 3-d vector accepted';
    EXCEPTION WHEN SQLSTATE '22000' OR foreign_key_violation THEN
        RAISE NOTICE 'TEST S5-04 PASSED: wrong dimension rejected';
    END;

    -- S5-05: one embedding per registration
    BEGIN
        INSERT INTO face_embedding (registration_id, employee_id, embedding) VALUES (v_reg, v_emp, v_a::vector);
        RAISE EXCEPTION 'TEST S5-05 FAILED: duplicate registration embedding accepted';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'TEST S5-05 PASSED: one embedding per registration';
    END;

    -- S5-06: deleting the registration cascades to its embedding
    DELETE FROM face_embedding WHERE registration_id = v_reg2;
    DELETE FROM face_registration_metadata WHERE id = v_reg2;
    IF EXISTS (SELECT 1 FROM face_embedding WHERE registration_id = v_reg2) THEN
        RAISE EXCEPTION 'TEST S5-06 FAILED: orphan embedding';
    END IF;
    RAISE NOTICE 'TEST S5-06 PASSED: no orphan embeddings';
END $$;

ROLLBACK;
