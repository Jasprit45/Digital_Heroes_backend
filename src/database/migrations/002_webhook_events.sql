-- Digital Heroes Migration 002
-- Description: Stripe webhook event idempotency tracking table

BEGIN;

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    id VARCHAR(255) PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON stripe_webhook_events(event_type);

COMMIT;
