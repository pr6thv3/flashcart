-- Up
-- Migration 005: Audit Log and Outbox Jobs

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(100) NOT NULL,
    target_id VARCHAR(255) NOT NULL,
    request_id VARCHAR(100),
    ip_address VARCHAR(45),
    changes JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Foreign Key Supporting Index for SM010
CREATE INDEX idx_audit_log_actor_id ON audit_log (actor_id);
CREATE INDEX idx_audit_log_target ON audit_log (target_type, target_id);
CREATE INDEX idx_audit_log_created_at ON audit_log (created_at DESC);

CREATE TABLE outbox_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    attempt_count INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    locked_by VARCHAR(100),
    locked_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_outbox_jobs_status CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
    CONSTRAINT chk_outbox_jobs_attempts CHECK (attempt_count >= 0 AND max_attempts > 0)
);

CREATE INDEX idx_outbox_jobs_polling ON outbox_jobs (status, next_attempt_at) WHERE status = 'pending';

-- Down
-- DROP TABLE IF EXISTS outbox_jobs CASCADE;
-- DROP TABLE IF EXISTS audit_log CASCADE;
