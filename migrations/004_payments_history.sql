-- Up
-- Migration 004: Payment Attempts, Webhook Events, Refunds, and Order Status History

CREATE TABLE payment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checkout_id UUID NOT NULL REFERENCES checkouts(id) ON DELETE RESTRICT,
    provider VARCHAR(50) NOT NULL,
    provider_payment_id VARCHAR(255),
    idempotency_key VARCHAR(255) NOT NULL,
    amount_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(30) NOT NULL DEFAULT 'initiated',
    error_code VARCHAR(100),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_payment_attempts_idempotency UNIQUE (checkout_id, idempotency_key),
    CONSTRAINT chk_payment_attempts_amount CHECK (amount_minor > 0),
    CONSTRAINT chk_payment_attempts_status CHECK (status IN ('initiated', 'pending', 'authorized', 'captured', 'failed', 'cancelled'))
);

-- Foreign Key Supporting Index for SM010
CREATE INDEX idx_payment_attempts_checkout_id ON payment_attempts (checkout_id);
CREATE INDEX idx_payment_attempts_provider_ref ON payment_attempts (provider, provider_payment_id);

CREATE TABLE payment_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL,
    provider_event_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'received',
    error_message TEXT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_webhook_provider_event UNIQUE (provider, provider_event_id),
    CONSTRAINT chk_webhook_status CHECK (status IN ('received', 'processed', 'ignored', 'failed'))
);

CREATE INDEX idx_webhook_status_created ON payment_webhook_events (status, created_at);

CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    payment_attempt_id UUID REFERENCES payment_attempts(id) ON DELETE RESTRICT,
    provider VARCHAR(50) NOT NULL,
    provider_refund_id VARCHAR(255),
    idempotency_key VARCHAR(255) NOT NULL,
    amount_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    reason TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'requested',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_refunds_idempotency UNIQUE (order_id, idempotency_key),
    CONSTRAINT chk_refunds_amount CHECK (amount_minor > 0),
    CONSTRAINT chk_refunds_status CHECK (status IN ('requested', 'pending', 'succeeded', 'failed'))
);

-- Foreign Key Supporting Indexes for SM010
CREATE INDEX idx_refunds_order_id ON refunds (order_id);
CREATE INDEX idx_refunds_payment_attempt_id ON refunds (payment_attempt_id);
CREATE INDEX idx_refunds_provider_ref ON refunds (provider, provider_refund_id);

CREATE TABLE order_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    old_status VARCHAR(30),
    new_status VARCHAR(30) NOT NULL,
    actor_type VARCHAR(30) NOT NULL,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Foreign Key Supporting Indexes for SM010
CREATE INDEX idx_order_status_history_order_id ON order_status_history (order_id);
CREATE INDEX idx_order_status_history_actor_id ON order_status_history (actor_id);
CREATE INDEX idx_order_status_history_timeline ON order_status_history (order_id, created_at DESC);

-- Down
-- DROP TABLE IF EXISTS order_status_history CASCADE;
-- DROP TABLE IF EXISTS refunds CASCADE;
-- DROP TABLE IF EXISTS payment_webhook_events CASCADE;
-- DROP TABLE IF EXISTS payment_attempts CASCADE;
