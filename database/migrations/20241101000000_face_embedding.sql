-- Stage 5: face recognition storage (pgvector)
--   * Enables the `vector` extension (requires the pgvector/pgvector:pg16 image).
--   * face_embedding stores one 128-d vector per face_registration_metadata row.
--     face_registration_metadata.vector_record_id holds face_embedding.id (as text).
--   * Cosine-distance HNSW index for nearest-neighbour search.
-- Embeddings are biometric data: never returned by the API, never logged.

-- migrate:up

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE face_embedding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    embedding vector(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT face_embedding_registration_id_key UNIQUE (registration_id),
    CONSTRAINT face_embedding_registration_id_fkey
        FOREIGN KEY (registration_id) REFERENCES face_registration_metadata (id) ON DELETE CASCADE,
    CONSTRAINT face_embedding_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES employee (id) ON DELETE RESTRICT
);

COMMENT ON TABLE face_embedding IS
    'Face embedding (128-d, face-api.js) per registration. Search joins to face_registration_metadata (ACTIVE) and employee (ACTIVE).';

CREATE INDEX face_embedding_employee_id_idx ON face_embedding (employee_id);

CREATE INDEX face_embedding_embedding_cosine_idx
    ON face_embedding USING hnsw (embedding vector_cosine_ops);

-- migrate:down

DROP INDEX IF EXISTS face_embedding_embedding_cosine_idx;
DROP TABLE IF EXISTS face_embedding;
-- The vector extension is intentionally left installed (other objects could depend on it).
